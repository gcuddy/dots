#!/usr/bin/env node
// marginalia.mjs — reference parser + CLI for the Marginalia spec (1.0-rc2).
// Dependency-free, Node >= 18. This file is the normative extractor: the
// grep patterns in SPEC.md §11 are lossy helpers; this is the contract.
//
//   node marginalia.mjs lint    notes.md
//   node marginalia.mjs parse   notes.md
//   node marginalia.mjs extract notes.md
//   node marginalia.mjs fix     notes.md        # mechanical fixes -> stdout
//   node marginalia.mjs strip   notes.md        # refuses on error lints (--force)
//   node marginalia.mjs flatten notes.md        # refuses on error lints (--force)
//   node marginalia.mjs wadm    notes.md
//
// Exit codes: lint → 1 if any error-severity finding; strip/flatten → 1 when
// refusing on error lints; others → 0 on success.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const LABEL = 'm-[a-z0-9-]+';
const REF_RE = new RegExp(`\\[\\^(${LABEL})\\]`, 'g');
const DEF_RE = new RegExp(`^( {0,3})\\[\\^(${LABEL})\\]:(.*)$`);
const NEARMISS_RE = /\[\^([Mm][-_][A-Za-z0-9_-]{1,40})\]/g;
const CLOSE_PUNCT = `.,;:!?)"'»…”’›`;
const STATUS_TAGS = ['#m/open', '#m/resolved'];
const RESERVED_TAG = /^#m\/(open|resolved|multi)$|^#m\/(hl|sync)\//;
// CommonMark link-reference-definition shape: destination + optional title.
// A definition body matching this vanishes in strict CommonMark (spec E1).
const LINKREF_SHAPE = /^\S+[ \t]*$|^\S+[ \t]+("[^"]*"|'[^']*'|\([^)]*\))[ \t]*$/;

// ---------------------------------------------------------------- masking --
// Replace code regions with \x00 of equal length so offsets are preserved but
// no syntax matches inside them (spec H5/§11). Two passes: fences + inline
// spans here; indented code blocks after definition extents are known.
function maskFencesAndInline(text) {
  const lines = text.split('\n');
  // YAML frontmatter is metadata, not prose: mask it entirely so ==marks==
  // inside properties are never highlights and tools never write there.
  if (lines[0] === '---') {
    let fm = 1;
    while (fm < lines.length && lines[fm] !== '---' && lines[fm] !== '...') fm++;
    if (fm < lines.length) for (let i = 0; i <= fm; i++) lines[i] = '\x00'.repeat(lines[i].length);
  }
  let fence = null;
  const out = lines.map((line) => {
    const open = line.match(/^(\s*)(`{3,}|~{3,})/);
    if (fence) {
      const closes = open && open[2][0] === fence[0] && open[2].length >= fence.length;
      if (closes) fence = null;
      return '\x00'.repeat(line.length);
    }
    if (open) {
      fence = open[2];
      return '\x00'.repeat(line.length);
    }
    return line.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (m) => '\x00'.repeat(m.length));
  });
  return out.join('\n');
}

function maskInlineOnly(s) {
  return s.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (m) => '\x00'.repeat(m.length));
}

// Mask indented code blocks: runs of >=4-space/tab lines preceded by a blank
// line (or file start) that are NOT inside a footnote-definition block.
function maskIndentedCode(maskedLines, defLineSet) {
  for (let i = 0; i < maskedLines.length; i++) {
    if (!/^(?: {4,}|\t)/.test(maskedLines[i]) || defLineSet.has(i)) continue;
    const prevBlank = i === 0 || maskedLines[i - 1].trim() === '';
    if (!prevBlank) continue;
    let j = i;
    while (j < maskedLines.length &&
      (/^(?: {4,}|\t)/.test(maskedLines[j]) || maskedLines[j].trim() === '') &&
      !defLineSet.has(j)) {
      if (maskedLines[j].trim() !== '') maskedLines[j] = '\x00'.repeat(maskedLines[j].length);
      j++;
    }
    i = j - 1;
  }
  return maskedLines;
}

// ------------------------------------------------------------------ lines --
function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return starts;
}
function lineOf(starts, offset) {
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid; else hi = mid - 1;
  }
  return lo + 1; // 1-based
}

// ---------------------------------------------------------------- entries --
const HEAD_RE = /^(?:([A-Za-z0-9._-]+)[ \t]*)?(?:\((\d{4}-\d{2}-\d{2}(?:[ ]\d{2}:\d{2})?)\)[ \t]*)?:[ \t]+(.*)$/;

export function parseEntry(raw, knownSpeakers) {
  const text = raw.trim();
  const m = text.match(HEAD_RE);
  let speaker = null, stamp = null, body = text, headConfidence = null;
  if (m && (m[1] || m[2])) {
    speaker = m[1] || null;
    stamp = m[2] || null;
    body = m[3];
    headConfidence = stamp ? 'high'
      : knownSpeakers && speaker && knownSpeakers.includes(speaker) ? 'high'
      : 'hint'; // spec E4: speaker-only heads are a hint, not a fence
  }
  // tags come from the body with inline code masked out (spec H5/§11)
  const tags = [...maskInlineOnly(body).matchAll(/#m\/[A-Za-z0-9/_-]+/g)].map((t) => t[0]);
  return { speaker, stamp, body, tags, headConfidence, raw };
}

const norm = (s) => s.replace(/\s+/g, ' ').trim(); // whitespace-normalized, case-SENSITIVE

const isBlockStart = (l) =>
  /^#{1,6} /.test(l) || /^>/.test(l) || /^[-*+] /.test(l) || /^ {0,3}([-_*][ \t]*){3,}$/.test(l);

// ------------------------------------------------------------------ parse --
export function parse(input, opts = {}) {
  const text = input.replace(/\r\n/g, '\n'); // CRLF-normalize (line-anchored grammar)
  const starts = lineStarts(text);
  const rawLines = text.split('\n');
  const lints = [];
  const lint = (rule, severity, line, message, fixable = false) =>
    lints.push({ rule, severity, line, message, fixable });

  let masked = maskFencesAndInline(text);
  let maskedLines = masked.split('\n');

  // ---- pass 1: definition blocks (on fence-masked lines) ----
  const defBlocks = []; // every block incl. duplicates: {label, startLine, endLine (1-based)}
  const defs = new Map(); // label -> first def model
  for (let i = 0; i < maskedLines.length; i++) {
    const dm = maskedLines[i].match(DEF_RE);
    if (!dm) continue;
    const label = dm[2];
    if (dm[1].length > 0)
      lint('DEF-INDENT', 'warn', i + 1,
        `definition [^${label}] indented ${dm[1].length} space(s) — renders as a definition, but normalize to column 0`, true);
    const headRaw = rawLines[i].slice(rawLines[i].indexOf(']:') + 2);
    const def = {
      label, line: i + 1,
      head: parseEntry(headRaw, opts.knownSpeakers),
      thread: [], continuation: [], endLine: i + 1,
    };
    const bodyTrim = headRaw.trim();
    if (bodyTrim === '' || LINKREF_SHAPE.test(bodyTrim))
      lint('E1', 'error', i + 1,
        `definition [^${label}] body is empty, a single token, or a token plus quoted/parenthesized ` +
        `title — parses as a CommonMark link-reference definition and vanishes (add a speaker head or reword)`);
    if (/(^|[^\w@])@[a-z][\w-]*/i.test(headRaw))
      lint('E2', 'warn', i + 1, `bare @name in definition (pandoc rewrites it as a citation)`);
    if (headRaw.includes('%%'))
      lint('E3', 'warn', i + 1, `%%…%% in definition leaks visibly outside Obsidian`);
    if (i > 0 && rawLines[i - 1].trim() !== '' && !maskedLines[i - 1].match(DEF_RE))
      lint('E6', 'error', i + 1,
        `no blank line before definition [^${label}] (pandoc lazily joins it into the paragraph above)`, true);
    if (/^m-\d+$/.test(label))
      lint('L3', 'info', i + 1,
        `sequential label [^${label}] is a transient — relabel to a random label for durability`);
    if (label.length > 32 || label.endsWith('-'))
      lint('L1', 'warn', i + 1,
        `label [^${label}] violates the grammar (max 30 chars after m-, no trailing hyphen)`);
    if (defs.has(label))
      lint('L4', 'error', i + 1,
        `duplicate definition for [^${label}] (renderers disagree on which body wins)`);

    // block scan — matches renderer reality: >=4-indent stays inside; any
    // indented bullet is a thread item (linted when non-canonical); a lazy
    // unindented line joins in renderers (error).
    let j = i + 1;
    let prevWasContent = true;
    while (j < rawLines.length) {
      const l = rawLines[j];
      const bulletM = l.match(/^([ \t]+)([-*+]) (.*)$/);
      if (bulletM) {
        const width = bulletM[1].replace(/\t/g, '    ').length;
        if (width >= 1 && width <= 3)
          lint('T1', 'error', j + 1,
            `thread reply indented ${width} space(s) — must be 4; shallow indents silently detach ` +
            `the thread into body text in most renderers`, true);
        else if (width > 4)
          lint('T1', 'warn', j + 1,
            `thread reply indented ${width} spaces — renders inside the footnote but is non-canonical; use 4`, true);
        if (bulletM[2] !== '-')
          lint('T-BULLET', 'warn', j + 1,
            `thread bullet '${bulletM[2]}' — canonical bullet is '-' (formatters like remark emit '*')`, true);
        def.thread.push({ ...parseEntry(bulletM[3], opts.knownSpeakers), line: j + 1, indent: width, bullet: bulletM[2] });
        def.endLine = j + 1; prevWasContent = true; j++;
      } else if (/^(?: {4,}|\t)\S/.test(l)) {
        def.continuation.push(l.replace(/^(?: +|\t)/, ''));
        def.endLine = j + 1; prevWasContent = true; j++;
      } else if (l.trim() === '') {
        let k = j + 1;
        while (k < rawLines.length && rawLines[k].trim() === '') k++;
        const nb = k < rawLines.length ? rawLines[k] : '';
        // after a blank, the block continues only for an indented bullet
        // (thread item, possibly mis-indented) or >=4-indent continuation
        if (/^[ \t]+[-*+] /.test(nb) || /^(?: {4,}|\t)\S/.test(nb)) {
          if (def.continuation.length || def.thread.length) def.continuation.push('');
          j = k; prevWasContent = false; continue; // process line k itself next iteration
        }
        break;
      } else if (maskedLines[j].match(DEF_RE)) {
        break;
      } else if (prevWasContent && !isBlockStart(l)) {
        lint('LAZY', 'error', j + 1,
          `unindented line directly after definition [^${label}] — renderers lazily join it into the ` +
          `footnote; indent it 4 spaces (continuation) or add a blank line before it`, true);
        def.continuation.push(l.trim());
        def.endLine = j + 1; j++;
      } else break;
    }
    defBlocks.push({ label, startLine: i + 1, endLine: def.endLine });
    if (!defs.has(label)) defs.set(label, def);
    i = def.endLine - 1;
  }

  // ---- pass 2: mask indented code outside definition blocks ----
  const defLineSet = new Set();
  for (const b of defBlocks) for (let l = b.startLine - 1; l < b.endLine; l++) defLineSet.add(l);
  maskedLines = maskIndentedCode(maskedLines, defLineSet);
  masked = maskedLines.join('\n');

  // ---- H4-WRAP (heuristic): a probable ==highlight== wrapped across a soft
  // line break inside one paragraph block — legal markdown that renders in
  // mark-capable renderers but is invisible to this line-scoped grammar (H4),
  // so it silently misses lint/extract/strip/flatten/wadm. Conservative
  // detection on masked text (code/frontmatter already \x00-ed): a line whose
  // `==` token count is odd, followed before the block ends by another
  // odd-count line. Balanced same-line highlights count even; definition
  // blocks are exempt; a rare prose `a == b` split over two lines is an
  // accepted warn-level false positive.
  // Known false negative: blockquote continuation lines (`> …`) count as
  // block starts here, so a wrap inside a quote goes undetected — accepted
  // under "conservative". Table rows and setext underlines are excluded: a
  // highlight cannot span table rows, and `====` underlines are structure.
  {
    const oddEq = (l) => ((l.match(/==/g) || []).length % 2) === 1;
    const isTableRow = (l) => /^\s*\|/.test(l);
    const isSetext = (l) => /^ {0,3}=+\s*$/.test(l);
    for (let i = 0; i < maskedLines.length; i++) {
      if (defLineSet.has(i) || maskedLines[i].trim() === '' || isTableRow(maskedLines[i]) ||
          isSetext(maskedLines[i]) || !oddEq(maskedLines[i])) continue;
      for (let j = i + 1; j < maskedLines.length; j++) {
        if (defLineSet.has(j) || maskedLines[j].trim() === '' || isTableRow(maskedLines[j]) ||
            isSetext(maskedLines[j]) || isBlockStart(maskedLines[j])) {
          // re-evaluate the boundary line itself as an opener (a bullet can
          // start its own wrapped pair); outer i++ lands on j — monotonic.
          i = j - 1; break;
        }
        if (oddEq(maskedLines[j])) {
          lint('H4-WRAP', 'warn', i + 1,
            `possible highlight spanning a line break — Marginalia highlights are single-line (H4); ` +
            `close == on the same line or split per line`);
          i = j; break;
        }
      }
    }
  }

  // ---- near-miss labels: claimed by the namespace, invisible to the grammar ----
  let nm;
  while ((nm = NEARMISS_RE.exec(masked)) !== null) {
    if (new RegExp(`^${LABEL}$`).test(nm[1])) continue;
    lint('NEAR-MISS', 'error', lineOf(starts, nm.index),
      `[^${nm[1]}] looks like a marginalia label but is not one (case/charset) — ` +
      `it is invisible to all tooling and will leak through strip; rename it`);
  }

  // ---- highlights ----
  const highlights = [];
  const HL_RE = /==((?:[^=\n]|=(?!=))+?)==/g;
  let hm;
  while ((hm = HL_RE.exec(masked)) !== null) {
    const start = hm.index, end = hm.index + hm[0].length;
    const inner = text.slice(start + 2, end - 2);
    const ln = lineOf(starts, start);
    if (/^\s|\s$/.test(inner))
      lint('H3', 'warn', ln,
        `highlight has inner-edge whitespace ("==${inner}==") — reported to render in Obsidian only; ` +
        `leaks literal == elsewhere`, true);
    highlights.push({ text: inner, start, end, line: ln, refs: [], quick: null });
  }
  const hlByEnd = new Map(highlights.map((h) => [h.end, h]));

  // ---- refs ----
  const refs = [];
  let rm;
  REF_RE.lastIndex = 0;
  while ((rm = REF_RE.exec(masked)) !== null) {
    const ln = lineOf(starts, rm.index);
    if (maskedLines[ln - 1].match(DEF_RE) && rm.index - starts[ln - 1] <= 3) continue; // the def head token
    refs.push({ label: rm[1], start: rm.index, end: rm.index + rm[0].length, line: ln, binding: 'point', highlight: null });
  }

  // ---- quick annotations ^[…] (bracket-balancing; wikilinks etc. are fine) ----
  const quicks = [];
  for (let i = 0; i < masked.length - 1; i++) {
    if (masked[i] !== '^' || masked[i + 1] !== '[') continue;
    let depth = 1, j = i + 2, ok = false;
    while (j < masked.length) {
      const c = masked[j];
      if (c === '\\') { j += 2; continue; }
      if (c === '\n') break;
      if (c === '[') depth++;
      else if (c === ']') { depth--; if (depth === 0) { ok = true; break; } }
      j++;
    }
    if (!ok) continue;
    quicks.push({ start: i, end: j + 1, note: text.slice(i + 2, j), line: lineOf(starts, i), owner: null });
    i = j;
  }
  const refByEnd = new Map(refs.map((r) => [r.end, r]));
  const quickByEnd = new Map(quicks.map((q) => [q.end, q]));

  // walk back from `from` over refs, quick notes, closing punctuation, spaces
  function walkBack(from) {
    let i = from, sawSpace = false, sawPunct = false, sawQuick = false, sawRef = false;
    for (;;) {
      const pr = refByEnd.get(i);
      if (pr) { i = pr.start; sawRef = true; continue; }
      const pq = quickByEnd.get(i);
      if (pq) { i = pq.start; sawQuick = true; continue; }
      if (i > 0 && CLOSE_PUNCT.includes(text[i - 1])) { sawPunct = true; i--; continue; }
      if (i > 0 && (text[i - 1] === ' ' || text[i - 1] === '\t')) { sawSpace = true; i--; continue; }
      break;
    }
    return { at: i, sawSpace, sawPunct, sawQuick, sawRef };
  }

  for (const ref of refs) {
    const w = walkBack(ref.start);
    const hl = hlByEnd.get(w.at);
    if (!hl) continue;
    ref.binding = 'highlight'; ref.highlight = hl; hl.refs.push(ref.label);
    if (w.sawQuick)
      lint('Q1', 'error', ref.line,
        `highlight mixes an inline footnote with labeled ref [^${ref.label}] — use stacked labeled refs`);
    else if (w.sawSpace)
      lint('BIND-SPACE', 'warn', ref.line,
        `ref [^${ref.label}] separated from == by whitespace — mis-normalized highlight annotation ` +
        `(not a point annotation); remove the gap`, true);
    else if (w.sawPunct)
      lint('BIND-PUNCT', 'info', ref.line,
        `ref [^${ref.label}] separated from == by punctuation — accepted, normalize to tight form`, true);
  }
  for (const q of quicks) {
    const w = walkBack(q.start);
    const hl = hlByEnd.get(w.at);
    if (!hl) continue;
    q.owner = hl;
    if (w.sawRef || hl.refs.length)
      lint('Q1', 'error', q.line,
        `highlight mixes an inline footnote with labeled refs — use stacked labeled refs`);
    else if (hl.quick !== null)
      lint('Q1', 'error', q.line, `adjacent inline footnotes ^[a]^[b] — destroyed by pandoc`);
    else hl.quick = q.note;
  }

  // ---- assemble annotations ----
  const annotations = [];
  for (const [label, def] of defs) {
    const bound = refs.filter((r) => r.label === label);
    const nonEcho = [def.head, ...def.thread.filter((t) => t.speaker !== 'echo')];
    const allTags = nonEcho.flatMap((e) => e.tags); // echoes excluded from derivation (§6.5)
    const statusTag = nonEcho.flatMap((e) => e.tags.filter((t) => STATUS_TAGS.includes(t))).pop();
    const echoes = def.thread.filter((t) => t.speaker === 'echo').map((t) => t.body);
    const segments = bound.filter((r) => r.binding === 'highlight');
    if (segments.length > 1 && !allTags.includes('#m/multi'))
      lint('M1', 'error', def.line,
        `label [^${label}] bound to ${segments.length} highlights without #m/multi — ` +
        `accidental label reuse, or declare it multi-segment`);
    // M2 / MULTI-STALE — the inverse of M1: declared #m/multi but the
    // segments are gone. Fires only while some ref survives (ORPHAN covers
    // the zero-ref case) — in the common drift that is exactly one bound
    // segment, though refs whose fences were deleted can leave zero segments
    // with the label still bound. The echoes say what is missing (§8.3).
    if (allTags.includes('#m/multi') && bound.length > 0 && segments.length <= 1)
      lint('MULTI-STALE', 'warn', def.line,
        `[^${label}] #m/multi but only ${segments.length} bound segment(s) — a segment may have been lost (see echoes)`);
    if (allTags.includes('#m/multi') && echoes.length && echoes.length !== segments.length)
      lint('ECHO-COUNT', 'warn', def.line,
        `[^${label}] has ${segments.length} segment(s) but ${echoes.length} echo(es) — one echo per segment, in order`);
    // Staleness: positional pairing is primary. Only when the counts differ
    // (a segment vanished, positions shifted) is a positional mismatch
    // suppressed by set membership (§6.5) — with equal counts the pairing is
    // trustworthy, and the fallback would mask a real edit that happens to
    // duplicate another echo's text. Loss stays ECHO-COUNT's signal; a
    // text-identical block reorder now reads as STALE, the lesser evil.
    const nEchoes = echoes.map(norm);
    const nSegs = segments.map((s) => norm(s.highlight.text));
    const countsMatch = echoes.length === segments.length;
    const stale = echoes.length > 0 && segments.length > 0 &&
      segments.some((s, ix) => {
        if (echoes[ix] === undefined || nSegs[ix] === nEchoes[ix]) return false;
        if (countsMatch) return true;
        return !nEchoes.includes(nSegs[ix]) && !nSegs.includes(nEchoes[ix]);
      });
    if (stale)
      lint('STALE', 'info', def.line,
        `[^${label}] echo no longer matches the highlighted text — the highlight was edited after annotation`);
    annotations.push({
      label,
      line: def.line,
      head: def.head,
      thread: def.thread.filter((t) => t.speaker !== 'echo'),
      echoes,
      continuation: def.continuation,
      type: def.head.tags.find((t) => !RESERVED_TAG.test(t)) ?? null, // head entry only (§6.6)
      status: statusTag === '#m/resolved' ? 'resolved' : 'open',
      multi: allTags.includes('#m/multi'),
      targets: bound.map((r) => r.binding === 'highlight'
        ? { kind: 'highlight', text: r.highlight.text, line: r.highlight.line, start: r.highlight.start, end: r.highlight.end }
        : { kind: 'point', line: r.line, start: r.start }),
      orphan: bound.length === 0,
      stale,
    });
    if (bound.length === 0)
      lint('ORPHAN', 'warn', def.line,
        `definition [^${label}] has no reference — invisible in every rendered view; ` +
        `re-anchor it or park it under '## Orphaned marginalia'`);
  }
  for (const r of refs)
    if (!defs.has(r.label))
      lint('DANGLING', 'warn', r.line,
        `ref [^${r.label}] has no definition — renders as literal text; scaffold a ` +
        `definition with placeholder text or remove the ref`);

  return { highlights, refs, quicks, annotations, defBlocks, lints, text, starts };
}

// ------------------------------------------------------------------- cuts --
// One span set drives strip, flatten, and the WADM anchoring stream.
function computeCuts(model, { fences = false } = {}) {
  const { text, starts, defBlocks, refs, quicks, annotations } = model;
  const cuts = [];
  for (const r of refs) cuts.push([r.start, r.end]);
  for (const q of quicks) if (q.owner) cuts.push([q.start, q.end]);
  for (const b of defBlocks) {
    const s = starts[b.startLine - 1];
    const e = b.endLine < starts.length ? starts[b.endLine] : text.length;
    cuts.push([s, e]);
  }
  const labels = new Set(annotations.map((a) => a.label));
  const BA_RE = new RegExp(` \\^(${LABEL})(?=\\n|$)`, 'g');
  let m;
  while ((m = BA_RE.exec(text)) !== null)
    if (labels.has(m[1])) cuts.push([m.index, m.index + m[0].length]);
  if (fences)
    for (const h of model.highlights) { cuts.push([h.start, h.start + 2]); cuts.push([h.end - 2, h.end]); }
  cuts.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const c of cuts) {
    const last = merged[merged.length - 1];
    if (last && c[0] <= last[1]) last[1] = Math.max(last[1], c[1]);
    else merged.push([...c]);
  }
  return merged;
}

function applyCuts(text, cuts) {
  let out = '', pos = 0;
  const seams = [];
  for (const [s, e] of cuts) {
    out += text.slice(pos, s);
    seams.push(out.length);
    pos = e;
  }
  out += text.slice(pos);
  return { out, seams };
}

// collapse newline runs only where a cut created them, preserving the
// author's intentional blank lines elsewhere
function collapseAtSeams(out, seams) {
  let result = out;
  for (const seam of [...seams].sort((a, b) => b - a)) {
    let s = seam, e = seam;
    while (s > 0 && result[s - 1] === '\n') s--;
    while (e < result.length && result[e] === '\n') e++;
    const run = e - s;
    if (run > 2) result = result.slice(0, s) + '\n\n' + result.slice(e);
    else if (run > 0 && (s === 0 || e === result.length)) result = result.slice(0, s) + (s === 0 ? '' : '\n') + result.slice(e);
  }
  return result;
}

// ------------------------------------------------------------------ strip --
// Clean copy: highlights stay, all annotation machinery goes.
export function strip(model) {
  const cuts = computeCuts(model);
  const { out, seams } = applyCuts(model.text, cuts);
  return collapseAtSeams(out, seams).replace(/\n{3,}$/, '\n');
}

// Anchoring stream (§12): stripped text with highlight fences also removed —
// the plain-text stream an external consumer would anchor against. Built once
// per model with an original-offset → stream-offset map.
function anchorStream(model) {
  if (model._stream) return model._stream;
  const cuts = computeCuts(model, { fences: true });
  let stream = '', pos = 0;
  const segs = []; // { origStart, origEnd, streamStart }
  for (const [s, e] of cuts) {
    if (s > pos) { segs.push({ origStart: pos, origEnd: s, streamStart: stream.length }); stream += model.text.slice(pos, s); }
    pos = e;
  }
  if (pos < model.text.length) { segs.push({ origStart: pos, origEnd: model.text.length, streamStart: stream.length }); stream += model.text.slice(pos); }
  model._stream = { stream, segs };
  return model._stream;
}
function toStreamPos(model, origPos) {
  const { stream, segs } = anchorStream(model);
  for (const s of segs) {
    if (origPos < s.origStart) return s.streamStart;           // position was inside a cut: snap forward
    if (origPos <= s.origEnd) return s.streamStart + (origPos - s.origStart);
  }
  return stream.length;
}
function streamContext(model, origPos, before) {
  const { stream } = anchorStream(model);
  const p = toStreamPos(model, origPos);
  return before ? stream.slice(Math.max(0, p - 32), p) : stream.slice(p, p + 32);
}

// ---------------------------------------------------------------- flatten --
// Refs out; annotations (labeled, quick, orphaned) to a '## Marginalia' section.
export function flatten(model) {
  const body = strip(model);
  const quicksOwned = model.quicks.filter((q) => q.owner);
  if (!model.annotations.length && !quicksOwned.length) return body;
  const out = [body.trimEnd(), '', '## Marginalia', ''];
  if (/^## Marginalia$/m.test(body))
    process.stderr.write('warning: input already contains a "## Marginalia" heading\n');
  for (const a of model.annotations) {
    const quotes = a.targets.filter((t) => t.kind === 'highlight').map((t) => t.text);
    const q = quotes.length ? quotes : a.echoes;
    for (const quote of q) out.push(`> ${quote}`);
    if (!q.length) {
      const t = a.targets.find((x) => x.kind === 'point');
      if (t) {
        const line = model.text.split('\n')[t.line - 1] ?? '';
        const clean = line.replace(new RegExp(`\\[\\^${LABEL}\\]`, 'g'), '').trim().slice(0, 80);
        out.push(`> near: ${clean}`);
      }
    }
    out.push('>');
    out.push(`> — ${entryLine(a.head)}`);
    for (const c of a.continuation) out.push(c.trim() === '' ? '>' : `> ${c}`);
    for (const t of a.thread) out.push(`>   - ${entryLine(t)}`);
    out.push('');
  }
  for (const q of quicksOwned) {
    out.push(`> ${q.owner.text}`);
    out.push('>');
    out.push(`> — ${q.note}`);
    out.push('');
  }
  return out.join('\n');
}

// ------------------------------------------------------------------- wadm --
export function wadm(model, source = 'file:notes.md') {
  const ctx = ['http://www.w3.org/ns/anno.jsonld',
    { marginalia: 'https://github.com/gcuddy/dots/tree/master/marginalia#' }];
  const iso = (s) => (s ? s.replace(' ', 'T') : s);
  const selectorFor = (t) => ({
    type: 'TextQuoteSelector',
    exact: t.text,
    // context computed over the anchoring stream (§12): machinery + fences removed
    prefix: streamContext(model, t.start, true),
    suffix: streamContext(model, t.end, false),
  });
  const out = model.annotations.map((a) => ({
    '@context': ctx,
    type: 'Annotation',
    id: `${source}#${a.label}`,
    motivation: a.type === '#m/q' ? 'questioning' : 'commenting',
    ...(a.status === 'resolved' ? { 'marginalia:status': 'resolved' } : {}),
    body: [
      ...[a.head].map((e) => ({
        type: 'TextualBody', format: 'text/markdown',
        value: [e.body, ...a.continuation.filter((c) => c.trim() !== '')].join('\n'),
        ...(e.speaker && e.headConfidence !== 'hint' ? { creator: e.speaker } : {}),
        ...(e.stamp ? { created: iso(e.stamp) } : {}),
      })),
      ...a.thread.filter((e) => e.body?.trim()).map((e) => ({
        type: 'TextualBody', format: 'text/markdown', value: e.body,
        ...(e.speaker && e.headConfidence !== 'hint' ? { creator: e.speaker } : {}),
        ...(e.stamp ? { created: iso(e.stamp) } : {}),
      })),
    ],
    target: a.targets.length ? a.targets.map((t) => ({
      source,
      selector: t.kind === 'highlight' ? selectorFor(t)
        : { type: 'TextPositionSelector', start: t.start, end: t.start },
    })) : { source, 'marginalia:orphan': true, ...(a.echoes.length ? { 'marginalia:echo': a.echoes } : {}) },
  }));
  for (const q of model.quicks.filter((q) => q.owner)) {
    out.push({
      '@context': ctx, type: 'Annotation',
      id: `${source}#quick-${q.start}`,
      motivation: 'commenting',
      body: [{ type: 'TextualBody', format: 'text/markdown', value: q.note }],
      target: { source, selector: selectorFor({ text: q.owner.text, start: q.owner.start, end: q.owner.end }) },
    });
  }
  for (const h of model.highlights.filter((h) => h.quick === null && h.refs.length === 0)) {
    out.push({
      '@context': ctx, type: 'Annotation',
      id: `${source}#hl-${h.start}`,
      motivation: 'highlighting',
      target: { source, selector: selectorFor(h) },
    });
  }
  return out;
}

// -------------------------------------------------------------------- fix --
// Mechanical fixes for lints marked (fixable). Returns fixed text.
export function fix(input) {
  let model = parse(input);
  let lines = model.text.split('\n');
  // line-based fixes, bottom-up
  for (const l of [...model.lints].sort((a, b) => b.line - a.line)) {
    const i = l.line - 1;
    if (l.rule === 'T1' || l.rule === 'T-BULLET') {
      lines[i] = lines[i].replace(/^([ \t]+)([-*+]) /, '    - ');
    } else if (l.rule === 'DEF-INDENT') {
      lines[i] = lines[i].replace(/^ +/, '');
    } else if (l.rule === 'E6') {
      lines.splice(i, 0, '');
    } else if (l.rule === 'LAZY') {
      lines[i] = '    ' + lines[i].trim();
    }
  }
  let text = lines.join('\n');
  // offset-based fixes on a fresh parse
  model = parse(text);
  const edits = [];
  for (const ref of model.refs) {
    if (ref.binding !== 'highlight') continue;
    const gapStart = ref.highlight.end;
    // find this ref's position in the run after the highlight
    if (ref.start > gapStart) {
      const gap = text.slice(gapStart, ref.start);
      if (/^[ \t]*$/.test(gap) || new RegExp(`^[${CLOSE_PUNCT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\t]*$`).test(gap)) {
        const punct = gap.replace(/[ \t]/g, '');
        edits.push({ start: gapStart, end: ref.end, text: text.slice(ref.start, ref.end) + punct });
      }
    }
  }
  for (const h of model.highlights) {
    if (/^\s|\s$/.test(h.text))
      edits.push({ start: h.start, end: h.end, text: `==${h.text.trim()}==` });
  }
  for (const e of edits.sort((a, b) => b.start - a.start))
    text = text.slice(0, e.start) + e.text + text.slice(e.end);
  // L3 normalize: sequential labels are transients — relabel to random
  model = parse(text);
  const taken = new Set([...model.refs.map((r) => r.label), ...model.defBlocks.map((b) => b.label)]);
  for (const b of model.defBlocks) {
    if (!/^m-\d+$/.test(b.label)) continue;
    let fresh;
    do {
      fresh = 'm-';
      for (let i = 0; i < 4; i++) fresh += 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)];
    } while (taken.has(fresh));
    taken.add(fresh);
    text = text.split(`[^${b.label}]`).join(`[^${fresh}]`);
  }
  return text;
}

// ---------------------------------------------------------------- helpers --
function entryLine(e) {
  const head = [e.speaker, e.stamp ? `(${e.stamp})` : null].filter(Boolean).join(' ');
  return head ? `${head}: ${e.body}` : e.body;
}

// -------------------------------------------------------------------- cli --
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = process.argv.slice(2).filter((a) => a !== '--force');
  const force = process.argv.includes('--force');
  const [cmd, file] = args;
  if (!cmd || !file) {
    console.error('usage: node marginalia.mjs <parse|lint|extract|fix|strip|flatten|wadm> <file.md> [--force]');
    process.exit(2);
  }
  const text = readFileSync(file, 'utf8');
  const model = parse(text);
  const errors = model.lints.filter((l) => l.severity === 'error');
  const gate = () => {
    if (errors.length && !force) {
      for (const l of errors) console.error(`${file}:${l.line} [error] ${l.rule}: ${l.message}`);
      console.error(`refusing: ${errors.length} error(s) — fix them (or pass --force to proceed anyway)`);
      process.exit(1);
    }
  };
  if (cmd === 'parse') {
    const { text: _t, starts: _s, ...rest } = model;
    console.log(JSON.stringify(rest, (k, v) => (k === 'highlight' || k === 'owner' ? undefined : v), 2));
  } else if (cmd === 'lint') {
    for (const l of model.lints)
      console.log(`${file}:${l.line} [${l.severity}] ${l.rule}: ${l.message}${l.fixable ? ' (fixable)' : ''}`);
    console.log(`${model.annotations.length} annotation(s), ${model.highlights.length} highlight(s), ` +
      `${errors.length} error(s), ${model.lints.length - errors.length} other finding(s)`);
    process.exit(errors.length ? 1 : 0);
  } else if (cmd === 'extract') {
    for (const a of model.annotations) {
      const quotes = a.targets.filter((t) => t.kind === 'highlight').map((t) => `"${t.text}"`).join(' + ');
      const where = quotes || (a.orphan ? '(unanchored)' : '(point)');
      console.log(`[${a.status}${a.type ? ' ' + a.type : ''}] ${a.label} ${where}${a.orphan ? ' (ORPHAN)' : ''}${a.stale ? ' (stale echo)' : ''}`);
      console.log(`  ${entryLine(a.head)}`);
      for (const c of a.continuation) if (c.trim()) console.log(`  ${c}`);
      for (const t of a.thread) console.log(`    - ${entryLine(t)}`);
    }
    for (const q of model.quicks.filter((q) => q.owner))
      console.log(`[quick] "${q.owner.text}" — ${q.note}`);
  } else if (cmd === 'fix') {
    process.stdout.write(fix(text));
  } else if (cmd === 'strip') {
    gate();
    process.stdout.write(strip(model) + '\n');
  } else if (cmd === 'flatten') {
    gate();
    process.stdout.write(flatten(model) + '\n');
  } else if (cmd === 'wadm') {
    console.log(JSON.stringify(wadm(model, `file:${file}`), null, 2));
  } else {
    console.error(`unknown command: ${cmd}`);
    process.exit(2);
  }
}

#!/usr/bin/env node
// marginalia.mjs — reference parser + CLI for the Marginalia spec (1.0-rc4).
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
// Every command takes --page-heading <text> to recognize a page-notes section
// (§7.5 Form B) under a configured heading instead of the reserved "Page notes".
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
// Reserved tags never act as the type (§6.6): status, multi, the page scope
// tag, and the hl/sync families — matched as a set, so tag order is irrelevant.
const RESERVED_TAG = /^#m\/(open|resolved|multi|page)$|^#m\/(hl|sync)\//;
const PAGE_TAG = '#m/page';
// CommonMark link-reference-definition shape: destination + optional title.
// A definition body matching this vanishes in strict CommonMark (spec E1).
const LINKREF_SHAPE = /^\S+[ \t]*$|^\S+[ \t]+("[^"]*"|'[^']*'|\([^)]*\))[ \t]*$/;

// ---------------------------------------------------------------- masking --
// Replace code regions with \x00 of equal length so offsets are preserved but
// no syntax matches inside them (spec H5/§11). Two passes: fences + inline
// spans here; indented code blocks after definition extents are known.
// YAML frontmatter extent: index of the first body line (0 when there is no
// frontmatter or its fence never closes).
function frontmatterEnd(lines) {
  if (lines[0] !== '---') return 0;
  let fm = 1;
  while (fm < lines.length && lines[fm] !== '---' && lines[fm] !== '...') fm++;
  return fm < lines.length ? fm + 1 : 0;
}

function maskFencesAndInline(text) {
  const lines = text.split('\n');
  // YAML frontmatter is metadata, not prose: mask it entirely so ==marks==
  // inside properties are never highlights and tools never write there.
  for (let i = 0, fm = frontmatterEnd(lines); i < fm; i++) lines[i] = '\x00'.repeat(lines[i].length);
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

// ----------------------------------------------------------- page section --
// Page notes, section form (§7.5 Form B): a heading of any level whose text is
// the reserved PAGE_HEADING (trimmed, case-insensitive; tools may accept a
// configured text — the CLI's --page-heading) opens a section of top-level
// "- " items, one page note each. The section runs to the next heading of any
// level, a marker line, a footnote definition, or EOF. Extents on a line
// array: { start, end } 0-based, end exclusive (the terminator line).
export const PAGE_HEADING = 'Page notes';
const headingKey = (opts) => (opts.pageHeading ?? PAGE_HEADING).trim().toLowerCase();
function isPageHeading(line, key) {
  const m = line.match(/^#{1,6}[ \t]+(.*?)[ \t]*$/);
  return !!m && m[1].replace(/[ \t]+#+$/, '').trim().toLowerCase() === key;
}
function pageSections(lines, key) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isPageHeading(lines[i], key)) continue;
    let j = i + 1;
    while (j < lines.length && !/^#{1,6}[ \t]/.test(lines[j]) && !MARKER_LINE_RE.test(lines[j]) && !DEF_RE.test(lines[j])) j++;
    out.push({ start: i, end: j });
    i = j - 1;
  }
  return out;
}

// ------------------------------------------------------------ marker line --
// Page notes (§7.5) put their refs on the marker line: the first non-blank
// body line after frontmatter, skipping a leading %%…%% comment block and a
// leading page-notes section (P11; `sections` from pageSections over the same
// lines). Returns its 0-based index (lines.length for an empty body) and
// whether that line is already a marker — a line consisting only of
// marginalia refs.
const MARKER_LINE_RE = new RegExp(`^ {0,3}(?:\\[\\^${LABEL}\\][ \\t]*)+$`); // <=3 leading spaces: 4+ is an indented code block
function markerLine(lines, sections = []) {
  let i = frontmatterEnd(lines);
  for (;;) {
    while (i < lines.length && lines[i].trim() === '') i++;
    if (i >= lines.length) break;
    const sec = sections.find((s) => s.start === i);
    if (sec) { i = sec.end; continue; } // a leading section is skipped whole, trailing blanks included
    if (!/^[ \t]*%%/.test(lines[i])) break;
    if (!lines[i].replace(/^[ \t]*%%/, '').includes('%%')) {
      let j = i + 1;
      while (j < lines.length && !lines[j].includes('%%')) j++;
      if (j >= lines.length) break; // unterminated comment: it is the body start, not a skipped block
      i = j;
    }
    i++;
  }
  return { index: i, present: i < lines.length && MARKER_LINE_RE.test(lines[i]) };
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

  // ---- page-notes section (§7.5 Form B): headings and terminators on the
  // fence-masked lines, items on raw lines. A top-level "- " item is one page
  // note; nested bullets (indent >= 2) are its replies, other lines indented
  // to the content column its continuation; anything else is PAGE-SECTION.
  const sections = pageSections(maskedLines, headingKey(opts));
  const sectionItems = [];
  const sectionLineSet = new Set();
  sections.forEach((sec, si) => {
    if (si > 0)
      lint('PAGE-SECTION', 'warn', sec.start + 1,
        `a second page-notes section — one per file; merge its items into the first`);
    if (sec.end < maskedLines.length && maskedLines[sec.end].match(DEF_RE))
      lint('PAGE-SECTION', 'warn', sec.end + 1,
        `a footnote definition ends the page-notes section here — anything below it is prose; ` +
        `definitions go under the marker line (§7.5 P6)`);
    for (let l = sec.start; l < sec.end; l++) sectionLineSet.add(l);
    const bulletLint = (bullet, line) => {
      if (bullet !== '-')
        lint('T-BULLET', 'warn', line,
          `page-note bullet '${bullet}' — canonical bullet is '-' (formatters like remark emit '*')`, true);
    };
    let item = null, run = false; // run: inside an already-reported run of non-item content
    for (let j = sec.start + 1; j < sec.end; j++) {
      const l = rawLines[j];
      const itemM = l.match(/^([-*+]) +(\S.*)$/);
      if (itemM) {
        bulletLint(itemM[1], j + 1);
        item = { line: j + 1, section: si, head: parseEntry(itemM[2], opts.knownSpeakers), thread: [], continuation: [], endLine: j + 1 };
        sectionItems.push(item); run = false; continue;
      }
      if (l.trim() === '') {
        // a blank ends the item unless an indented reply or continuation follows
        let k = j + 1;
        while (k < sec.end && rawLines[k].trim() === '') k++;
        if (item && k < sec.end && /^(?: {2,}|\t)\S/.test(rawLines[k])) {
          if (item.continuation.length || item.thread.length) item.continuation.push('');
        } else item = null;
        run = false; continue;
      }
      const replyM = item && l.match(/^([ \t]+)([-*+]) (.*)$/);
      const width = replyM ? replyM[1].replace(/\t/g, '    ').length : 0;
      if (replyM && width >= 2) {
        bulletLint(replyM[2], j + 1);
        item.thread.push({ ...parseEntry(replyM[3], opts.knownSpeakers), line: j + 1, indent: width, bullet: replyM[2] });
        item.endLine = j + 1; continue;
      }
      if (item && !replyM && /^(?: {2,}|\t)\S/.test(l)) {
        item.continuation.push(l.replace(/^[ \t]+/, ''));
        item.endLine = j + 1; continue;
      }
      if (!run)
        lint('PAGE-SECTION', 'warn', j + 1,
          `page-notes section holds content that is not a "- " item — ignored (each page note is one top-level list item)`);
      run = true; item = null;
    }
  });

  // ---- pass 2: mask indented code outside definition blocks and the section ----
  const defLineSet = new Set();
  for (const b of defBlocks) for (let l = b.startLine - 1; l < b.endLine; l++) defLineSet.add(l);
  const structLineSet = new Set([...defLineSet, ...sectionLineSet]);
  maskedLines = maskIndentedCode(maskedLines, structLineSet);
  masked = maskedLines.join('\n');

  // ---- H4-WRAP (heuristic): a probable ==highlight== wrapped across a soft
  // line break inside one paragraph block — legal markdown that renders in
  // mark-capable renderers but is invisible to this line-scoped grammar (H4),
  // so it silently misses lint/extract/strip/flatten/wadm. Conservative
  // detection on masked text (code/frontmatter already \x00-ed): a line whose
  // `==` token count is odd, followed before the block ends by another
  // odd-count line. Balanced same-line highlights count even; definition
  // blocks and the page-notes section are exempt; a rare prose `a == b` split
  // over two lines is an accepted warn-level false positive.
  // Known false negative: blockquote continuation lines (`> …`) count as
  // block starts here, so a wrap inside a quote goes undetected — accepted
  // under "conservative". Table rows and setext underlines are excluded: a
  // highlight cannot span table rows, and `====` underlines are structure.
  {
    const oddEq = (l) => ((l.match(/==/g) || []).length % 2) === 1;
    const isTableRow = (l) => /^\s*\|/.test(l);
    const isSetext = (l) => /^ {0,3}=+\s*$/.test(l);
    for (let i = 0; i < maskedLines.length; i++) {
      if (structLineSet.has(i) || maskedLines[i].trim() === '' || isTableRow(maskedLines[i]) ||
          isSetext(maskedLines[i]) || !oddEq(maskedLines[i])) continue;
      for (let j = i + 1; j < maskedLines.length; j++) {
        if (structLineSet.has(j) || maskedLines[j].trim() === '' || isTableRow(maskedLines[j]) ||
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
  const marker = markerLine(rawLines, sections);
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
    // Page notes (§7.5): scope comes from #m/page on the head entry; the ref is
    // only the visibility marker, so every ref belongs on the marker line.
    const page = def.head.tags.includes(PAGE_TAG);
    if (page) {
      if (echoes.length)
        lint('PAGE-ECHO', 'warn', def.line,
          `page note [^${label}] carries echo items — page notes have no quote; ` +
          `probably an orphan re-tagged #m/page instead of repaired`);
      for (const r of bound) {
        if (r.binding === 'highlight')
          lint('PAGE-BIND', 'warn', r.line,
            `page note [^${label}] is bound to a highlight — #m/page means document scope; ` +
            `move the ref to the marker line`, true);
        else if (!(marker.present && r.line - 1 === marker.index))
          lint('PAGE-PLACE', 'info', r.line,
            `page note ref [^${label}] is not on the marker line (the first body line, §7.5)`, true);
      }
    }
    annotations.push({
      label,
      form: 'footnote',
      line: def.line,
      head: def.head,
      thread: def.thread.filter((t) => t.speaker !== 'echo'),
      echoes,
      continuation: def.continuation,
      type: def.head.tags.find((t) => !RESERVED_TAG.test(t)) ?? null, // head entry only (§6.6)
      status: statusTag === '#m/resolved' ? 'resolved' : 'open',
      multi: allTags.includes('#m/multi'),
      page,
      targets: bound.map((r) => r.binding === 'highlight'
        ? { kind: 'highlight', text: r.highlight.text, line: r.highlight.line, start: r.highlight.start, end: r.highlight.end }
        : { kind: 'point', line: r.line, start: r.start }),
      orphan: bound.length === 0,
      stale,
    });
    if (bound.length === 0)
      lint('ORPHAN', 'warn', def.line, page
        ? `page note [^${label}] has no reference — invisible in every rendered view; ` +
          `fix re-inserts its ref on the marker line`
        : `definition [^${label}] has no reference — invisible in every rendered view; ` +
          `re-anchor it or park it under '## Orphaned marginalia'`, page);
  }
  for (const r of refs)
    if (!defs.has(r.label))
      lint('DANGLING', 'warn', r.line,
        `ref [^${r.label}] has no definition — renders as literal text; scaffold a ` +
        `definition with placeholder text or remove the ref`);

  // Section page notes (§7.5 Form B): synthetic labels page-<n> in document
  // order — an address, never written to the file. No ref, so never orphaned,
  // never bound, never stale; #m/page is implied by the section.
  sectionItems.forEach((it, ix) => {
    const label = `page-${ix + 1}`;
    const nonEcho = [it.head, ...it.thread.filter((t) => t.speaker !== 'echo')];
    const statusTag = nonEcho.flatMap((e) => e.tags.filter((t) => STATUS_TAGS.includes(t))).pop();
    const echoes = it.thread.filter((t) => t.speaker === 'echo').map((t) => t.body);
    if (echoes.length)
      lint('PAGE-ECHO', 'warn', it.line, `page note ${label} carries echo items — page notes have no quote`);
    annotations.push({
      label,
      form: 'section',
      line: it.line,
      head: it.head,
      thread: nonEcho.slice(1),
      echoes,
      continuation: it.continuation,
      type: it.head.tags.find((t) => !RESERVED_TAG.test(t)) ?? null,
      status: statusTag === '#m/resolved' ? 'resolved' : 'open',
      multi: false,
      page: true,
      targets: [],
      orphan: false,
      stale: false,
    });
  });
  annotations.sort((a, b) => a.line - b.line);

  // pageSections: the section extents (1-based, endLine inclusive of trailing
  // blank lines — the line before the terminator) and their item counts.
  // marker: where page-note refs live (1-based; one past the last line when
  // the body is empty) and whether that line already is a marker line
  const pageSectionsOut = sections.map((s, si) =>
    ({ startLine: s.start + 1, endLine: s.end, items: sectionItems.filter((it) => it.section === si).length }));
  return { highlights, refs, quicks, annotations, defBlocks, pageSections: pageSectionsOut,
    marker: { line: marker.index + 1, present: marker.present }, lints, text, starts };
}

// ------------------------------------------------------------------- cuts --
// One span set drives strip, flatten, and the WADM anchoring stream. The
// page-notes section (§7.5 Form B) is machinery like a definition block and
// goes with the cuts; flatten keeps it (it is already flat).
function computeCuts(model, { fences = false, keepSections = false } = {}) {
  const { text, starts, defBlocks, refs, quicks, annotations } = model;
  const cuts = [];
  for (const r of refs) cuts.push([r.start, r.end]);
  for (const q of quicks) if (q.owner) cuts.push([q.start, q.end]);
  for (const b of keepSections ? defBlocks : [...defBlocks, ...model.pageSections]) {
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
export function strip(model, cutOpts = {}) {
  const cuts = computeCuts(model, cutOpts);
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
// A page-notes section stays where it is — already flat, already readable.
export function flatten(model) {
  const body = strip(model, { keepSections: true });
  const anns = model.annotations.filter((a) => a.form !== 'section');
  const quicksOwned = model.quicks.filter((q) => q.owner);
  if (!anns.length && !quicksOwned.length) return body;
  const out = [body.trimEnd(), '', '## Marginalia', ''];
  if (/^## Marginalia$/m.test(body))
    process.stderr.write('warning: input already contains a "## Marginalia" heading\n');
  // page notes first (§7.5), in document order; they carry no quote line
  const ordered = [...anns.filter((a) => a.page), ...anns.filter((a) => !a.page)];
  for (const a of ordered) {
    if (!a.page) {
      const quotes = a.targets.filter((t) => t.kind === 'highlight').map((t) => t.text);
      const q = quotes.length ? quotes : a.echoes;
      for (const quote of q) out.push(`> ${quote}`);
      if (!q.length) {
        const t = a.targets.find((x) => x.kind === 'point');
        if (t) {
          const line = model.text.split('\n')[t.line - 1] ?? '';
          const clean = line.replace(new RegExp(`\\[\\^${LABEL}\\]`, 'g'), '')
            .replace(/^\s*#+ /, '').replace(/==/g, '').trim().slice(0, 80);
          out.push(`> near: ${clean}`);
        }
      }
      out.push('>');
    }
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
    // a page note targets the whole resource — no selector (§12); a section
    // note (id <path>#page-<n>) has no ref to orphan; a point annotation's
    // position is an anchoring-stream offset, like the quote context
    target: !a.targets.length && a.form !== 'section' ? { source, 'marginalia:orphan': true, ...(a.echoes.length ? { 'marginalia:echo': a.echoes } : {}) }
      : a.page ? [{ source }]
      : a.targets.map((t) => ({
        source,
        selector: t.kind === 'highlight' ? selectorFor(t)
          : { type: 'TextPositionSelector', start: toStreamPos(model, t.start), end: toStreamPos(model, t.start) },
      })),
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
export function fix(input, opts = {}) {
  let model = parse(input, opts);
  let lines = model.text.split('\n');
  const inSection = (i) => model.pageSections.some((s) => i >= s.startLine - 1 && i < s.endLine);
  // line-based fixes, bottom-up
  for (const l of [...model.lints].sort((a, b) => b.line - a.line)) {
    const i = l.line - 1;
    if (l.rule === 'T-BULLET' && inSection(i)) {
      lines[i] = lines[i].replace(/^([ \t]*)[-*+] /, '$1- '); // a page-note bullet keeps its indent
    } else if (l.rule === 'T1' || l.rule === 'T-BULLET') {
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
  model = parse(text, opts);
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
  // page notes (§7.5): every ref of a #m/page definition belongs on the
  // marker line — relocate strays (PAGE-PLACE/PAGE-BIND), re-insert orphans
  text = placePageRefs(parse(text, opts), opts);
  // L3 normalize: sequential labels are transients — relabel to random
  model = parse(text, opts);
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

// Move every ref of a #m/page definition onto the marker line — reusing the
// existing marker line or inserting one before the first body line (after a
// leading page-notes section, P11) — and re-insert the ref of an orphaned page
// note (§7.5 P4: the one mechanical orphan repair). Returns the edited text.
function placePageRefs(model, opts = {}) {
  // footnote form only: a section note has no ref, and its synthetic label
  // is never written to the file (§7.5 P10)
  const pages = model.annotations.filter((a) => a.page && a.form === 'footnote');
  if (!pages.length) return model.text;
  const labels = new Set(pages.map((a) => a.label));
  const onMarker = (r) => model.marker.present && r.line === model.marker.line;
  const strays = model.refs.filter((r) => labels.has(r.label) && !onMarker(r));
  const placed = new Set(model.refs.filter((r) => labels.has(r.label) && onMarker(r)).map((r) => r.label));
  const missing = pages.map((a) => a.label).filter((l) => !placed.has(l));
  if (!strays.length && !missing.length) return model.text;
  let text = model.text;
  for (const r of [...strays].sort((a, b) => b.start - a.start))
    text = text.slice(0, r.start) + text.slice(r.end);
  const lines = text.split('\n');
  // a stray's line left blank by the removal (a misplaced marker line) goes too
  for (const i of [...new Set(strays.map((r) => r.line - 1))].sort((a, b) => b - a)) {
    if (lines[i].trim() !== '') continue;
    lines.splice(i, 1);
    if (i > 0 && i < lines.length && lines[i - 1].trim() === '' && lines[i].trim() === '') lines.splice(i, 1);
  }
  if (missing.length) {
    // parsed (fence-masked) section extents: a raw scan would let a heading
    // or marker-shaped line inside a code fence end the section early
    const marker = markerLine(lines, parse(lines.join('\n'), opts).pageSections.map((s) => ({ start: s.startLine - 1, end: s.endLine })));
    const refsText = missing.map((l) => `[^${l}]`).join('');
    if (marker.present) lines[marker.index] = lines[marker.index].trimEnd() + refsText;
    else {
      // a line of its own (P2): pad with a blank when the previous line is
      // content, or the ref would lazily continue a list item / paragraph
      const prev = marker.index > 0 ? lines[marker.index - 1] : '';
      const pad = prev.trim() !== '' && !/^(?:---|\.\.\.)$/.test(prev) && !prev.includes('%%') ? [''] : [];
      lines.splice(marker.index, 0, ...pad, refsText, '');
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------- extract --
// Human-readable digest: one line per annotation with its anchor kind — the
// quoted highlight(s), (point), (page) for a page note in either form, or
// (unanchored) for an orphan — then its entries; quick annotations last.
export function extract(model) {
  const out = [];
  for (const a of model.annotations) {
    const quotes = a.targets.filter((t) => t.kind === 'highlight').map((t) => `"${t.text}"`).join(' + ');
    const where = a.page ? '(page)' : quotes || (a.orphan ? '(unanchored)' : '(point)');
    out.push(`[${a.status}${a.type ? ' ' + a.type : ''}] ${a.label} ${where}${a.orphan ? ' (ORPHAN)' : ''}${a.stale ? ' (stale echo)' : ''}`);
    out.push(`  ${entryLine(a.head)}`);
    for (const c of a.continuation) if (c.trim()) out.push(`  ${c}`);
    for (const t of a.thread) out.push(`    - ${entryLine(t)}`);
  }
  for (const q of model.quicks.filter((q) => q.owner))
    out.push(`[quick] "${q.owner.text}" — ${q.note}`);
  return out;
}

// ---------------------------------------------------------------- helpers --
function entryLine(e) {
  const head = [e.speaker, e.stamp ? `(${e.stamp})` : null].filter(Boolean).join(' ');
  return head ? `${head}: ${e.body}` : e.body;
}

// -------------------------------------------------------------------- cli --
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const argv = process.argv.slice(2);
  const force = argv.includes('--force');
  const args = [], opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--force') continue;
    if (argv[i] === '--page-heading') { opts.pageHeading = argv[++i]; continue; }
    args.push(argv[i]);
  }
  const [cmd, file] = args;
  if (!cmd || !file || (('pageHeading' in opts) && !opts.pageHeading)) {
    console.error('usage: node marginalia.mjs <parse|lint|extract|fix|strip|flatten|wadm> <file.md> [--force] [--page-heading <text>]');
    process.exit(2);
  }
  const text = readFileSync(file, 'utf8');
  const model = parse(text, opts);
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
    for (const l of extract(model)) console.log(l);
  } else if (cmd === 'fix') {
    process.stdout.write(fix(text, opts));
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

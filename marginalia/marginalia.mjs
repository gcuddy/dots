#!/usr/bin/env node
// marginalia.mjs — reference parser + CLI for the Marginalia spec (1.0-rc1).
// Dependency-free, Node >= 18. This file is the normative extractor: the
// grep patterns in SPEC.md §11 are lossy helpers; this is the contract.
//
//   node marginalia.mjs lint    notes.md
//   node marginalia.mjs parse   notes.md
//   node marginalia.mjs extract notes.md
//   node marginalia.mjs strip   notes.md
//   node marginalia.mjs flatten notes.md
//   node marginalia.mjs wadm    notes.md
//
// Exit codes: lint → 1 if any error-severity finding; others → 0 on success.

import { readFileSync } from 'node:fs';

const LABEL = 'm-[a-z0-9-]+';
const REF_RE = new RegExp(`\\[\\^(${LABEL})\\]`, 'g');
const DEF_RE = new RegExp(`^\\[\\^(${LABEL})\\]:(.*)$`);
const CLOSE_PUNCT = `.,;:!?)"'»…`;
const STATUS_TAGS = ['#m/open', '#m/resolved'];
const NON_TYPE = /^#m\/(open|resolved|multi|hl\/|sync\/)/;

// ---------------------------------------------------------------- masking --
// Replace code regions (fenced blocks, inline code) with \x00 of equal length
// so offsets are preserved but no syntax matches inside them (spec H5/§11).
export function maskCode(text) {
  const lines = text.split('\n');
  let fence = null; // current fence marker, e.g. '```'
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
    // inline code: span between equal-length backtick runs on one line
    return line.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (m) => '\x00'.repeat(m.length));
  });
  return out.join('\n');
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
  const tags = [...body.matchAll(/#m\/[A-Za-z0-9/_-]+/g)].map((t) => t[0]);
  return { speaker, stamp, body, tags, headConfidence, raw };
}

// ------------------------------------------------------------------ parse --
export function parse(text, opts = {}) {
  const masked = maskCode(text);
  const starts = lineStarts(text);
  const rawLines = text.split('\n');
  const maskedLines = masked.split('\n');
  const lints = [];
  const lint = (rule, severity, line, message, fixable = false) =>
    lints.push({ rule, severity, line, message, fixable });

  // ---- definitions (line-based, on masked text to skip code blocks) ----
  const defs = new Map(); // label -> def
  for (let i = 0; i < maskedLines.length; i++) {
    const dm = maskedLines[i].match(DEF_RE);
    if (!dm) continue;
    const label = dm[1];
    const headRaw = rawLines[i].slice(rawLines[i].indexOf(']:') + 2);
    const def = {
      label, line: i + 1,
      head: parseEntry(headRaw, opts.knownSpeakers),
      thread: [], continuation: [], endLine: i + 1,
    };
    // E1: definition-line body must be non-empty and contain a space
    const bodyTrim = headRaw.trim();
    if (bodyTrim === '' || !/\s/.test(bodyTrim))
      lint('E1', 'error', i + 1,
        `definition [^${label}] body must be non-empty and contain at least one space ` +
        `(strict-CommonMark link-ref trap / pandoc paragraph-swallow)`);
    if (/(^|[^\w@])@[a-z][\w-]*/i.test(headRaw))
      lint('E2', 'warn', i + 1, `bare @name in definition (pandoc rewrites it as a citation)`);
    if (headRaw.includes('%%'))
      lint('E3', 'warn', i + 1, `%%…%% in definition leaks visibly outside Obsidian`);
    if (i > 0 && rawLines[i - 1].trim() !== '' && !maskedLines[i - 1].match(DEF_RE))
      lint('E6', 'warn', i + 1,
        `no blank line before definition [^${label}] (pandoc lazily joins it into the paragraph above)`);
    if (/^m-\d+$/.test(label))
      lint('L3', 'info', i + 1,
        `sequential label [^${label}] is a transient — relabel to a random label for durability`);
    if (defs.has(label))
      lint('L4', 'error', i + 1,
        `duplicate definition for [^${label}] (renderers disagree on which body wins)`);

    // gather thread items + continuations
    let j = i + 1;
    while (j < rawLines.length) {
      const l = rawLines[j];
      const threadM = l.match(/^(?: {4}|\t)- (.*)$/);
      const shallowM = l.match(/^( {1,3})- /);
      if (threadM) {
        def.thread.push({ ...parseEntry(threadM[1], opts.knownSpeakers), line: j + 1 });
        def.endLine = j + 1;
      } else if (shallowM && def.thread.length + def.continuation.length >= 0 && l.trim().startsWith('- ')) {
        lint('T1', 'error', j + 1,
          `thread reply indented ${shallowM[1].length} space(s) — must be 4 (or tab); ` +
          `shallow indents silently detach the thread into body text`, true);
        def.thread.push({ ...parseEntry(l.replace(/^ +- /, ''), opts.knownSpeakers), line: j + 1, detached: true });
        def.endLine = j + 1;
      } else if (/^(?: {4}|\t)\S/.test(l)) {
        def.continuation.push(l.replace(/^(?: {4}|\t)/, ''));
        def.endLine = j + 1;
      } else if (l.trim() === '') {
        // blank: continuation only if the next non-blank line is indented
        let k = j + 1;
        while (k < rawLines.length && rawLines[k].trim() === '') k++;
        if (k < rawLines.length && /^(?: {4}|\t)/.test(rawLines[k])) { j = k - 1 + 1; def.endLine = j; j++; continue; }
        break;
      } else break;
      j++;
    }
    defs.set(label, defs.get(label) ?? def); // first def wins for the model; dupes already linted
  }

  // ---- highlights (offset-based, masked) ----
  const highlights = [];
  const HL_RE = /==((?:[^=\n]|=(?!=))+?)==/g;
  let hm;
  while ((hm = HL_RE.exec(masked)) !== null) {
    const start = hm.index, end = hm.index + hm[0].length;
    const inner = text.slice(start + 2, end - 2);
    const ln = lineOf(starts, start);
    // skip highlights on definition lines' label part? none possible; keep all
    if (/^\s|\s$/.test(inner))
      lint('H3', 'warn', ln,
        `highlight has inner-edge whitespace ("==${inner}==") — renders in Obsidian only, ` +
        `leaks literal == elsewhere`, true);
    highlights.push({ text: inner, start, end, line: ln, refs: [], quick: null });
  }

  const hlByEnd = new Map(highlights.map((h) => [h.end, h]));

  // ---- refs & binding (offset-based, masked) ----
  const refs = [];
  let rm;
  REF_RE.lastIndex = 0;
  while ((rm = REF_RE.exec(masked)) !== null) {
    const ln = lineOf(starts, rm.index);
    // a def line's own head token is not a ref
    if (maskedLines[ln - 1].match(DEF_RE) && starts[ln - 1] === rm.index) continue;
    refs.push({ label: rm[1], start: rm.index, end: rm.index + rm[0].length, line: ln, binding: 'point', highlight: null });
  }
  for (const ref of refs) {
    // walk backwards over any earlier refs in a stack, then punctuation/space
    let i = ref.start;
    let sawSpace = false, sawPunct = false;
    for (;;) {
      // previous ref in the stack?
      const prevRef = refs.find((r) => r.end === i);
      if (prevRef) { i = prevRef.start; continue; }
      if (i > 0 && CLOSE_PUNCT.includes(text[i - 1])) { sawPunct = true; i--; continue; }
      if (i > 0 && (text[i - 1] === ' ' || text[i - 1] === '\t')) { sawSpace = true; i--; continue; }
      break;
    }
    const hl = hlByEnd.get(i);
    if (hl && !sawSpace) {
      ref.binding = 'highlight'; ref.highlight = hl; hl.refs.push(ref.label);
      if (sawPunct)
        lint('BIND-PUNCT', 'info', ref.line,
          `ref [^${ref.label}] separated from == by punctuation — accepted, normalize to tight form`, true);
    } else if (hl && sawSpace && !sawPunct) {
      // §5.1 rule 4: whitespace-only gap = mis-normalized highlight annotation
      ref.binding = 'highlight'; ref.highlight = hl; hl.refs.push(ref.label);
      lint('BIND-SPACE', 'warn', ref.line,
        `ref [^${ref.label}] separated from == by whitespace — mis-normalized highlight ` +
        `annotation (not a point annotation); remove the gap`, true);
    }
  }

  // ---- quick annotations ^[...] ----
  const QUICK_RE = /\^\[((?:[^\]\\\n]|\\.)*)\]/g;
  let qm;
  while ((qm = QUICK_RE.exec(masked)) !== null) {
    const hl = hlByEnd.get(qm.index);
    const ln = lineOf(starts, qm.index);
    const note = text.slice(qm.index + 2, qm.index + qm[0].length - 1);
    if (hl) {
      if (hl.quick !== null || hl.refs.length)
        lint('Q1', 'error', ln,
          `stacked annotations with an inline footnote on one highlight — pandoc destroys ` +
          `adjacent ^[..] stacks; promote to labeled refs`);
      else hl.quick = note;
    }
    if (masked[qm.index + qm[0].length] === '^' && masked[qm.index + qm[0].length + 1] === '[')
      lint('Q1', 'error', ln, `adjacent inline footnotes ^[a]^[b] — destroyed by pandoc`);
  }

  // ---- assemble annotations ----
  const annotations = [];
  const referenced = new Set(refs.map((r) => r.label));
  for (const [label, def] of defs) {
    const bound = refs.filter((r) => r.label === label);
    const allEntries = [def.head, ...def.thread];
    const allTags = allEntries.flatMap((e) => e.tags);
    const statusTag = allEntries.flatMap((e) => e.tags.filter((t) => STATUS_TAGS.includes(t))).pop();
    const echoes = def.thread.filter((t) => t.speaker === 'echo').map((t) => t.body);
    const segments = bound.filter((r) => r.binding === 'highlight');
    if (segments.length > 1 && !allTags.includes('#m/multi'))
      lint('M1', 'warn', def.line,
        `label [^${label}] bound to ${segments.length} highlights without #m/multi — ` +
        `accidental label reuse, or declare it multi-segment`);
    annotations.push({
      label,
      line: def.line,
      head: def.head,
      thread: def.thread.filter((t) => t.speaker !== 'echo'),
      echoes,
      continuation: def.continuation,
      type: allEntries.flatMap((e) => e.tags).find((t) => !NON_TYPE.test(t)) ?? null,
      status: statusTag === '#m/resolved' ? 'resolved' : 'open',
      multi: allTags.includes('#m/multi'),
      targets: bound.map((r) => r.binding === 'highlight'
        ? { kind: 'highlight', text: r.highlight.text, line: r.highlight.line, start: r.highlight.start, end: r.highlight.end }
        : { kind: 'point', line: r.line, start: r.start }),
      orphan: bound.length === 0,
      stale: echoes.length && segments.length
        ? !segments.some((s, ix) => norm(s.highlight.text) === norm(echoes[Math.min(ix, echoes.length - 1)] ?? ''))
        : false,
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

  return { highlights, refs, annotations, lints, text };
}

const norm = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();

// ------------------------------------------------------------------ strip --
// Clean copy: highlights stay, all annotation machinery goes.
export function strip(model) {
  const dead = new Set();
  for (const a of model.annotations) for (let l = a.line - 1; l <= lastDefLine(model, a); l++) dead.add(l);
  const cuts = [
    ...model.refs.map((r) => [r.start, r.end]),
    ...quickSpans(model),
  ].sort((x, y) => y[0] - x[0]);
  let text = model.text;
  for (const [s, e] of cuts) text = text.slice(0, s) + text.slice(e);
  // drop deep-link block anchors whose label belongs to a stripped annotation
  const labels = new Set(model.annotations.map((a) => a.label));
  const kept = text.split('\n')
    .filter((_, i) => !dead.has(i))
    .map((l) => l.replace(new RegExp(` \\^(${LABEL})$`), (m, lb) => (labels.has(lb) ? '' : m)));
  return collapseBlanks(kept).join('\n');
}

// ---------------------------------------------------------------- flatten --
// Refs out; annotations to a readable '## Marginalia' section.
export function flatten(model) {
  const body = strip(model);
  if (!model.annotations.length) return body;
  const out = [body.trimEnd(), '', '## Marginalia', ''];
  for (const a of model.annotations) {
    const quotes = a.targets.filter((t) => t.kind === 'highlight').map((t) => t.text);
    const q = quotes.length ? quotes : a.echoes;
    for (const quote of q) out.push(`> ${quote}`);
    if (q.length) out.push('>');
    out.push(`> — ${entryLine(a.head)}`);
    for (const t of a.thread) out.push(`>   - ${entryLine(t)}`);
    out.push('');
  }
  return out.join('\n');
}

// ------------------------------------------------------------------- wadm --
export function wadm(model, source = 'file:notes.md') {
  const ctx = 'http://www.w3.org/ns/anno.jsonld';
  return model.annotations.map((a) => ({
    '@context': ctx,
    type: 'Annotation',
    id: `${source}#${a.label}`,
    motivation: a.type === '#m/q' ? 'questioning' : 'commenting',
    ...(a.status === 'resolved' ? { 'marginalia:status': 'resolved' } : {}),
    body: [a.head, ...a.thread].filter((e) => e.body?.trim()).map((e) => ({
      type: 'TextualBody', format: 'text/markdown', value: e.body,
      ...(e.speaker ? { creator: e.speaker } : {}),
      ...(e.stamp ? { created: e.stamp } : {}),
    })),
    target: a.targets.length ? a.targets.map((t) => ({
      source,
      selector: t.kind === 'highlight' ? {
        type: 'TextQuoteSelector',
        exact: t.text,
        prefix: model.text.slice(Math.max(0, t.start - 32), t.start),
        suffix: model.text.slice(t.end, t.end + 32),
      } : { type: 'TextPositionSelector', start: t.start, end: t.start },
    })) : { source, 'marginalia:orphan': true, ...(a.echoes.length ? { 'marginalia:echo': a.echoes } : {}) },
  }));
}

// ---------------------------------------------------------------- helpers --
function lastDefLine(model, a) {
  // definition block extent: from def line to last thread/continuation line
  const raw = model.text.split('\n');
  let i = a.line; // a.line is 1-based def line; scan forward like the parser
  while (i < raw.length && (/^(?: {1,4}|\t)- /.test(raw[i]) || /^(?: {4}|\t)\S/.test(raw[i]) ||
        (raw[i].trim() === '' && /^(?: {4}|\t)/.test(raw[i + 1] ?? '')))) i++;
  return i - 1;
}
function quickSpans(model) {
  const spans = [];
  const masked = maskCode(model.text);
  const QUICK_RE = /\^\[(?:[^\]\\\n]|\\.)*\]/g;
  let m;
  while ((m = QUICK_RE.exec(masked)) !== null)
    if (model.highlights.some((h) => h.end === m.index)) spans.push([m.index, m.index + m[0].length]);
  return spans;
}
function collapseBlanks(lines) {
  const out = [];
  for (const l of lines) {
    if (l.trim() === '' && out[out.length - 1]?.trim() === '') continue;
    out.push(l);
  }
  return out;
}
function entryLine(e) {
  const head = [e.speaker, e.stamp ? `(${e.stamp})` : null].filter(Boolean).join(' ');
  return head ? `${head}: ${e.body}` : e.body;
}

// -------------------------------------------------------------------- cli --
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) {
  const [cmd, file] = process.argv.slice(2);
  if (!cmd || !file) {
    console.error('usage: node marginalia.mjs <parse|lint|extract|strip|flatten|wadm> <file.md>');
    process.exit(2);
  }
  const text = readFileSync(file, 'utf8');
  const model = parse(text);
  if (cmd === 'parse') {
    const { text: _t, ...rest } = model;
    console.log(JSON.stringify(rest, (k, v) => (k === 'highlight' ? undefined : v), 2));
  } else if (cmd === 'lint') {
    for (const l of model.lints)
      console.log(`${file}:${l.line} [${l.severity}] ${l.rule}: ${l.message}${l.fixable ? ' (fixable)' : ''}`);
    const errors = model.lints.filter((l) => l.severity === 'error').length;
    console.log(`${model.annotations.length} annotation(s), ${model.highlights.length} highlight(s), ` +
      `${errors} error(s), ${model.lints.length - errors} other finding(s)`);
    process.exit(errors ? 1 : 0);
  } else if (cmd === 'extract') {
    for (const a of model.annotations) {
      const quotes = a.targets.filter((t) => t.kind === 'highlight').map((t) => `"${t.text}"`).join(' + ');
      console.log(`[${a.status}${a.type ? ' ' + a.type : ''}] ${a.label} ${quotes || '(point)'}${a.orphan ? ' (ORPHAN)' : ''}${a.stale ? ' (stale echo)' : ''}`);
      console.log(`  ${entryLine(a.head)}`);
      for (const t of a.thread) console.log(`    - ${entryLine(t)}`);
    }
    for (const h of model.highlights.filter((h) => h.quick !== null))
      console.log(`[quick] "${h.text}" — ${h.quick}`);
  } else if (cmd === 'strip') {
    process.stdout.write(strip(model) + '\n');
  } else if (cmd === 'flatten') {
    process.stdout.write(flatten(model) + '\n');
  } else if (cmd === 'wadm') {
    console.log(JSON.stringify(wadm(model, `file:${file}`), null, 2));
  } else {
    console.error(`unknown command: ${cmd}`);
    process.exit(2);
  }
}

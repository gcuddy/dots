#!/usr/bin/env node
// test.mjs — regression tests for marginalia.mjs. Every case here encodes a
// defect found during adversarial review; run `node test.mjs` (exit 0 = pass).
import { parse, strip, flatten, wadm, fix } from './marginalia.mjs';

let failures = 0;
const t = (name, cond, extra = '') => {
  if (!cond) { failures++; console.error(`FAIL ${name}${extra ? ' — ' + extra : ''}`); }
  else console.log(`ok   ${name}`);
};
const lintRules = (m) => m.lints.map((l) => l.rule);
const hasLint = (m, rule, sev) => m.lints.some((l) => l.rule === rule && (!sev || l.severity === sev));

// --- basics ---------------------------------------------------------------
{
  const m = parse('A ==bright idea==[^m-a1b2] here.\n\n[^m-a1b2]: gus (2026-08-31): nice one #m/q\n');
  t('basic: one annotation, bound', m.annotations.length === 1 && m.annotations[0].targets[0].kind === 'highlight');
  t('basic: head parsed', m.annotations[0].head.speaker === 'gus' && m.annotations[0].head.stamp === '2026-08-31');
  t('basic: type from head', m.annotations[0].type === '#m/q');
  t('basic: no lints', m.lints.length === 0, JSON.stringify(m.lints));
}

// --- blocker: CRLF files must parse identically ---------------------------
{
  const lf = 'A ==x==[^m-c1d2] here.\n\n[^m-c1d2]: gus: a note here #m/q\n    - claude: reply\n';
  const crlf = lf.replace(/\n/g, '\r\n');
  const m = parse(crlf);
  t('crlf: definition recognized', m.annotations.length === 1);
  t('crlf: thread parsed', m.annotations[0].thread.length === 1);
  t('crlf: strip drops definition', !strip(m).includes('a note here'));
}

// --- blocker: 5-space reply stays in block; strip must not leak -----------
{
  const m = parse('A ==x==[^m-e3] here.\n\n[^m-e3]: gus: head note here #m/q\n     - claude: PRIVATE five-space reply\n    - gus: four-space reply #m/resolved\n');
  t('indent5: reply captured', m.annotations[0].thread.length === 2, JSON.stringify(m.annotations[0].thread));
  t('indent5: lint fires', hasLint(m, 'T1', 'warn'));
  t('indent5: status from later reply', m.annotations[0].status === 'resolved');
  const s = strip(m);
  t('indent5: strip leaks nothing', !s.includes('PRIVATE') && !s.includes('four-space'));
}

// --- blocker: blank line between head and thread (Prettier shape) ---------
{
  const m = parse('A ==x==[^m-f4] here.\n\n[^m-f4]: gus: head note here #m/q\n\n    - echo: x\n    - claude: first reply\n');
  t('blankline: echo captured', m.annotations[0].echoes.length === 1, JSON.stringify(m.annotations[0].echoes));
  t('blankline: reply captured', m.annotations[0].thread.length === 1);
  t('blankline: strip clean', !strip(m).includes('first reply'));
}

// --- blocker: multi-paragraph continuation kept everywhere ----------------
{
  const m = parse('A ==x==[^m-g5] here.\n\n[^m-g5]: gus: first paragraph here #m/q\n\n    Second paragraph FIRST line.\n    Second paragraph second line.\n');
  t('cont: both lines captured', m.annotations[0].continuation.join(' ').includes('FIRST line') &&
    m.annotations[0].continuation.join(' ').includes('second line'), JSON.stringify(m.annotations[0].continuation));
  t('cont: flatten emits continuation', flatten(m).includes('FIRST line'));
  t('cont: wadm emits continuation', JSON.stringify(wadm(m)).includes('FIRST line'));
  t('cont: strip clean', !strip(m).includes('FIRST line'));
}

// --- blocker: quick notes with wikilinks (balanced brackets) --------------
{
  const m = parse('A ==term==^[see [[Korzybski]] for the source] here.\n');
  t('quick: balanced brackets', m.highlights[0].quick === 'see [[Korzybski]] for the source', m.highlights[0].quick);
  const s = strip(m);
  t('quick: strip leaves no debris', s.trim() === 'A ==term== here.', JSON.stringify(s));
}

// --- blocker: flatten keeps quick annotations -----------------------------
{
  const m = parse('A ==Black Swan==^[a term of art, not a bird] here.\n');
  t('quickflatten: note survives flatten', flatten(m).includes('term of art'));
  t('quickwadm: note in wadm', JSON.stringify(wadm(m)).includes('term of art'));
}

// --- major: E1 link-title shapes ------------------------------------------
{
  const m1 = parse('==x==[^m-h6]\n\n[^m-h6]: nice (agreed)\n');
  t('e1: token+(title) flagged', hasLint(m1, 'E1', 'error'));
  const m2 = parse('==x==[^m-h7]\n\n[^m-h7]: see "chapter 9"\n');
  t('e1: token+"title" flagged', hasLint(m2, 'E1', 'error'));
  const m3 = parse('==x==[^m-h8]\n\n[^m-h8]: gus: nice (agreed)\n');
  t('e1: speaker head defuses', !hasLint(m3, 'E1'));
  const m4 = parse('==x==[^m-h9]\n\n[^m-h9]: #m/todo\n');
  t('e1: single token flagged', hasLint(m4, 'E1', 'error'));
}

// --- major: Q1 mixed forms ------------------------------------------------
{
  const m1 = parse('==beta==^[quick][^m-j1] x.\n\n[^m-j1]: gus: labeled note here\n');
  t('mix: quick-then-ref lints Q1', hasLint(m1, 'Q1', 'error'));
  t('mix: ref still binds to highlight', m1.refs[0].binding === 'highlight');
  const m2 = parse('==gamma==[^m-j2]^[quick] x.\n\n[^m-j2]: gus: labeled note here\n');
  t('mix: ref-then-quick lints Q1', hasLint(m2, 'Q1', 'error'));
  t('mix: quick reaches model', m2.quicks.length === 1 && m2.quicks[0].owner !== null);
  t('mix: strip removes the quick', !strip(m2).includes('quick'));
}

// --- major: near-miss labels ----------------------------------------------
{
  const m = parse('==x==[^m-Q4] y.\n\n[^m-Q4]: gus (2026-08-31): invisible to the toolchain?\n');
  t('nearmiss: lint fires', hasLint(m, 'NEAR-MISS', 'error'));
}

// --- major: indented code blocks masked -----------------------------------
{
  const m = parse('Example syntax:\n\n    ==x==[^m-code1] in a code block\n    [^m-code1]: not a real definition\n\nProse after.\n');
  t('indentcode: no phantom highlight', m.highlights.length === 0, JSON.stringify(m.highlights));
  t('indentcode: no phantom lints', m.lints.length === 0, JSON.stringify(m.lints));
  t('indentcode: strip untouched', strip(m).includes('==x==[^m-code1] in a code block'));
}

// --- major: lazy continuation after definition ----------------------------
{
  const m = parse('==x==[^m-k3] y.\n\n[^m-k3]: gus: the note starts here\nand lazily continues here.\n\nReal prose.\n');
  t('lazy: lint fires', hasLint(m, 'LAZY', 'error'));
  const s = strip(m, true);
  t('lazy: strip removes joined line', !strip(m).includes('lazily continues'));
  t('lazy: real prose kept', strip(m).includes('Real prose.'));
}

// --- major: punctuation + space gap binds with lint -----------------------
{
  const m = parse('==x==. [^m-l4] y.\n\n[^m-l4]: gus: gap note here\n');
  t('gap: mixed punct+space binds', m.refs[0].binding === 'highlight');
  t('gap: lint fires', hasLint(m, 'BIND-SPACE', 'warn'));
  const m2 = parse('==x==”[^m-l5] y.\n\n[^m-l5]: gus: curly quote note\n');
  t('gap: curly quote binds', m2.refs[0].binding === 'highlight');
}

// --- major: duplicate defs — strip removes both blocks --------------------
{
  const m = parse('==x==[^m-n6] y.\n\n[^m-n6]: gus: first version here\n[^m-n6]: claude: second version here\n');
  t('dupe: L4 error', hasLint(m, 'L4', 'error'));
  const s = strip(m);
  t('dupe: strip removes both', !s.includes('first version') && !s.includes('second version'));
}

// --- major: echo excluded from status/type; per-segment staleness ---------
{
  const m = parse('==see #m/resolved for details==[^m-p7] y.\n\n[^m-p7]: gus: open question here #m/q\n    - echo: see #m/resolved for details\n');
  t('echo: tag in echo ignored', m.annotations[0].status === 'open');
  const m2 = parse('==spandrels==[^m-p8] a.\n\n==REWORDED==[^m-p8] b.\n\n[^m-p8]: gus: one move two costumes #m/multi\n    - echo: spandrels\n    - echo: byproduct argument\n');
  t('stale: one drifted segment flags', m2.annotations[0].stale === true);
  const m3 = parse('==CASE Changed==[^m-p9] a.\n\n[^m-p9]: gus: note here text\n    - echo: case changed\n');
  t('stale: case-sensitive compare', m3.annotations[0].stale === true);
}

// --- major: type from head only; open-vocabulary tags not shadowed --------
{
  const m = parse('==x==[^m-r1] y.\n\n[^m-r1]: gus: note here #m/hl/yellow\n    - claude: reply #m/ref\n');
  t('type: replies never set type', m.annotations[0].type === null);
  const m2 = parse('==x==[^m-r2] y.\n\n[^m-r2]: gus: note here #m/multiverse\n');
  t('type: #m/multiverse is a type', m2.annotations[0].type === '#m/multiverse');
  t('type: not mistaken for multi', m2.annotations[0].multi === false);
}

// --- major: wadm anchoring stream excludes machinery ----------------------
{
  const m = parse('Intro words here. ==the exact phrase==[^m-s3] tail words here.\n\n[^m-s3]: gus (2026-08-31 14:30): anchored note here\n');
  const w = wadm(m, 'file:t.md');
  const sel = w[0].target[0].selector;
  t('wadm: suffix has no ref machinery', !sel.suffix.includes('[^m-'), sel.suffix);
  t('wadm: prefix has no fences', !sel.prefix.includes('=='), sel.prefix);
  t('wadm: prefix is true neighbor text', sel.prefix.endsWith('Intro words here. '), JSON.stringify(sel.prefix));
  t('wadm: suffix is true neighbor text', sel.suffix.startsWith(' tail words here.'), JSON.stringify(sel.suffix));
  t('wadm: stamp is ISO T-form', JSON.stringify(w).includes('2026-08-31T14:30'));
  const m2 = parse('A bare ==lonely highlight== here.\n');
  t('wadm: bare highlight exported', wadm(m2).some((a) => a.motivation === 'highlighting'));
}

// --- major: multi-segment + M1 + thread bullets ---------------------------
{
  const m = parse('==a==[^m-u1] and ==b==[^m-u1].\n\n[^m-u1]: gus: spans both here\n');
  t('m1: undeclared shared label errors', hasLint(m, 'M1', 'error'));
  const m2 = parse('==a==[^m-u2] and ==b==[^m-u2].\n\n[^m-u2]: gus: spans both here #m/multi\n');
  t('m1: declared multi clean', !hasLint(m2, 'M1'));
  const m3 = parse('==x==[^m-u3] y.\n\n[^m-u3]: gus: head note here\n    * claude: star bullet reply\n');
  t('bullets: * accepted', m3.annotations[0].thread.length === 1);
  t('bullets: * linted', hasLint(m3, 'T-BULLET', 'warn'));
}

// --- fix command ----------------------------------------------------------
{
  const fixed = fix('==x ==. [^m-v1] y.\n[^m-v1]: gus: note text here\n  - claude: shallow reply\n');
  t('fix: gap tightened', fixed.includes('==x==[^m-v1].'), JSON.stringify(fixed));
  t('fix: blank line inserted before def', /y\.\n\n\[\^m-v1\]/.test(fixed), JSON.stringify(fixed));
  t('fix: reply re-indented', fixed.includes('    - claude: shallow reply'));
  const m = parse(fixed);
  t('fix: output has no errors', m.lints.filter((l) => l.severity === 'error').length === 0, JSON.stringify(m.lints));
}

// --- strip preserves author blank lines away from cuts --------------------
{
  const m = parse('Para one.\n\n\nPara two (author double blank above).\n\nA ==x==[^m-w2] y.\n\n[^m-w2]: gus: note text here\n\nPara three.\n');
  const s = strip(m);
  t('strip: intentional double blank kept', s.includes('Para one.\n\n\nPara two'));
  t('strip: no triple blank at cut', !/Para three/.test(s) || !s.includes('y.\n\n\n\nPara three'));
}

// --- point annotation + orphan + dangling ---------------------------------
{
  const m = parse('Whole paragraph is suspect.[^m-x1]\n\n[^m-x1]: gus: check the source #m/todo\n\n[^m-x2]: gus: I am orphaned text\n\nAnd a dangling one.[^m-x3]\n');
  t('point: binds as point', m.annotations.find((a) => a.label === 'm-x1').targets[0].kind === 'point');
  t('orphan: lint fires', hasLint(m, 'ORPHAN', 'warn'));
  t('dangling: lint fires', hasLint(m, 'DANGLING', 'warn'));
  t('orphan: wadm keeps body', JSON.stringify(wadm(m)).includes('I am orphaned text'));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall tests passed');
process.exit(failures ? 1 : 0);

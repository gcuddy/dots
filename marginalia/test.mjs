#!/usr/bin/env node
// test.mjs — regression tests for marginalia.mjs. Every case here encodes a
// defect found during adversarial review; run `node test.mjs` (exit 0 = pass).
import { readFileSync } from 'node:fs';
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

// --- major: M2/MULTI-STALE — declared multi lost a segment ----------------
// The exact drift scenario: first segment of a 2-segment multi deleted by an
// edit. The survivor ("Beta") is byte-identical to its real echo but pairs
// positionally against echoes[0] ("Alpha") — set-match must suppress STALE;
// MULTI-STALE + ECHO-COUNT carry the honest signal instead.
{
  const m = parse('Keep ==Beta==[^m-y1] here.\n\n[^m-y1]: gus: spans both costumes #m/multi\n    - echo: Alpha\n    - echo: Beta\n');
  t('m2: declared multi, one segment warns', hasLint(m, 'MULTI-STALE', 'warn'));
  t('m2: echo-count still warns on loss', hasLint(m, 'ECHO-COUNT', 'warn'));
  t('m2: set-match kills spurious stale on survivor', m.annotations[0].stale === false && !hasLint(m, 'STALE'),
    JSON.stringify(m.lints));
  const m2 = parse('==a==[^m-y2] and ==b==[^m-y2].\n\n[^m-y2]: gus: spans both here #m/multi\n    - echo: a\n    - echo: b\n');
  t('m2: healthy multi clean', !hasLint(m2, 'MULTI-STALE'), JSON.stringify(m2.lints));
  const m3 = parse('[^m-y3]: gus: multi with no refs anywhere #m/multi\n    - echo: a\n    - echo: b\n');
  t('m2: zero refs stays ORPHAN territory', hasLint(m3, 'ORPHAN', 'warn') && !hasLint(m3, 'MULTI-STALE'));
  const m4 = parse('Keep ==Beta EDITED==[^m-y4] here.\n\n[^m-y4]: gus: spans both costumes #m/multi\n    - echo: Alpha\n    - echo: Beta\n');
  t('m2: genuinely edited survivor still stale', m4.annotations[0].stale === true);
}

// --- major: H4-WRAP — highlight wrapped across a soft line break ----------
{
  const m = parse('This ==wrapped highlight\nspans a soft break== in one paragraph.\n');
  t('h4wrap: wrapped pair warns', hasLint(m, 'H4-WRAP', 'warn'), JSON.stringify(m.lints));
  const m2 = parse('A ==balanced== line and ==another== one.\nSecond line ==also balanced== fine.\n');
  t('h4wrap: balanced lines clean', !hasLint(m2, 'H4-WRAP'), JSON.stringify(m2.lints));
  const m3 = parse('An odd == token here.\n\nAnother odd == token, separate block.\n');
  t('h4wrap: blank line ends the block', !hasLint(m3, 'H4-WRAP'));
  const m4 = parse('==x==[^m-y9] here.\n\n[^m-y9]: gus: note that a == b holds\n    - claude: and b == c too\n');
  t('h4wrap: definition-block lines exempt', !hasLint(m4, 'H4-WRAP'), JSON.stringify(m4.lints));
  const m5 = parse('Code case:\n\n```\n==wrapped\nacross==\n```\n\nProse after.\n');
  t('h4wrap: fenced code ignored', !hasLint(m5, 'H4-WRAP'));
  // a block-start boundary line must still be evaluated as an opener itself
  const m6 = parse('Odd == token in prose here.\n- bullet ==wrapped in a list\n  closing== continuation text.\n');
  t('h4wrap: bullet after odd line still opens its own pair', hasLint(m6, 'H4-WRAP', 'warn'), JSON.stringify(m6.lints));
  const m7 = parse('| a == b |\n| c == d |\n| e == f |\n');
  t('h4wrap: table rows excluded (no cross-row highlight exists)', !hasLint(m7, 'H4-WRAP'), JSON.stringify(m7.lints));
  const m8 = parse('Setext heading with == in it\n======\nProse == here after.\n');
  t('h4wrap: setext underline is a boundary, not an opener', !hasLint(m8, 'H4-WRAP'), JSON.stringify(m8.lints));
}

// --- stale set-match is gated on echo/segment count mismatch --------------
// With equal counts the positional pairing is trustworthy; the set fallback
// would otherwise mask a real edit that duplicates another echo's text.
{
  const m = parse('==A==[^m-z1] and ==B==[^m-z1].\n\n[^m-z1]: gus: two segments here #m/multi\n    - echo: A\n    - echo: A\n');
  t('stale gate: equal counts, edit onto duplicate text is STALE', m.annotations[0].stale === true, JSON.stringify(m.lints));
  const m2 = parse('==X==[^m-z2] and ==X==[^m-z2].\n\n[^m-z2]: gus: two segments here #m/multi\n    - echo: X\n    - echo: Y\n');
  t('stale gate: duplicate segments vs edited echo is STALE', m2.annotations[0].stale === true, JSON.stringify(m2.lints));
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

// --- page notes (§7.5): reserved-tag slot, page flag, marker line ---------
{
  const m1 = parse('[^m-pa]\n\n[^m-pa]: gus: note here #m/page #m/q\n');
  const m2 = parse('[^m-pb]\n\n[^m-pb]: gus: note here #m/q #m/page\n');
  t('page: #m/page never the type (page first)', m1.annotations[0].type === '#m/q');
  t('page: #m/page never the type (page last)', m2.annotations[0].type === '#m/q');
  t('page: flag set from head tag', m1.annotations[0].page === true && m2.annotations[0].page === true);
  t('page: marker line clean', m1.lints.length === 0 && m2.lints.length === 0, JSON.stringify(m1.lints));
  t('page: #m/pages is an ordinary type', parse('x[^m-pc]\n\n[^m-pc]: gus: note here #m/pages\n').annotations[0].type === '#m/pages');
  const m3 = parse('x[^m-pd]\n\n[^m-pd]: gus: head has no page tag\n    - gus: reply #m/page\n');
  t('page: replies never set scope', m3.annotations[0].page === false);
  t('page: model exposes the marker line', m1.marker.line === 1 && m1.marker.present === true);
}

// --- page notes: PAGE-PLACE / PAGE-BIND / PAGE-ECHO and their fixes --------
{
  const heading = '# Title[^m-pg]\n\nProse here.\n\n[^m-pg]: gus: page note here #m/page\n';
  const mh = parse(heading);
  t('page-place: ref in heading line lints info+fixable', hasLint(mh, 'PAGE-PLACE', 'info') && mh.lints.find((l) => l.rule === 'PAGE-PLACE').fixable);
  const fh = fix(heading);
  t('page-place: fix moves ref to a new marker line', fh.startsWith('[^m-pg]\n\n# Title\n'), JSON.stringify(fh));
  t('page-place: fixed file is clean', parse(fh).lints.length === 0, JSON.stringify(parse(fh).lints));
  const mid = '# Title\n\nPara one.\n\n[^m-pg]\n\nPara two.\n\n[^m-pg]: gus: page note here #m/page\n';
  const fm = fix(mid);
  t('page-place: misplaced marker line removed and blank collapsed', fm === '[^m-pg]\n\n# Title\n\nPara one.\n\nPara two.\n\n[^m-pg]: gus: page note here #m/page\n', JSON.stringify(fm));
  const bound = 'A ==span==[^m-pg] here.\n\n[^m-pg]: gus: page note here #m/page\n';
  const mb = parse(bound);
  t('page-bind: page label bound to highlight warns fixable', hasLint(mb, 'PAGE-BIND', 'warn') && mb.lints.find((l) => l.rule === 'PAGE-BIND').fixable);
  const fb = fix(bound);
  t('page-bind: fix relocates ref, highlight stays bare', fb === '[^m-pg]\n\nA ==span== here.\n\n[^m-pg]: gus: page note here #m/page\n', JSON.stringify(fb));
  const me = parse('[^m-pg]\n\n[^m-pg]: gus: page note here #m/page\n    - echo: some text\n');
  t('page-echo: echo on a page note warns', hasLint(me, 'PAGE-ECHO', 'warn'));
  t('page-echo: not fixable', !me.lints.find((l) => l.rule === 'PAGE-ECHO').fixable);
}

// --- page notes: orphan re-insert, marker stacking, %% skip ---------------
{
  const orphan = '---\nx: 1\n---\n\n# Title\n\n[^m-pg]: gus: page note here #m/page\n';
  const mo = parse(orphan);
  t('page-orphan: ORPHAN fires fixable', hasLint(mo, 'ORPHAN', 'warn') && mo.lints.find((l) => l.rule === 'ORPHAN').fixable);
  t('page-orphan: orphan flag still means no ref', mo.annotations[0].orphan === true);
  t('page-orphan: ordinary orphan stays unfixable', !parse('[^m-o1]: gus: plain orphan here\n').lints.find((l) => l.rule === 'ORPHAN').fixable);
  const fo = fix(orphan);
  t('page-orphan: fix inserts marker after frontmatter', fo === '---\nx: 1\n---\n\n[^m-pg]\n\n# Title\n\n[^m-pg]: gus: page note here #m/page\n', JSON.stringify(fo));
  const stack = '[^m-a1]\n\n[^m-a1]: gus: first page note #m/page\n\n[^m-b2]: gus: second page note #m/page\n\n# Title\n';
  const fs = fix(stack);
  t('page-stack: orphan appended to existing marker line', fs.startsWith('[^m-a1][^m-b2]\n\n[^m-a1]:'), JSON.stringify(fs));
  t('page-stack: fixed file clean', parse(fs).lints.length === 0, JSON.stringify(parse(fs).lints));
  const two = parse('[^m-a1][^m-b2]\n\n[^m-a1]: gus: first #m/page\n    - gus: done #m/resolved\n\n[^m-b2]: gus: second #m/page\n');
  t('page-stack: two page notes, independent status', two.annotations[0].status === 'resolved' && two.annotations[1].status === 'open');
  t('page-stack: both are page notes, no lints', two.annotations.every((a) => a.page) && two.lints.length === 0);
  const comment = '---\nx: 1\n---\n%% a leading\ncomment block %%\n\n# Title\n\n[^m-pg]: gus: page note here #m/page\n';
  const fc = fix(comment);
  t('page-orphan: leading %% block skipped', fc.includes('comment block %%\n\n[^m-pg]\n\n# Title'), JSON.stringify(fc));
  const bare = '[^m-pg]\n\n[^m-pg]: gus: page note here #m/page\n';
  t('page: fix is a no-op on a well-placed page note', fix(bare) === bare);
}

// --- page notes: flatten order, wadm shape, E5 round-trip -----------------
{
  const doc = 'A ==span==[^m-s1] here.\n\n[^m-s1]: gus: span note here #m/q\n\nA point.[^m-p1]\n\n[^m-p1]: gus: point note here\n\n[^m-pg]: gus (2026-09-01): page note here #m/page\n\n    Second paragraph of the page note.\n';
  const withMarker = '[^m-pg]\n\n' + doc;
  const m = parse(withMarker);
  const pg = m.annotations.find((a) => a.label === 'm-pg');
  t('page-e5: head body and continuation round-trip', pg.head.body === 'page note here #m/page' && pg.continuation.join('') === 'Second paragraph of the page note.', JSON.stringify(pg.continuation));
  const fl = flatten(m);
  const sec = fl.slice(fl.indexOf('## Marginalia'));
  t('page-flatten: page note first, no quote or near line', sec.startsWith('## Marginalia\n\n> — gus (2026-09-01): page note here #m/page\n> Second paragraph of the page note.\n\n> span\n'), JSON.stringify(sec));
  t('page-flatten: page note carries no near: line', !/near:.*page note/.test(sec));
  t('page-flatten: ordinary point keeps near:', sec.includes('> near: A point.'));
  const w = wadm(m, 'file:t.md');
  const wp = w.find((a) => a.id === 'file:t.md#m-pg');
  t('page-wadm: whole-resource target, no selector', JSON.stringify(wp.target) === '[{"source":"file:t.md"}]', JSON.stringify(wp.target));
  t('page-wadm: continuation in body', wp.body[0].value === 'page note here #m/page\nSecond paragraph of the page note.');
  const wo = wadm(parse(doc), 'file:t.md').find((a) => a.id === 'file:t.md#m-pg');
  t('page-wadm: orphaned page keeps marginalia:orphan', wo.target['marginalia:orphan'] === true && !Array.isArray(wo.target));
  t('page-strip: marker line leaves no debris', strip(m).startsWith('A ==span== here.\n\nA point.\n'), JSON.stringify(strip(m)));
}

// --- point annotations: stream offsets in wadm, near: cleanup --------------
{
  const m = parse('Intro ==hl==[^m-a] text.[^m-b]\n\n[^m-a]: gus: note a here\n\n[^m-b]: gus: note b here\n');
  const sel = wadm(m).find((a) => a.id.endsWith('#m-b')).target[0].selector;
  t('point-wadm: TextPositionSelector uses anchoring-stream offset', sel.type === 'TextPositionSelector' && sel.start === 14 && sel.end === 14, JSON.stringify(sel));
  const m2 = parse('A ==x==[^m-a] here.\n\n[^m-a]: gus: note a here\n\nSecond para.[^m-b]\n\n[^m-b]: gus: note b here\n');
  const sel2 = wadm(m2).find((a) => a.id.endsWith('#m-b')).target[0].selector;
  t('point-wadm: definition blocks before the point are not counted', sel2.start === 'A x here.\n\n\nSecond para.'.length, JSON.stringify(sel2));
  const m3 = parse('# ==Chapter== two and more[^m-n]\n\n[^m-n]: gus: note here text\n');
  t('point-flatten: near: strips heading marks and fences', flatten(m3).includes('> near: Chapter two and more\n'), JSON.stringify(flatten(m3)));
}

// --- example corpora stay clean --------------------------------------------
{
  const rn = parse(readFileSync(new URL('./examples/reading-notes.md', import.meta.url), 'utf8'));
  t('examples: reading-notes has no error/warn lints', rn.lints.every((l) => l.severity === 'info'), JSON.stringify(rn.lints));
  t('examples: reading-notes has no page notes', rn.annotations.every((a) => !a.page));
  const pn = parse(readFileSync(new URL('./examples/page-notes.md', import.meta.url), 'utf8'));
  t('examples: page-notes is lint-clean', pn.lints.length === 0, JSON.stringify(pn.lints));
  t('examples: page-notes has two page notes on the marker line', pn.annotations.filter((a) => a.page).length === 2 && pn.marker.present && pn.marker.line === 6);
  t('examples: page-notes E5 continuation kept', pn.annotations.find((a) => a.label === 'm-pgq2').continuation.length === 1);
}

// --- marker line: an unterminated %% is body, not a skipped comment block ---
{
  const doc = '%%\nnever closes\n# T\n\n[^m-pg]: gus: x y #m/page\n';
  const fixed = fix(doc);
  t('marker: unterminated %% — fix inserts the marker before it',
    fixed === '[^m-pg]\n\n%%\nnever closes\n# T\n\n[^m-pg]: gus: x y #m/page\n', JSON.stringify(fixed));
  t('marker: fixed unterminated-%% doc is clean', parse(fixed).lints.length === 0, JSON.stringify(parse(fixed).lints));
  t('marker: 4-space-indented ref line is not a marker (indented code)', !parse('    [^m-pg]\n\n[^m-pg]: gus: x y #m/page\n').marker.present);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall tests passed');
process.exit(failures ? 1 : 0);

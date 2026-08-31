# Marginalia

Annotate your `==highlights==` in plain Obsidian-flavored Markdown:

```markdown
The ==map is not the territory==[^m-7f3k] as Korzybski said.

[^m-7f3k]: gus (2026-08-31): Stronger as a claim about models. #m/q

On mobile, just: ==the quick way==^[thought goes here]
```

One rule: **an annotation is a footnote whose label starts with `m-`,
anchored to the highlight it touches.** Zero new syntax — it renders in stock
Obsidian today (native footnote hover previews and the Footnotes sidebar;
the composite forms have a live-vault checklist in SPEC.md Appendix C),
degrades to real footnotes on GitHub and pandoc, and to readable text
everywhere else.

Tag legend: `#m/q` question · `#m/todo` · `#m/def` claim · `#m/ref`
cross-reference · `#m/resolved` closes a thread · full vocabulary in SPEC §6.6.

| File | What |
|---|---|
| [`SPEC.md`](SPEC.md) | the spec: syntax, binding rules, lifecycle, verified degradation behavior, WADM mapping, prior art |
| [`marginalia.mjs`](marginalia.mjs) | reference parser + CLI (`lint` / `parse` / `extract` / `fix` / `strip` / `flatten` / `wadm`) — dependency-free, Node ≥ 18 |
| [`test.mjs`](test.mjs) | regression suite (every defect found in adversarial review, encoded) |
| [`AGENTS.md`](AGENTS.md) | contract for AI agents reading/writing annotations |
| [`PLUGIN.md`](PLUGIN.md) | Obsidian plugin implementation notes and scope |
| [`examples/`](examples/) | a valid annotated note (one deliberate non-canonical finding, as a demo), a file of deliberate violations, and the multi-renderer degradation harness |

```
node marginalia.mjs lint examples/reading-notes.md
node marginalia.mjs extract examples/reading-notes.md
node test.mjs
```

## Today, without the plugin

No Marginalia plugin exists yet — `PLUGIN.md` is the build plan. Until then:

- **Writing**: Levels 0–2 are just Obsidian markdown; everything renders in
  Reading view today. Live Preview shows definitions and `^[…]` notes as
  plain text — that's the documented native behavior, not breakage.
- **Colors**: `#m/hl/…` tags do nothing yet. A CSS snippet can restyle *all*
  highlights (`.markdown-preview-view mark, .cm-highlight { background:
  var(--color-yellow); }`); per-annotation colors need the plugin.
- **Finding things**: search `tag:#m/q` for questions, `tag:#m/todo` for
  todos; `grep -rn '\[\^m-'` finds every annotation in the vault. Note
  Obsidian tag search is note/line-granular — per-annotation queries
  (status, author, date) go through the CLI: `node marginalia.mjs extract`.
- **Publishing**: run `node marginalia.mjs strip` (or `flatten`) first —
  annotations are real footnotes and will otherwise render for your readers.

Born from an adversarial design process: 4 competing syntax designs, 12
attack reports against 6 real markdown renderers, 3 judges — unanimous
winner — then a 4-lens adversarial review of the final artifacts (two
blockers found and fixed; `test.mjs` keeps them fixed). Provenance in
`SPEC.md` §13 / Appendix D.

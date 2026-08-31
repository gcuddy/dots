# Marginalia

Annotate your `==highlights==` in plain Obsidian-flavored Markdown:

```markdown
The ==map is not the territory==[^m-7f3k] as Korzybski said.

[^m-7f3k]: gus (2026-08-31): Stronger as a claim about models. #m/q
```

One rule: **an annotation is a footnote whose label starts with `m-`,
anchored to the highlight it touches.** Zero new syntax — it renders in stock
Obsidian today (hover previews, Footnotes sidebar), degrades to real
footnotes on GitHub and pandoc, and to readable text everywhere else.

| File | What |
|---|---|
| [`SPEC.md`](SPEC.md) | the spec: syntax, binding rules, lifecycle, degradation matrix, WADM mapping, prior art |
| [`marginalia.mjs`](marginalia.mjs) | reference parser + CLI (`lint` / `parse` / `extract` / `strip` / `flatten` / `wadm`) — dependency-free, Node ≥ 18 |
| [`AGENTS.md`](AGENTS.md) | contract for AI agents reading/writing annotations |
| [`PLUGIN.md`](PLUGIN.md) | Obsidian plugin implementation notes and scope |
| [`examples/`](examples/) | a valid annotated note + a file of deliberate violations (every lint rule) |

```
node marginalia.mjs lint examples/reading-notes.md
node marginalia.mjs extract examples/reading-notes.md
```

Born from an adversarial design process: 4 competing syntax designs, 12
attack reports against 6 real markdown renderers, 3 judges — unanimous
winner, with every surviving rule earned by a demonstrated failure it
prevents. Provenance in `SPEC.md` §13 / Appendix D.

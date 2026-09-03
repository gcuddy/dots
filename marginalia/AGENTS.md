# Marginalia — agent contract

Drop this file (or its contents) wherever your AI agents look for instructions
about a vault that uses Marginalia. Full spec: `SPEC.md`. Normative tooling:
`marginalia.mjs`.

## Reading annotations

An **annotation** is a footnote whose label starts with `m-`, bound to the
`==highlight==` it touches:

```markdown
The ==map is not the territory==[^m-7f3k] as Korzybski said.

[^m-7f3k]: gus (2026-08-31): Stronger as a claim about models. #m/q
    - echo: map is not the territory
    - claude (2026-09-01): Agreed — see [[Korzybski]]. #m/ref
```

- Definition line = head entry: optional `speaker`, optional `(YYYY-MM-DD)`
  stamp, then `: body`, with `#m/…` tags. The line above reads: author gus,
  dated, body, type = question.
- Indented `- ` items (exactly 4 spaces) are thread replies, same grammar.
  A reply whose speaker is `echo` is a machine-kept snapshot of the
  highlighted text — never edit it, never treat it as commentary.
- `#m/resolved` anywhere in the thread (last status tag wins) = resolved.
  No status tag = open.
- A ref with no adjacent highlight is a point annotation (a margin note on
  that location). Several highlights sharing one label + `#m/multi` = one
  discontinuous highlight.
- `==x==^[quick note]` is a valid lightweight annotation (Level 1).

Quick lossy discovery (misses structure, false-positives inside code blocks):

```
grep -n '\[\^m-'  file.md     # refs and definitions
grep -n '^\[\^m-' file.md     # definitions only
```

Real extraction — use the reference parser, not regexes:

```
node marginalia.mjs extract file.md    # digest
node marginalia.mjs parse file.md      # JSON model
```

## Writing annotations

To annotate a highlight, do exactly this:

1. Mint a random label: `m-` + 4–6 chars of `[a-z0-9]`, lowercase (e.g.
   `m-k3f9`). Never reuse a label that exists in the file (exception below);
   never use `m-1`-style sequential labels.
2. Append `[^m-k3f9]` **immediately after** the closing `==` — no space.
   When wrapping a selection in `==…==`, keep the fences tight: no
   whitespace just inside them.
3. Add, after the paragraph (blank line before it AND after it, column 0):
   `[^m-k3f9]: yourname (YYYY-MM-DD): your comment #m/q`
4. Optionally add an echo as the first thread item (recommended for anything
   machine-written), indented exactly 4 spaces:
   `    - echo: <the exact highlighted text>`

For a **multi-segment** highlight (one comment spanning several passages):
reuse ONE label on every segment's highlight and put `#m/multi` in the
definition, with one `- echo:` item per segment in document order.

For a **page note** (a note about the whole document, not a span): put the
ref(s) on the **marker line** — a line holding only `[^m-…]` refs as the
first non-blank body line after frontmatter (append to it if it exists,
never put a ref inside a heading line) — and the definition directly
beneath it, blank line between. Put `#m/page` on the head entry only, and
write no `- echo:` item. Several page notes share the one marker line.

To reply to an existing annotation, append a thread item under its
definition, indented **exactly 4 spaces**:

```markdown
    - yourname (YYYY-MM-DD): your reply
```

To resolve: append a reply carrying `#m/resolved` and a short rationale.
Never delete refs, definitions, highlights, or `echo` items to resolve
anything.

## Hard rules

1. Definition body must never look like a CommonMark link reference:
   non-empty, at least two words, and never a single word followed only by a
   quoted or parenthesized phrase. Never `[^m-x]: #m/todo`, never `[^m-x]:`
   alone, never `[^m-x]: nice (agreed)`. A speaker head (`gus: …`) is always
   safe. (Violations make the definition vanish in strict CommonMark.)
2. Thread indent: exactly 4 spaces (or one tab), `-` bullet. 1–3-space
   indents silently detach the thread in most renderers.
3. Never stack inline footnotes (`^[a]^[b]` — pandoc destroys the stack) and
   never mix `^[…]` with labeled refs on one highlight (linted as an error:
   ambiguous model, one keystroke from the destroyed-stack case). Use
   stacked labeled refs instead: `==x==[^m-a][^m-b]`.
4. No bare `@name` and no `%%…%%` inside definitions.
5. Blank line before every definition and after the definition block.
6. Don't create highlights spanning a blank line; don't half-overlap other
   inline spans.
7. Before publishing/exporting for other readers, strip or flatten:
   `node marginalia.mjs strip file.md` / `flatten`. (Both refuse to run
   while error-severity lints are present — that is protection, not an
   obstacle; fix the errors.)
8. Never run a footnote-renumbering formatter, `pandoc -t markdown`, or
   Prettier `--prose-wrap always` over source files.

Run `node marginalia.mjs lint file.md` after writing; fix every `error` and
`warn` (mechanical ones: `node marginalia.mjs fix file.md`).

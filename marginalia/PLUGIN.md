# Marginalia — Obsidian plugin implementation notes

The format needs no plugin to function (that is the point). The plugin's job
is *polish*: nicer rendering, capture ergonomics, lifecycle commands, and the
panes. These notes encode what the adversarial review established about scope
and risk, so v1 doesn't die the Commentator death (3.5 years of beta from
fighting the renderer).

## Architecture (the two-pipeline reality)

Obsidian offers no markdown-parser hook. Every rendering feature is built
twice:

- **Live Preview**: `registerEditorExtension` with a CM6 `ViewPlugin` +
  decorations. This is the high-value half — LP is where users live, and it
  is where native rendering is weakest (inline `^[…]` shows raw; footnote
  refs in tables don't render; scattered definitions sit as visible text).
- **Reading view**: `registerMarkdownPostProcessor`. It sees only rendered
  per-section HTML (`getSectionInfo` maps back to source lines). Text nodes
  may be split; sections render lazily and out of order.

Share one model: import `parse()` from `marginalia.mjs` (it is
dependency-free by design), index the vault via `metadataCache` events, and
treat the parse model as the single source of truth for both pipelines and
all panes. **Covenant: zero state outside the .md files** — the index is a
cache, rebuildable from text, never authoritative.

## v1 scope (routine, ship in weeks)

1. **Indexer**: vault-wide parse; annotations/highlights/orphans model.
2. **LP decorations**: chip/badge over `[^m-…]` refs (hide the raw label,
   show type/status color); render `^[…]` quick notes as chips; dim/fold
   definition blocks; style `==marks==` from their annotation's `#m/hl/…`
   tag.
3. **Hover**: `HoverPopover` (public API) on refs/highlights showing the
   thread; on mobile (no hover) a tap-sheet — design this before freezing
   the interaction layer, not after.
4. **Commands**: annotate-selection (wraps `==…==`, mints random label,
   scaffolds definition with author+date auto-stamped — no human ever types
   attribution); promote quick note → labeled; reply; resolve (appends
   `#m/resolved` reply); archive (to `## Archived marginalia`, per spec
   §8.2); relabel-on-paste; normalize (tight binding, 4-space indents,
   inner-edge whitespace, sequential→random labels).
5. **Panes**: annotations sidebar (filter by type/status/author; click →
   jump); orphans pane with the §8.3 repair pipeline (echo search: exact →
   normalized → bounded fuzzy; park on failure).
6. **Lint surface**: run spec lints on save; fixables get one-click fixes.
7. **Export commands**: strip / flatten / WADM (wrap the CLI functions).
8. **Interop**: index Sidebar-Highlights-style plain `==x==[^1]` and
   `==x==^[note]` as read-only annotations; one-command upgrade to `m-`
   labels.

## Page notes: three storage modes, one sidebar

A setting decides where a NEW page note is written; reading is form-agnostic
(every form present in a file is shown and edited in place, in its own form):

- **Footnote** (spec §7.5 Form A, the default): `#m/page` definition, ref on
  the marker line. Real label, threads, status, strip/flatten/export.
- **Heading section** (Form B): a `- ` item under the reserved `## Page
  notes` heading (`pageNoteHeading` may rename it — then unconfigured tools
  read that section as prose). Items have NO label: both parsers synthesize
  `page-<n>` (n = 1-based order in the section) and **never write it to the
  file** — it is an address, not an identity. Every label-addressed write op
  (`editHead`, `addReply`, `resolveAnnotation`, `reopenAnnotation`,
  `archiveAnnotation`, `deleteAnnotation`) dispatches on that shape to the
  section item, re-found by a fresh parse + index, so a menu on a section
  card needs no special casing; but the labels are positional — deleting
  `page-1` makes the next item `page-1` — so re-read the model after every
  write and never cache a synthetic label across writes.
- **Frontmatter property** (plugin-only; spec P5 permits it): one plain
  string in `pageNoteProperty` (default `note`) — no speaker, date, type,
  thread, or status; read via `metadataCache` frontmatter, written and
  deleted via `fileManager.processFrontMatter`, never through `write.ts`.
  **It publishes with the file: `strip` never touches properties.** A
  non-string value in that property renders read-only (the sidebar never
  rewrites a hand-set list or number as prose).

The reading view and Live Preview do nothing structural for the section form
(the heading and its list render natively — that is the point of it); their
card/def-block logic keys on ref and def-block labels, which a synthetic label
never matches.

## Explicitly descoped from v1 (the Commentator-grade tail)

- **Reading-mode footnote-sequence surgery** (splitting `m-` notes out of
  the numbered footnote list and renumbering the survivors): requires
  async cross-section DOM surgery against lazily-rendered sections —
  flicker, races, fighting core. Reading view keeps native footnote
  rendering in v1; annotations simply *are* footnotes there.
- **LP table/callout ref repair**: core doesn't render footnote refs there
  in LP; working around it means reaching inside core widgets. Document the
  limitation instead (it renders fine in Reading view).
- **Suggestion/tracked-edit mode**: non-goal of the spec, and the documented
  source of Commentator's data-loss warnings.

## Live-vault verification checklist (run before building on these)

The spec was verified against six parsers but not against Obsidian's two
closed pipelines. Verify in a scratch vault (list mirrors SPEC.md App. C):

- multi-block definitions (head + 4-space `- ` thread + continuation) in
  Reading view and LP
- same-label multi-refs in both modes (hover, backrefs)
- refs in LP table cells (expected: Reading-only)
- `==x==.[^m-1]` punctuation binding in both modes
- block-id on a highlight-bearing prose paragraph: `[[#^m-…]]` resolve +
  embed
- mobile: footnote tap behavior, hover-preview absence
- `==text ==` lax form still renders (then let normalize fix it)

## Dataview / Datacore honesty

Head-entry tags live on a definition *paragraph*: Dataview indexes them at
page granularity only — "notes containing open questions", not "list the
questions". Thread replies are list items and are reachable per-item.
Per-annotation queries (author, date, status, text) go through the plugin's
index or the CLI (`parse` emits JSON precisely for this), not through
Dataview-native promises the format can't keep.

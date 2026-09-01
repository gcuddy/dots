# Marginalia

**A plain-text convention for annotating highlights in Obsidian-flavored Markdown.**

Version 1.0-rc2 · 2026-08-31 · License: CC0

```markdown
The ==map is not the territory==[^m-7f3k] as Korzybski said.

[^m-7f3k]: gus (2026-08-31): Feels stronger as a claim about models than maps. #m/q
```

Marginalia introduces **zero new syntax**. Every construct is native Obsidian
markdown — highlights, labeled footnotes, tags, block IDs — arranged under one
rule you can remember: **an annotation is a footnote whose label starts with
`m-`, anchored to the highlight it touches.** A conforming file is a conforming
Obsidian file, a conforming GFM file, and a conforming pandoc file. If every
tool that understands this spec vanishes, your annotations remain readable,
hover-previewable, and greppable, forever.

This document is the result of an adversarial design process: four competing
syntax families (native-primitive composition, new bespoke delimiters,
pandoc-lineage attribute spans, and iA-Writer-style standoff blocks) were
independently specified, attacked across three lenses (parser reality against
six real renderers, authoring ergonomics and edit robustness, and
implementability), and judged by a three-perspective panel. The footnote-carrier
design won unanimously. Every hard rule below exists because an attack
demonstrated the failure it prevents; the receipts are in §13 and Appendix D.

---

## 1. Design goals

1. **The file is the database.** All annotation data lives in the `.md` file.
   No sidecars, no JSON blocks, no plugin-private state. (The graveyard of
   Obsidian annotation plugins — 30+ mutually incompatible ones, the two most
   popular now dormant, one deleted outright leaving orphaned HTML in vaults —
   is a graveyard of formats that violated this.)
2. **Plugin death costs polish, never data.** Everything must render
   acceptably in stock Obsidian today, and degrade to *readable text* — never
   corruption — in GitHub, pandoc, and strict CommonMark.
3. **The binding travels with the text.** Cutting and pasting a highlighted
   sentence within a file can never separate it from its annotation. The
   22–27% orphan rates documented for standoff annotation systems
   (Hypothesis-class quote/position anchors racing a changing document) are
   structurally impossible for the in-file anchor.
4. **Silent loss is the cardinal sin.** Where breakage can occur, it must be
   visible or lintable. Where it can't be visible (one documented case, §8.3),
   the spec says so plainly instead of pretending.
5. **Humans first, machines close second.** Metadata reads as dialogue
   (`gus (2026-08-31): too broad #m/q`), never as JSON or attribute soup. But
   the grammar is regular enough that a dependency-free reference parser
   (shipped with this spec, with a regression suite) extracts everything, and
   AI agents can read and write it with file access alone.
6. **Thumb-typeable.** There is a one-gesture mobile capture form (§4) with a
   defined promotion path.

**Non-goals:** tracked edits / suggestion mode (Commentator's 3.5-year beta
shows that is an order of magnitude harder — annotations only); overlapping
highlights (impossible for inline markup; scope them out rather than fake
them); annotating files you can't write to (that is standoff's home turf —
use Hypothesis/WADM tooling and import via §12).

---

## 2. Conformance levels

Adopt the spec incrementally. Each level is valid on its own.

| Level | Form | Needs |
|---|---|---|
| 0 | `==highlight==` | nothing (native) |
| 1 | `==highlight==^[quick note]` | nothing (native) |
| 2 | `==highlight==[^m-id]` + `[^m-id]: note` | nothing (native) |
| 3 | entries with author/date/tags, threads, echoes, multi-segment, deep links | nothing to write; a plugin/CLI to exploit fully |

---

## 3. Level 0 — Highlights

`==highlighted text==` — Obsidian's native highlight.

Rules (all inherited from how markdown actually parses, verified):

- **H1.** A highlight MUST NOT cross a blank line. No parser supports it
  (verified across six renderers). For multi-paragraph annotation targets, see
  multi-segment highlights (§7.3) or point annotations (§7.2).
- **H2.** A highlight MUST NOT partially overlap another inline span
  (the Fletcher Penney / PyMdown rule: `*italic ==both* wrong==` is
  undefined behavior everywhere). Fully nested is fine: `**==bold mark==**`
  and `==a **bold** word==` both verified.
- **H3.** Write highlights tight: no whitespace just inside the fences.
  `==text ==` leaks literal `==` debris in every non-Obsidian renderer
  (verified); Obsidian's laxer parser reportedly still renders it (reported
  behavior — confirmed at the Appendix C gate). Normalizers SHOULD strip
  inner-edge whitespace.
- **H4.** Highlights SHOULD be single-line in source. (Obsidian soft-wraps;
  hard-wrapping mid-highlight is legal markdown but the reference parser and
  the grep helpers are line-based.)
- **H5.** `==` inside code spans, fenced code blocks, and YAML frontmatter is
  never a highlight. All extraction MUST ignore code regions and frontmatter
  (§11).

---

## 4. Level 1 — Quick capture

```markdown
She calls it ==somehow both elegy and comedy==^[the book's actual thesis?] here.
```

A native **inline footnote** immediately after the closing `==` (no space) is a
quick annotation. This is the mobile/inbox form: one location, no label to
mint, no jump to the bottom of the file — and it is already indexed by the
Sidebar Highlights plugin (the one actively-maintained tool in this space),
whose convention this level deliberately matches.

Rules:

- **Q1.** At most ONE inline annotation per highlight, and never adjacent to a
  labeled ref. Stacked inline footnotes `^[a]^[b]` are destroyed by pandoc
  (its superscript extension wins and both footnotes die — verified). Mixing
  `^[…]` with labeled refs on one highlight is a conformance error the linter
  catches: it renders as two footnotes in some renderers but leaves the model
  ambiguous, and it is one keystroke from the destroyed-stack case. Need more
  than one note? Promote to Level 2.
- **Q2.** Balanced bracket pairs inside the note are fine — `^[see
  [[Korzybski]] for this]` parses correctly in markdown-it, pandoc, and the
  reference parser (verified). Only an *unbalanced* literal `]` must be
  escaped `\]` (unescaped, it truncates the note and spills text into the
  body — verified; the escape works in both markdown-it and pandoc).
- **Q3.** Know the two costs, then stop worrying: (a) Obsidian's Live Preview
  shows `^[...]` as raw text — an official, documented limitation (open
  feature request since 2021) that a plugin's decoration fixes; Reading view
  renders it natively with hover preview. (b) GitHub does not support inline
  footnotes; the note degrades to visible literal text (readable, lossless).
- **Q4.** **Promotion recipe** (manual or one plugin command): mint a fresh
  label (§6.2), replace `^[note text]` with `[^m-id]`, append
  `[^m-id]: author (date): note text` as a definition (§6.3). Semantics are
  identical before and after.

---

## 5. Level 2 — The anchor

```markdown
The ==narrative fallacy==[^m-a41x] does the book's heavy lifting.

[^m-a41x]: Feels circular until ch. 6 — he knows it and says so.
```

The canonical form: a **native labeled footnote reference immediately after
the closing `==`**, whose label starts with `m-`. The footnote definition is
the annotation body.

Why this exact shape (each clause is load-bearing, established empirically):

- **Real footnotes everywhere that matters.** Renders as a true footnote —
  superscript ref, body, backlink — in Obsidian Reading view (with native
  hover preview since 1.6 and the core Footnotes sidebar since 1.9), on
  GitHub, in Bear 2, Typora, and all pandoc variants. Verified across six
  renderers: this is the best cross-renderer coverage of any candidate
  syntax, and its worst case (strict CommonMark, VS Code preview) is literal
  *readable* text.
- **The `m-` namespace is the discriminator.** Annotation-hood lives in
  greppable bytes, not in an invisible space or author discipline. An
  ordinary footnote can never silently become an annotation, a slipped space
  degrades to something still inside the system, and `grep '\[\^m-'` finds
  every annotation in a vault forever.
- **The label is the ID.** No separate identity token; addressing an
  annotation = note path + label.

### 5.1 Binding rules (normative, ordered)

1. A **marginalia ref** is a footnote reference whose label matches the
   grammar in §6.2 (`[^m-…]`).
2. A marginalia ref **binds to a highlight** iff the highlight's closing `==`
   precedes it on the same line with **no intervening characters** (canonical),
   or with only closing punctuation — any of `.,;:!?)"'»…”’›` — between
   (accepted, non-canonical). The punctuation tolerance exists because
   footnote typography ("marker goes after the period") is trained into every
   human and LLM on earth; without it, `==x==.[^m-1]` would silently demote to
   a point annotation while rendering pixel-identically (verified). Curly
   quotes are in the set because smart-quote editors produce them constantly.
   Lint normalizes to the tight form.
3. **Stacking:** a run of adjacent marginalia refs — `==x==[^m-a][^m-b]` —
   all bind to that highlight; document order = display order. (Verified:
   stacked *labeled* refs render as distinct footnotes everywhere labeled
   footnotes work. This is exactly why Level 2 uses labeled refs, never
   inline ones — see Q1.)
4. **Gap rule:** a marginalia ref separated from a closing `==` by any
   same-line run of **whitespace and/or closing punctuation only** (in any
   mix — `==x== [^m-1]`, `==x==. [^m-1]`, `==x== .[^m-1]`) is a
   **mis-normalized highlight annotation** — it means the highlight binding,
   and tools MUST lint and MAY auto-fix it to the tight form. It is *not* a
   point annotation. (This precedence rule exists because all these readings
   render identically and a spec silent here contradicts itself.)
5. **Point annotation:** any other marginalia ref binds to its position — a
   margin note on a location rather than a span (§7.2). Scope by convention:
   the enclosing block.
6. **Nearest anchor only.** In `==a== and ==b==[^m-1]`, the ref binds to `b`
   alone. No action at a distance.

### 5.2 What binding survives

Because the anchor is a contiguous string *inside* the prose:

- Editing the highlighted words: binding survives (the label, not the quote,
  is primary — deliberately the opposite of Hypothesis, because the author
  owns this text). A stale echo (§6.5) is detected, flagged, never auto-edited.
- Cut/paste/reorder within the file, of any size, any distance: survives.
- Deleting the `==` marks but keeping the ref: degrades to a point
  annotation. Nothing lost.
- Cross-file moves are the one genuinely dangerous edit — see §8.2 and the
  label scheme (§6.2) that makes the failure visible instead of silent.

---

## 6. Level 3 — Entries, metadata, structure

### 6.1 The full shape

```markdown
He calls it ==via negativa==[^m-9k2f] and never argues for it directly.

[^m-9k2f]: gus (2026-08-31): Compare the Stoics on subtraction. #m/q
    - echo: via negativa
    - claude (2026-09-01): Seneca, Letter 5, is the direct source. #m/ref
    - gus (2026-09-02): Found it. Moving on. #m/resolved
```

A definition is: a **head entry** on the label line, then an optional
**thread** of list items — replies and at most a handful of machine-maintained
items — indented under it.

### 6.2 Labels

```
label   = "m-" 1*30( a-z / 0-9 / "-" )     ; lowercase only, must not end in "-"
```

- **L1.** The charset is the proven intersection of Obsidian footnote labels,
  GitHub's strict footnote rules (lowercase, no colons), and Obsidian
  block-id characters — so one string works as footnote label, grep target,
  and block ID. Tools lint labels over 30 characters or ending in a hyphen.
- **L2. Namespace rule:** *every* footnote whose label starts with `m-` is
  claimed by this spec. Don't name ordinary scholarly footnotes `m-…`
  (`[^m-theory]` would be captured). This is the entire discrimination
  mechanism; its bluntness is its value. Matching is case-sensitive and
  lowercase-only — and because a near-miss like `[^m-Q4]` or `[^m-my_note]`
  renders as a perfectly normal footnote while being invisible to every
  Marginalia tool, near-miss labels (case or charset violations after an
  `m-`/`m_` prefix) are a lint **error**, not a courtesy.
- **L3. Random labels are the only conforming durable scheme.** Generate 4–6
  characters of `[a-z0-9]` (e.g. `m-7f3k`, `m-x2c9a`). Human-friendly
  sequential labels (`m-1`, `m-2`) are permitted only as **transients** that
  a tool relabels on save. This rule was forced by converging attacks:
  sequential labels turn note merges, two-device sync conflicts, and
  cross-file paste into *silent rebinding* — a pasted `[^m-1]` binds to the
  destination file's unrelated `[^m-1]` definition and renders perfectly
  (verified). Random labels convert that worst-in-class failure (silent
  misattribution) into a visible dangling ref.
- **L4. Duplicate definitions for one label in one file are a conformance
  error.** Renderers verifiably disagree on the winner (markdown-it and
  pandoc-markdown render the last; GitHub and pandoc-gfm render the first),
  so the same file shows different annotations on different platforms. Tools
  MUST flag; the canonical repair is relabel-one (§11's linter does).
- **L5.** Labels are file-scoped. Cross-file paste of an annotated span
  SHOULD be followed by moving the definition too (a plugin automates this);
  a forgotten definition yields a *visible* dangling ref (L3 guarantees it).

### 6.3 Entries

```
entry    = [ head ] body
head     = [ speaker SP ] [ "(" stamp ")" ] ":" SP
speaker  = 1*( ALPHA / DIGIT / "." / "_" / "-" )    ; never "@"
stamp    = YYYY-MM-DD [ SP HH:MM ]                   ; ISO, local time
body     = inline markdown ending with optional tags
```

All head parts optional. These are all valid entries:

```markdown
[^m-a1b2]: too broad
[^m-a1b2]: gus: too broad
[^m-a1b2]: (2026-08-31): too broad
[^m-a1b2]: gus (2026-08-31): too broad #m/q #m/hl/yellow
```

- **E1. HARD RULE — the definition line's body MUST NOT parse as a CommonMark
  link reference definition.** Concretely: it must be non-empty, contain at
  least one space or tab (≥ two tokens), **and must not be a single token
  followed only by a quoted or parenthesized phrase** (`nice (agreed)`,
  `see "chapter 9"` — the token + link-*title* shape). This rule is what
  stands between you and the worst degradation in the corpus: in strict
  CommonMark a violating definition *vanishes from output entirely*, the ref
  becomes a live hyperlink whose URL is your annotation (verified for both
  the single-token and token+title shapes), and a violating definition even
  corrupts a stacked *neighbor's* ref into a link (verified). An empty
  definition (`[^m-1]:`) is worse: pandoc swallows the entire *following
  paragraph of prose* into the footnote (verified). Any speaker head
  (`gus: …`) satisfies E1 automatically — when in doubt, write one.
  Scaffolding tools MUST write placeholder text (e.g. `pending annotation`),
  never an empty body.
- **E2.** Never write bare `@name` in a definition — pandoc's default
  citation extension rewrites it into a citation span (verified). Speaker
  tokens are bare names: `gus:`, not `@gus:`.
- **E3.** Never put `%%…%%` in a definition. It hides in Obsidian and leaks
  *visibly* in every other renderer (verified). Machine keys ride as tags
  (§6.6), which read as intentional everywhere.
- **E4.** The head parse is a *hint*, not a fence: a body opening with a word
  and a colon (`Note: check this`) can misparse as speaker `Note`.
  Misattribution costs metadata only, never body text; parsers SHOULD resolve
  speakers against a known-authors list (default: vault owner + known agents)
  and fall back to treating the whole line as body.
- **E5.** Multi-paragraph bodies use native footnote continuation: subsequent
  blocks indented 4 spaces. All inline markdown is legal in bodies —
  wikilinks, bold, `]`, tags (verified; the inline-footnote `]` problem of
  Q2 does not exist for definitions).
- **E6. HARD RULE — blank lines fence the definition block.** A definition
  lives at column 0 (1–3 leading spaces still parse in renderers — linted,
  normalize to 0) with a blank line before it: without one, pandoc-markdown
  lazily joins the definition into the paragraph above — annotation text
  renders as visible mid-prose (verified). Symmetrically, an unindented line
  directly after the block is *lazily joined into the footnote* by renderers
  (verified) — indent it 4 spaces if it is continuation, or put a blank line
  before it if it is new prose. Blank lines *between* adjacent definition
  lines are recommended but tested safe to omit.
- **E7. Placement:** scatter definitions directly under the paragraph that
  anchors them. This is the normative default (it keeps diffs one-hunk-local
  and makes manual note-splitting take the definition along); gathering at
  the file's end is a *display* concern for tools, not a storage convention.
  Rendering is identical either way (footnotes are position-independent —
  verified).

### 6.4 Threads

Replies are list items indented **exactly 4 spaces (or one tab)** under the
definition line, each a full entry (§6.3):

```markdown
[^m-9k2f]: gus (2026-08-31): Compare the Stoics. #m/q
    - claude (2026-09-01): Seneca, Letter 5.
    - gus: found it. #m/resolved
```

- **T1. HARD RULE — 4-space indent.** A 1–3-space indent (the near-universal
  2-space list default included) *silently detaches* the thread: in four of
  six verified renderers the replies escape the footnote and render as a
  top-level bulleted list sitting in the middle of the document, while the
  footnote keeps only the head. Nothing dangles, nothing warns. Linters MUST
  detect and re-indent (error). A 5-or-more-space indent stays *inside* the
  footnote in renderers (verified) but is non-canonical (fixable warning) —
  parsers MUST still capture such items, or publish-time stripping leaks
  them. `*`/`+` bullets are captured with a normalize warning (`-` is
  canonical; remark rewrites bullets to `*`). A blank line between the head
  and the item list is conforming — Prettier inserts one. Thread items are
  single-line; don't hard-wrap them.
- **T2. One rule for "second comment":** a follow-up on the same subject is a
  **thread reply**; a genuinely independent annotation (its own type, its own
  open/resolved status, a different author's separate point) is a **stacked
  ref** (§5.1 rule 3). The semantic difference is real — status is
  per-definition, so `#m/resolved` on a thread closes the whole
  conversation, on a stack closes one annotation only.

### 6.5 Echoes (quote snapshots)

An **echo** is a thread item with the reserved speaker `echo`, holding a
verbatim snapshot of the highlighted text at annotation time:

```markdown
[^m-7f3k]: gus (2026-08-31): His central metaphor. #m/def
    - echo: black swan
```

- Echoes are the *redundancy layer*: the human-readable analogue of iA
  Writer's SHA-256 staleness guard and the WADM `TextQuoteSelector.exact`.
  They power staleness detection, orphan repair (§8.3), importer identity
  (§9), and recovery from label-destroying toolchains (§10).
- **Staleness:** an annotation is stale iff *any* segment's current highlight
  text differs from its positionally-corresponding echo, compared
  whitespace-normalized and case-sensitively. For multi-segment annotations,
  echo count MUST equal segment count, one per segment in document order
  (linted otherwise). Tools write echoes at creation/import time and refresh
  one only on explicit user confirmation — never silently.
- **Echoes carry no metadata:** echo items are excluded from tag, type, and
  status derivation (otherwise highlighting a sentence that happens to
  contain `#m/resolved` would resolve its own annotation — verified).
- RECOMMENDED for anything long-lived, shared, or machine-imported; tools
  maintain them so humans never type them. Canonical position: first thread
  item. `echo` is reserved as a speaker name.
- This shape is deliberate. The obvious alternative — a blockquote of the
  highlight opening the definition — was attacked and killed: it depends on
  an internal blank line whose omission makes lazy continuation silently
  swallow every entry *into the quote* (verified). The echo-as-list-item
  form has no blank-line tripwire; its worst degradation is cosmetic
  flattening in pandoc-markdown (verified, lossless).

### 6.6 Tags: type, status, color, machine keys

Metadata beyond author/date rides as native nested tags under the `#m/`
namespace — real Obsidian tags (tag pane, search, Dataview reach them
natively) that stay quarantined from your content taxonomy (bare `#q`,
`#todo` tags would colonize the vault-global tag pane within a year):

| Tag | Meaning |
|---|---|
| `#m/q` `#m/def` `#m/ref` `#m/todo` `#m/wow` … | **type** — open vocabulary; the type is the first non-reserved tag *of the head entry*; replies never set type. Reserved: exactly `#m/open`, `#m/resolved`, `#m/multi`, and the `#m/hl/…`, `#m/sync/…` families — everything else (even `#m/multiverse`) is a valid type |
| `#m/open` / `#m/resolved` | **status** — absence = open; the *last* occurrence across definition + thread wins, so a reply after resolution doesn't silently reopen, and an explicit `#m/open` in a later reply does |
| `#m/hl/yellow` `#m/hl/red` … | **highlight color/kind** — a tool styles the `==mark==` from its annotation's tag, so color survives as a readable word, not syntax (the Highlightr lesson: 709k installs of inline `<mark style>` debris, now unmaintained) |
| `#m/multi` | declared multi-segment highlight (§7.3) |
| `#m/sync/rw-884213` | **machine key** convention for importers (Readwise-class) — readable, greppable, native |

### 6.7 Full grammar

See Appendix B for the collected ABNF.

---

## 7. Placement forms

### 7.1 In tables, callouts, lists

`==x==[^m-id]` is verified safe inside table cells, blockquote/callout lines,
list items, and emphasis wrappers, in every renderer where the base syntaxes
work. Two Obsidian-specific caveats (both official/documented): footnote refs
inside tables and callouts render in Reading view but not Live Preview, and
`%%` (which this spec never uses) breaks in LP table cells. Definitions never
go inside tables or callouts — column 0 only (E6).

### 7.2 Point annotations

A marginalia ref not bound to any highlight annotates a *location*:

```markdown
The whole argument of this chapter feels rushed.[^m-c3d4]

[^m-c3d4]: gus: compare the care taken in ch. 2 — was this one cut down? #m/q
```

Use for commentary on a paragraph/section rather than a span. For a whole
section, place it at the end of the heading line or lead paragraph.

### 7.3 Multi-segment highlights

`==` cannot cross a blank line (H1), so a multi-block highlight is several
highlights **sharing one label**, declared with `#m/multi`:

```markdown
He calls it ==spandrels==[^m-e5f6] early, and the ==byproduct argument==[^m-e5f6]
returns forty pages later without acknowledgment.

[^m-e5f6]: gus: one move in two costumes — read together. #m/multi
    - echo: spandrels
    - echo: byproduct argument
```

- **M1.** Shared-label spanning MUST be declared with `#m/multi` in the
  definition. Undeclared label reuse is a lint warning (it is far more often
  an accidental copy-paste than an intentional spanning — the attacks
  demonstrated silent semantic merges without this rule). One echo per
  segment, in document order.
- **M2.** Degradation is honest, not perfect: GitHub and markdown-it render
  one note with multiple backrefs; pandoc duplicates the note body per
  segment (lossless, cosmetically redundant — verified). Obsidian's own
  same-label multi-ref rendering is on the live-vault checklist (Appendix C).

### 7.4 Deep links

To make an annotation a native link target, put an ordinary Obsidian block ID
— **same string as the label** — at the end of the *prose paragraph*
containing the highlight (first segment, for multi-segment):

```markdown
A ==long thought==[^m-g7h8] worth returning to. ^m-g7h8
```

Then `[[Note#^m-g7h8]]` deep-links to the passage from anywhere in the vault,
with zero plugins. Opt-in, because the trailing `^m-g7h8` leaks as small
literal debris outside Obsidian (verified — harmless but visible).

Do **not** put block IDs on footnote-definition lines. Attacked and dropped:
unverified in Obsidian, and the documented block-ID rules (must terminate a
line; cannot address sub-parts of composite blocks) give concrete reason to
expect failure on a definition carrying an indented thread.

---

## 8. Lifecycle

### 8.1 Resolving

Resolution is a **thread reply carrying `#m/resolved`** (with author, date,
and rationale if you have them — the record is the point). The ref, the
highlight, and the whole thread stay in the file; tools dim or collapse
resolved annotations. Reopen with a later `#m/open` reply (last-tag-wins,
§6.6). Nothing about resolution deletes text — CriticMarkup's ecosystem,
where accept/reject silently *discards* comments, is the cautionary tale.

### 8.2 Archiving and deleting

Only ever explicit, never automatic:

- **Archive** = remove the ref; move the definition under a visible
  `## Archived marginalia` heading, rewritten as a plain blockquote with the
  entries inside it — this exact shape (which `flatten` also emits):

  ```markdown
  ## Archived marginalia

  > the highlighted text
  >
  > — gus (2026-08-31): the head entry #m/q
  >   - claude (2026-09-01): a reply
  ```

  Archived material renders everywhere, because — hard-won honesty — an
  *unreferenced footnote definition is silently omitted from rendered output
  by every footnote-aware renderer* (verified). Bare footnote definitions
  are never an archive format.
- **Delete** = remove ref AND definition, always as a pair, always
  confirmed.

### 8.3 Orphans (the honest section)

Two asymmetric failure modes:

- **Dangling ref** (definition deleted): renders as literal `[^m-7f3k]`
  everywhere — visibly broken, therefore findable. Repair: scaffold a
  definition *with placeholder text* (E1), or delete the ref.
- **Orphaned definition** (annotated sentence deleted, ref went with it):
  this is the one silent case, and the spec refuses to pretend otherwise —
  rendered views (Obsidian Reading, GitHub, pandoc alike) omit unreferenced
  definitions, so the annotation survives *in source only*, discoverable by
  grep (`^\[\^m-`), source mode, or tooling. Tools MUST surface orphans
  (never auto-delete) and SHOULD run the repair pipeline: exact echo match →
  whitespace-normalized match → bounded fuzzy match (Hypothesis-style, quote
  is truth, position at most a tie-breaker) → offer re-anchor on a unique
  hit, ask on multiple, and on none, **park** the annotation under a visible
  `## Orphaned marginalia` heading (§8.2 form) so it is human-visible again.

---

## 9. Identity and merging (importers, sync)

For machine writers (Readwise-class importers, dedupe tools, agents):

- **Annotation identity within a note** = normalized highlight quote **+
  occurrence ordinal** (or quote + ~32 chars of source-text prefix/suffix —
  the TextQuoteSelector this spec exports anyway). Bare quote-as-identity is
  known-insufficient: the same phrase highlighted in chapter 1 and chapter 9
  must remain two annotations (the attack that killed the naive rule).
- **Merge rule:** an incoming highlight matching an existing annotated
  quote+context merges instead of duplicating; **the copy carrying human
  commentary always wins**; machine metadata merges in; entries dedup by
  (speaker, stamp, body).
- **Sync keys** ride as `#m/sync/…` tags (§6.6), never as `%%` or HTML
  comments.
- Importers MUST NOT regenerate whole files (the Readwise Mirror failure:
  regeneration makes files read-only in practice). Append or merge.

---

## 10. Toolchain discipline

Verified behaviors; treat as normative warnings.

| Tool | Verdict |
|---|---|
| **Obsidian Linter** | MUST disable **"Re-index footnotes"** (renumbers every label → destroys the entire namespace and ID layer vault-wide) and **"Footnote after punctuation"** (fights the normalizer; binding tolerates its output per §5.1.2, but pick one canonical form) |
| **pandoc `-t markdown` round-trips** | **FORBIDDEN on source files.** Pandoc's AST stores footnotes without labels (verified via `-t json`): a round-trip renumbers `[^m-7f3k]` → `[^2]` (namespace erased, addresses dead), *forks* multi-segment annotations into diverging duplicates, and *deletes* orphaned definitions — while the file renders identically after. Echoes are the recovery key: a restore-ids pass can re-derive bindings from them. |
| **pandoc rendering** (`-t html/pdf/docx`) | Safe as a one-way *render* — but see the publishing rule below. |
| **Prettier 3** | Safe with `--prose-wrap preserve` (the default): labels and content survive; it inserts a blank line between a definition head and its thread list, which is conforming and parsed. **`--prose-wrap always` is FORBIDDEN**: it hard-wraps inside `==…==`, splitting highlights across lines and hiding them from line-based tooling (verified). |
| **remark-based pipelines** | Footnote-safe on labels, but remark rewrites thread bullets `-` → `*` (parsed, linted, normalize back), silently deletes HTML comments (not used by this spec), and rewrites whitespace; test yours before trusting it. |
| **CRLF line endings** | Conforming — the reference parser normalizes them. Tools implementing the grammar directly must remember JS/regex `$` vs `\r`. |
| **Obsidian Publish / any export to other readers** | Annotations are *real footnotes* — that's the feature — so an unstripped publish renders your private marginalia as public numbered footnotes interleaved with genuine citations. **Strip or flatten before publishing** (§11 CLI). And because pandoc can't see labels, stripping MUST happen as a textual pre-pass on the markdown, *before* pandoc ever parses it. |

---

## 11. Extraction contract

The **reference parser** (`marginalia.mjs`, shipped beside this spec —
dependency-free, Node ≥ 18, with a regression suite in `test.mjs`) is the
*single normative extractor*. The Obsidian plugin, CLI use, and agents all
share it.

```
node marginalia.mjs lint    notes.md     # conformance check, exit 1 on errors
node marginalia.mjs parse   notes.md     # full JSON model
node marginalia.mjs extract notes.md     # human-readable digest of annotations
node marginalia.mjs fix     notes.md     # mechanical fixes + relabel sequential labels
node marginalia.mjs strip   notes.md     # clean copy: highlights stay, annotations go
node marginalia.mjs flatten notes.md     # refs out, annotations to '## Marginalia' section
node marginalia.mjs wadm    notes.md     # W3C Web Annotation JSON-LD export
```

`strip` and `flatten` — the publish-safety commands — **refuse to run** while
error-severity lints are present (`--force` overrides), because several error
conditions are precisely the ones under which stripping would leak private
text.

What the linter actually checks: E1, E2, E3, E6/LAZY, T1 (+bullets), Q1
(stacks and mixed forms), L1 (label grammar), L3, L4, NEAR-MISS, M1,
ECHO-COUNT, STALE, H3, DEF-INDENT, BIND-SPACE/BIND-PUNCT, ORPHAN, DANGLING.
Not machine-checkable: H1/H2 (a broken highlight is just literal text to a
parser), E4 misattribution (a hint by design), and the §10 toolchain
discipline — those remain your habits, not the linter's.

Two grep patterns are blessed as **lossy helpers** — quick vault-wide
discovery, nothing more:

```
\[\^m-[a-z0-9-]+\]      # every ref (and def head)
^\[\^m-[a-z0-9-]+\]:    # every definition
```

Stated caveats (why they are lossy, verified): they match inside code fences
and inline code (real parsers must mask code regions first — §3 H5); they see
neither thread structure nor binding nor echoes. Every "two regexes extract
everything" claim across four candidate designs failed adversarial review;
this spec stopped making it.

---

## 12. Web Annotation (WADM) mapping

Interop with the W3C Web Annotation Data Model is an **export/import
boundary**, never a storage format (JSON-LD in prose is vault poison; the
one plugin that embedded Hypothesis JSON in `%%` blocks warns users not to
edit it — and standoff's measured orphan rates are the disease this spec's
in-file anchor cures).

**Export** (one `oa:Annotation` per definition, plus one per quick
annotation, plus one per bare highlight):

- `target.source` = the note's URI; `target.selector` = `TextQuoteSelector`
  with `exact` = current highlight text and ~32-char `prefix`/`suffix`
  computed at export time — **over the anchoring stream**: the source text
  with all marginalia machinery (refs, quick notes, definition blocks, block
  anchors) *and* the `==` fences removed. That is the plain-text stream an
  external consumer's copy of the document actually contains; context
  computed over raw annotated source would embed `[^m-…]` tokens and never
  match anything (a defect this spec's own review caught). Never stored, so
  never stale. Multi-segment → one target per segment.
- `motivation`: `highlighting` for bare highlights, `commenting` for quick
  and labeled annotations; `#m/q` → `questioning`; others via extension.
- Each entry → `TextualBody` (`format: text/markdown`) with `creator` =
  speaker (omitted when the head parse is a low-confidence hint, per E4),
  `created` = stamp (time stamps exported in ISO `T` form). A thread exports
  as ordered bodies on the one annotation (what the reference exporter
  emits); exporting replies as separate annotations targeting the head's IRI
  (`note-path#m-id`) is a conforming alternative for consumers that model
  threads.
- `#m/resolved` → an annotation-status extension field (the `marginalia:`
  prefix is declared in the export's `@context`).

**Import** (Hypothesis/Readwise/WADM → vault): locate
`TextQuoteSelector.exact` (exact → normalized → prefix/suffix-assisted
bounded fuzzy; position a ~2% tie-breaker at most — the weighting Hypothesis
converged on after a decade), wrap `==…==`, mint a label, write definition +
echo + entries. Unlocatable quotes go to `## Orphaned marginalia` — imported
data is never silently dropped. Merging follows §9.

---

## 13. Prior art, and why not X

Each rejection below was tested, not assumed.

- **CriticMarkup `{==x==}{>>note<<}`** — the closest prior art, and the
  design's most instructive failure. Unmaintained since ~2015 (a serious
  2023 metadata-extension proposal from the Commentator author sits
  unanswered); renders natively in none of six tested renderers; in stock
  Obsidian it *half*-renders — `{` + highlight + `}` braces plus exposed
  comment — the worst degradation observed, uglier than plain text.
  MultiMarkdown's own author judges rendering it near-intractable, and all
  three major CM pipelines silently discard comments on accept/reject:
  the ecosystem treats comments as ephemeral review chatter, which is the
  opposite of marginalia. Its adjacency insight, though, is the load-bearing
  idea this spec keeps.
- **`%%` comment carrier (`==x==%%note%%`)** — hidden in Obsidian, leaks the
  note *visibly in every other renderer* (verified); breaks in LP table
  cells; `%%%%` comments out the rest of a note; wikilinks inside still hit
  the graph. Fails goal 2. Kept only in one lesson: never for note text,
  and this spec doesn't even use it for machine keys (tags won).
- **HTML (`<mark title>`, `<span data->`)** — Obsidian intentionally renders
  no markdown inside HTML elements (kills links/bold in highlights); the
  deleted-plugin story (orphaned `<label class="ob-comment">` HTML in
  thousands of vaults) is this approach's epitaph. HTML *comments* are
  invisible everywhere — including to humans — and remark pipelines silently
  delete them (verified).
- **Attribute spans (`[x]{.hl note="…"}`, kramdown IALs, djot postfix
  attributes)** — the intellectually attractive lineage, and the panel's
  attribute-based candidate lost decisively: pandoc-only rendering (literal
  braces everywhere else *including Obsidian*), and the machine-trailer
  discipline it demands collapses under authoring reality. Its concepts
  (namespaced keys, first-class metadata) survive here as `#m/` tags.
- **New bespoke delimiters (`((…))` and kin)** — best-in-class locality and
  the panel's product judge called its capture flow the best in the dossier;
  killed because it functions as an annotation system *nowhere* without its
  plugin, for the entire life of the vault, and CommonMark-equivalent
  formatters silently erase its escape distinctions. A plain-text format the
  plain-text toolchain destroys is a contradiction.
- **Standoff / sidecar (iA Writer annotations, Tandem's EOF JSON block,
  annotate.el, TEI)** — justified when the base text is frozen, unwritable,
  or multi-party (its actual home). For an author's own vault the measured
  costs (22–27% orphan rates; Zotero deliberately *removed* file-embedding;
  the WADM reference anchoring library archived in 2025 without graduating)
  buy nothing adjacency doesn't already give. Its redundancy machinery
  survives here in miniature: the echo *is* a TextQuoteSelector, humanized.
- **Sidebar Highlights' `==x==[^1]` / `==x==^[note]`** — the one organically
  adopted convention, and this spec is a superset of it by design: Level 1
  matches it exactly; Level 2 adds only the `m-` namespace it lacks. Tools
  SHOULD read plain-label and inline forms as read-only annotations and
  offer one-command upgrade.

---

## Appendix A — Hard rules, one screen

The complete list of MUSTs whose violation causes verified damage:

1. **E1** — definition body must not parse as a CommonMark link-ref
   definition: non-empty, ≥ two tokens, and never a single token plus a
   quoted/parenthesized phrase. A speaker head is always safe. (CommonMark
   vanishing-definition catastrophe; pandoc paragraph-swallow.)
2. **T1** — thread replies: 4-space (or tab) indent, `-` bullet. (Silent
   thread detachment at 1–3 spaces; 5+ renders but must still be captured.)
3. **Q1** — never stack inline footnotes, never mix `^[…]` with labeled
   refs; one `^[…]` max per highlight. (Pandoc destroys stacks.)
4. **L3/L4** — durable labels are random; duplicate labels are an error.
   (Silent rebinding; renderer-divergent winners.)
5. **E2/E3** — no bare `@name`, no `%%…%%` in definitions. (Citation
   mangling; visible leakage.)
6. **E6/LAZY** — blank lines fence the definition block, before and after.
   (Pandoc lazy-join leaks annotations into prose; renderers absorb
   trailing prose into the footnote.)
7. **H1/H2** — highlights never cross blank lines or half-overlap spans.
8. **M1** — shared labels require `#m/multi`.
9. **§10** — disable Linter footnote re-indexing; never pandoc-round-trip
   sources; never Prettier `--prose-wrap always`; strip before publishing.
10. **H5/§11** — extraction ignores code regions (fenced, inline, and
    indented code blocks alike).

## Appendix B — Collected grammar (ABNF-ish)

Canonical forms first; where parsers MUST accept more (renderer reality),
the comment says so. The reference parser is the tie-breaker.

```abnf
highlight    = "==" 1*( inline-char ) "=="       ; no blank line, tight edges (H3)
quick-ann    = highlight "^[" note-text "]"      ; brackets balance; escape only a
                                                 ;   lone "]" as "\]" (Q2)
anchor       = highlight 1*ref                   ; canonical: refs touch the "=="
                                                 ; accepted: closing punctuation
                                                 ;   and/or whitespace in the gap
                                                 ;   (§5.1 rules 2 & 4 — lint)
ref          = "[^" label "]"
label        = "m-" 1*30( %x61-7A / DIGIT / "-" ); lowercase; not ending in "-"
close-punct  = "." / "," / ";" / ":" / "!" / "?" / ")" / DQUOTE / "'" / "»"
             / "…" / %x201D / %x2019 / %x203A    ; incl. curly quotes ” ’ ›

definition   = "[^" label "]:" SP def-body
               *( LF thread-item ) *( LF continuation )
                                                 ; canonical: column 0; accepted:
                                                 ;   0-3 leading spaces (lint);
                                                 ;   one blank line before the
                                                 ;   item list is conforming
def-body     = entry                             ; E1 applies HERE only: >= 2
                                                 ;   tokens, never token+"title"
                                                 ;   or token+(title)
thread-item  = 4SP "- " entry                    ; canonical; accepted: HTAB or
                                                 ;   >4SP indent, "*"/"+" bullets
                                                 ;   (all linted); single-line
continuation = LF LF 4SP block                   ; native footnote continuation;
                                                 ;   >=4SP accepted
entry        = [ head ] body
head         = [ speaker ] [ SP "(" stamp ")" ] ":" SP
                                                 ; "gus:", "gus (…):", "(…):" all
                                                 ;   valid — no space needed
                                                 ;   between speaker and ":"
speaker      = 1*( ALPHA / DIGIT / "." / "_" / "-" ) ; "echo" reserved
stamp        = date [ SP time ]                  ; YYYY-MM-DD / HH:MM
body         = inline-markdown                   ; thread-item bodies are free;
                                                 ;   only def-body carries E1
tag          = "#m/" 1*( ALPHA / DIGIT / "/" / "-" )
block-anchor = SP "^" label                      ; end of prose paragraph only
```

## Appendix C — Live-vault verification checklist (the 1.0 gate)

This spec was verified against six real parsers (markdown-it ± mark/footnote,
remark+gfm, pandoc markdown/gfm/commonmark_x) but **not against a live
Obsidian instance** — Live Preview and Reading mode are two distinct
closed-source pipelines with documented divergences. Before freezing 1.0 (and
before building plugin features on them), verify in a real vault:

- [ ] Multi-block footnote definitions in **Reading view**: head + 4-space
      `- ` thread list + continuation paragraphs render as one footnote.
- [ ] The same in **Live Preview** (expected: raw text — confirm it at least
      doesn't corrupt).
- [ ] Same-label multi-refs (`#m/multi` form): both refs render, hover works,
      backrefs behave, in both modes.
- [ ] Labeled refs in LP table cells (expected per docs: Reading-only).
- [ ] Punctuation-separated refs (`==x==.[^m-1]`) hover/render in both modes.
- [ ] Block ID at end of a highlight-bearing prose paragraph: `[[#^m-…]]`
      resolves; embed shows the paragraph.
- [ ] Footnote hover preview on mobile; footnote tap behavior on mobile.
- [ ] `==text ==` (Obsidian-lax) still renders there (then normalize it away).

## Appendix D — Provenance

Design inputs: a six-agent research sweep (CriticMarkup/extension lineage,
Obsidian native behavior, the 30-plugin ecosystem and its failures, WADM +
Hypothesis anchoring literature, an empirical six-renderer degradation
matrix, community conventions and complaints); four independent candidate
specs (native-composition, bespoke-delimiter, attribute-lineage, standoff);
twelve adversarial attack reports; three judge scorecards (unanimous winner:
the footnote-carrier design, with mandated surgery and cross-candidate grafts
— all applied above), and a four-lens adversarial review of this document,
the reference parser, and the companion docs (two blockers and a dozen
majors found and fixed; the regression suite in `test.mjs` encodes them).
Empirical claims marked "verified" were reproduced on the multi-renderer
harness shipped in `examples/harness/`, or are cited from the research
corpus.

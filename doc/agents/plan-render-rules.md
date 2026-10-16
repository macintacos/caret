# Plan Render Rules

*Audience: coding agents and contributors changing how a plan is rendered —
`ui/src/lib/diffview/`, the `SourceView` / `DiffPlanView` components, and the preview
renderer `ui/src/lib/planMarkdown.ts`, its source-line map `ui/src/lib/planSourceMap.ts`,
its code-block highlight pass `ui/src/lib/previewCode.ts`, its reference-tagging pass
`ui/src/lib/previewRefs.ts`, its comment slots `ui/src/lib/previewComments.ts`, its mount
`ui/src/components/PlanPreview.svelte`, and the source/preview surface table
`ui/src/lib/planView.ts`.*

The **source view** renders a plan as **line-numbered markdown source**. Every decoration
the reviewer sees is drawn over the characters they would copy. Everything up to § The
preview renderer is the contract the whole `ui/src/lib/diffview/` layer shares; each
module's own header carries only what is local to it. The preview is a second surface
rendered from the same stored text, not an exception to transform-in-place. The reader
switches between the two with the plan view's **Preview** toggle; compare mode always
shows source.

## Transform in place (EXC-855)

**Markers stay in the text and are marked, not removed.** Emphasis markers, backticks,
task brackets, quote markers and list bullets are all still there in the DOM; the sheet
overdraws them. That is what keeps the row's gutter number, its hover comment affordance
and its cursor reachability intact, and what makes copy, `/` search, vim motions and
comment anchors all resolve against the same column space.

Three constructs are allowed out of it, and no more:

- **Link collapse** (`links.ts`) — `[label](target)` collapses to `label` and `<url>` to
  `url`. This is the only display rewrite in the layer, and therefore the only reason a
  display column ever differs from a source column.
- **Tables** (`tables.ts`) — the one construct that **restructures** rather than
  overdrawing, because a row's `|` columns do not line up with the table's columns and
  alignment has to come from layout. No character is added, removed or moved.
- **Images** (`inlineImages.ts`) — the picture is **added** to the row, never substituted
  for it. The literal `![alt](url)` stays, so copy carries the real markdown.

Reaching for a fourth exception means changing this file first.

## The pipeline

```graphviz
digraph plan_render {
    rankdir=LR;
    "plan text" [shape=note];
    "links.ts" [shape=box];
    "inlineSpans.ts" [shape=box];
    "inlineDecorate.ts" [shape=box];
    "coreStyles.ts" [shape=box];

    "plan text" -> "links.ts" [label="per line"];
    "links.ts" -> "inlineSpans.ts" [label="display text"];
    "inlineSpans.ts" -> "inlineDecorate.ts" [label="flat runs"];
    "inlineDecorate.ts" -> "coreStyles.ts" [label="tagged tokens"];
}
```

- **`links.ts`** collapses links one line at a time — the only rewrite of plan text. It
  returns display text plus five layers keyed by display line: clickable link spans, file
  references, flat inline runs, blockquote depth, and images. The runs and the depth come
  from handing every display line to `inlineSpans.ts` at once.
- **`inlineSpans.ts`** lexes inline markup a paragraph at a time and emits the flat atomic
  runs per display line — one span per element-bounded stretch of identical attribute set.
  Runs are **flat by requirement**, not by style: a nested wrapper would break the token
  partition below. Abutting elements are never fused, because that boundary is where a
  pill's rounded end gets drawn. A run cut from an element that crosses a line break names
  the members that do (`continues` / `continued`), so no cap is drawn there.
- **`inlineDecorate.ts`** refines shiki's tokens until none straddles a run boundary, then
  tags each with the run covering it.
- **`coreStyles.ts`** turns each attribute into one CSS rule. The ink and chip vocabulary
  it draws from is `svelte-rules.md`'s, not this file's.

The block classifiers — `codeBlocks.ts`, `tables.ts`, `thematicBreaks.ts`, `headings.ts` —
and the reference scanner `fileRefs.ts` run alongside, each answering "which lines are
this construct" and tagging the rows the library painted. Their DOM tagging lives in the
module rather than the component so it is unit-testable against a constructed fixture.

## Line parity

**The output always has the same line count as the input.** Lines are rejoined with `\n`,
and no pass drops or adds one. The annotation and feedback line numbers depend on it: a
pass that dropped or added a line would silently move every comment anchor below it.

**Recognition is a separate question from parity.** The line-leading markers — `>`, list
bullets, task brackets — are read one line at a time, because they only ever start a line.
The link collapse is too, so a link whose label wraps stays literal. Inline grammar is
block-scoped: `inlineSpans.ts` lexes a multi-line paragraph as one text, so a bold, italic
or code span the 90-column reflow broke still pairs, and every line it touches gets a run
clipped to that line. Headings, tables and every other block keep the one-line lex.

**A hard wrap and a soft wrap are different problems.** A hard wrap is a newline in the
source, so the span spans rows and pairing it is the lex's job. A soft wrap is one row the
browser fragments — a long table cell wrapping inside its column — and needs nothing from
the lex; what it can need is CSS that paints per fragment.

## Display coordinates

**Every layer indexes the display text** — the space the reader actually sees — and line
numbers are 1-based, matching the view's per-line `data-line`. Because `links.ts` is the
only pass that rewrites, it is also the only pass that has to think about the
display/source divergence; everything downstream reads display columns and needs no
remapping of its own.

## The token partition

`rowTokens.ts` owns what "a row's tokens" means, and both halves of it are load-bearing:

- **`splitTokens` only ever refines.** Every boundary shiki drew survives a split, so
  every column a later pass looks for is still a token boundary.
- **`tokenChildren` is how a row's tokens are reached** — the row's own children, or a
  table row's cells' children one level down. It exists so no pass has to know which kind
  of row it is looking at.

Every pass locates a token by walking that sequence and accumulating text length.
**No pass may introduce a nested wrapper**: it would break the partition and put an
attribute on an element spanning more than the thing it names.

## Idempotency is a hard requirement

`SourceView.svelte` drives these passes from `MutationObserver`s, so a pass that redoes
settled work loops the observer forever. The two observers have different rules and the
difference matters:

- **The repaint observer** watches `childList` over the whole subtree. Node creation and
  splitting are therefore conditional — an already-correct row is left completely
  untouched. **Attribute writes are free**, because attributes are not observed.
- **The selection observer** watches `attributeFilter: ["data-selected-line"]`. Here a
  write of an *unchanged* value still emits a MutationRecord, so `cardSelection.ts` must
  never write a value that is already there.

Library-owned rows are rewritten on every repaint, so a pass that tags them is also
replayed from the repaint pass, against a non-reactive mirror.

## marked is the grammar of record

The inline and block grammars come from `marked`, already a UI dependency. Reuse its lexer
rather than hand-rolling a scanner: it is what makes nested emphasis, emphasis inside link
labels, escaped markers, setext underlines spelled `---`, table delimiter rows, fenced
`---`, and a break interrupting a list all come out right. A hand-rolled equivalent would
be the fiddliest parser in the repo for a strictly worse answer.

**Where caret's own fence scan and marked disagree, the panel wins.** `codeBlocks.ts`
toggles on every line of three or more backticks, which CommonMark does not, so on a plan
quoting nested fences the two disagree about which rows are code. marked is right, but the
panel is what the reader sees — a rule drawn inside one would read as a bug. Classifiers
take the fenced ranges as a parameter for exactly this reason.

## Safety

`links.ts` owns the scheme gate and it is absolute: only an `http`/`https` target is ever
emitted as clickable or drawable, and no downstream module re-decides safety. A
path-shaped target collapses but records **no** clickable span — `openUrl` must never be
handed a filesystem path. Every other scheme (`javascript:`, `data:`, `mailto:`, the
protocol-relative `//host/…` form, a scheme-less host) stays literal source text, so the
reader can see what the link would actually do. The preview renderer passes every link and
image through the same gate, `isSafeUrl`.

Rendering an image makes the reviewer's browser fetch an arbitrary host when the row
scrolls into view. `referrerpolicy` and `loading` reduce what leaks; they do not close the
channel. Closing it wants an `img-src` CSP on the daemon's own response, which does not
exist today.

## The preview renderer

`renderPlanMarkdown` turns a version's stored text into a `RenderedPlan`: `html` plus one
`SourceSpan` per block.

- **Blocks.** A block is a top-level marked token that renders to something. Each is
  wrapped in a `div` carrying `data-source-start` / `data-source-end`: 1-based, inclusive,
  over the stored text comment anchors use. Blocks are flat siblings; `blocks[i]` is the
  i-th. A block ends at its last non-blank line.
- **Soft breaks** stay `\n` and render as a space.
- **Sanitizing.** Only raw-HTML tokens pass through js-xss, using `htmlWhiteList()`
  (shared with comment bodies) minus every tag that may keep a URL-bearing attribute
  (`href`, `src`, `srcset`, `poster`), plus `div` and `table`, whose unclosed forms would
  swallow later blocks. Those render as text, so the preview fetches and navigates nothing
  the source view would not. caret's own markup and attributes never pass through the
  sanitizer.
- **Links** that pass `isSafeUrl` open in a new tab with `rel="noopener noreferrer"`;
  anything else renders as its label.
- **Images** that pass `isSafeUrl` carry `IMAGE_ATTRIBUTES`, never `srcset`, `style` or
  `title`; anything else renders as its alt text.
- **`[/]`** renders as `data-task="slashed"`. `indeterminate` has no attribute form, so
  `PlanPreview.svelte` sets the property on each such input after every mount of new HTML.
- **Styling** lives in `PlanPreview.svelte`'s scoped stylesheet: every rule is rooted at
  `.plan-preview` and painted from tokens and the theme's `--markdown-*` properties, with
  the source view's fallbacks except an unstyled heading (weight 600) and quote
  (`--ink-soft`, no subdue). The renderer's empty `span[data-source-line]` markers sit
  inside every text leaf and before a code block's `pre`, so no rule styles a bare `span`
  or selects text-level content by position (`:first-child`, `:empty`, `:only-child`). A
  task box is matched as `input[data-task]`, and the first-heading margin reset reaches
  through the first block wrapper (`.plan-preview > :first-child > :is(h1, …, h6)`).
  `data-task` stays distinct from the source view's `data-md-checkbox`: one marks an
  `input` in the light DOM, the other a `span` in the shadow root, so no rule is shared.
- **Code blocks.** A code block renders `<pre><code>` with its escaped text and no class.
  A fence's info string resolves through `fenceGrammar` to a bundled grammar, carried as
  `RenderedPlan.codeLanguages` keyed by the code marker's line, and never as markup; an
  indented block gets no entry. `fenceGrammar` reads the info string's leading token with
  the same character class as the source view's fence scan, so ```` ```ts:app.ts ````
  reads `ts` (so `typescript`) in both views. `previewCode.ts` then highlights the mounted
  blocks, yielding a task before every block it highlights so each mounts plain first. It
  re-runs on a theme switch or a replace of the showing custom theme, and leaves a block
  plain when its grammar is unknown, missing, or refused.

### Source-line map

The preview reflows text, so a rendered position is not a source line. `planSourceMap.ts`
maps between the two for comments, the cursor and search.

- **Markers.** The renderer puts an empty `<span data-source-line="N">` before the first
  rendered character of every source line that produces inline text: at the start of each
  leaf (paragraph, heading, list item text, table cell), after every `\n` inside inline
  text — a trailing one included, so a link, codespan or inline tag that opens a line
  counts on that line — and after any other inline token whose raw spans lines. A code
  block gets one marker before its `<pre>`, at its first code line, carrying
  `data-source-code`; an empty code block gets none. A raw-HTML block that renders
  anything gets one at its first line; one the sanitizer empties, such as an HTML comment,
  gets no marker and no block. Markers are inline elements: never wrappers, never inside a
  `<pre>`. Plan text cannot forge one, since the sanitizer allows no attributes on `span`.
- **The map.** `createPlanSourceMap(root)` takes the element whose content is exactly the
  rendered HTML and walks it once per version, storing runs of text offset → line. After a
  `data-source-code` marker, each `\n` in the next element's text that more code follows
  starts the next line's run. No lookup reads layout.
- **Lookups.** `lineAt` gives the line of the character at a DOM point, the last
  character's at the end of the text, and null outside the root or for an empty preview.
  `linesOf` gives the lines of a range's first and last non-whitespace characters (its
  first and last characters when it covers only whitespace), so a triple-click selection
  that ends at the next block's start reports the previous block's line. `rangeOf` gives
  the rendered text a line produced, or null for a line that produced none: blank outside
  code, link definition, fence, table delimiter row, `hr`, out of range.
- **Edges.**
  - A soft break's `\n` belongs to the line it ends.
  - The structural `\n` marked emits between tags belongs to the preceding run (before the
    first run, to the first). `lineAt` at a boundary ahead of one, such as `(tr, 0)`,
    reports the preceding line; `linesOf` skips whitespace and does not.
  - An image is atomic: a safe one renders no text, an unsafe one renders its alt with no
    marker inside. A codespan or image alt that straddles a break maps wholly to its first
    line, and the text after it starts on the right line.
  - An entity such as `&#10;` renders a `\n` but starts no line; markers come from source
    raws, not rendered text.
  - A raw-HTML block's text, a `<pre>` inside it included, maps to its first line.
  - Accepted: a line inside a leaf whose only content renders no text (a link's closing
    `](…)`, a lone inline `</b>` or `<br>`) still starts a run; with nothing after it in
    the block, the run holds only the structural whitespace, which `rangeOf` returns and
    `lineAt` reports as that line.
- **Highlighting.** Offsets resolve against the live text, so replacing a code block's
  markup, even its whole `<pre>`, with spans of the same text leaves the map valid,
  whether it was built before or after. The preview relies on this: `previewCode.ts` swaps
  a block's `code` children for token spans built through `textContent`, only when their
  text is identical, with the trailing `\n` kept. `previewRefs.ts` relies on the same
  property when it wraps a reference's text in place.
- **Comment highlight.** The preview's comment highlight reads `rangeOf` and paints a CSS
  Custom Highlight, so it inserts nothing into the root. The painted ranges are live,
  though: a later swap of the text nodes they sit in, such as `previewCode.ts`'s
  `replaceChildren`, collapses them. So while a span is active a `MutationObserver` on the
  root (child-list and character-data, subtree) repaints it.

## Surfaces

`SURFACE_BEHAVIORS` in `ui/src/lib/planView.ts` is the one place a source-view behavior
declares the surfaces it runs on: `source`, `preview`, or `compare`. `DiffPlanView` gates
each behavior through `runsOn`.

The gates exist because `SourceView` hands `DiffPlanView` an `api` and its `host`, and
nothing clears them when `SourceView` unmounts. An effect, shortcut, or surface outside
`SourceView`'s branch that reads them keeps acting on a detached shadow root unless it
gates through `runsOn`. So a row covers each effect, shortcut `enabled` guard, and
control-row or lane surface in `DiffPlanView` outside that branch. Anything inside the
branch unmounts with it and needs no gate.

Adding `"preview"` to a row switches on the source implementation, which still reads the
stale `api` and `host`. A port gives the behavior a preview implementation first, then
adds `"preview"` to its row.

`codeChrome` is the first ported behavior. `codeChrome.ts` gives it a light-DOM geometry
over the preview's `pre`s, keyed by the opening fence line (the code marker's line minus
one), and it shares the wrap set, keyed by that line, with the source view. Its copy
button copies the preview block's own text, what the reader sees (a fence nested in a list
is de-indented there), because marked and the source view's stateless fence scan can
disagree on a block's extent. A preview block gets chrome only where the source view has a
block at the same opening line, so a block with no source-view counterpart gets no chrome:
an indented or empty block, or a fence the source view's stateless scan does not see.

`headingTracking` reads the preview's reading line through `previewTopLine`. A picker jump
animates the heading's block to the jump offset with `scrollRowIntoView`, the source
view's tween. The first preview mount restores `?heading=` with an instant, held landing
through `keepPlace`. Both surfaces share `toc.ts`'s slugs and `state/headingLink.ts`.

`fileReferences` gates the lane and folder card a reference opens; the hint badges are a
separate, source-only row, `referenceHints`. `previewRefs.ts` wraps each resolved
reference's text in a `span[data-file-ref]`, finding it within its source line's rendered
range by its display text and occurrence. It changes no text, so the source map holds, and
it never fetches: the preview reuses the view's resolved map and `openFileRef`. The badges
stay source-only, under `referenceHints`.

`commentThreads` is ported through `ui/src/lib/previewComments.ts`; the slots and the
highlight run only where the `commentThreads` row runs.

- **Placement.** Threads, the open composer and draft markers render in overlay slots, one
  per block, positioned beside the preview root rather than inside it, so the root stays
  exactly the rendered HTML the source map and `planPlace` index. A comment's slot follows
  the block holding its end line; `commentSlotIndex` gives a gap line the block before it
  and a line above every block the first, where `blockIndexForLine` gives a gap line the
  next block. Anchors stay source line ranges; nothing is re-anchored to rendered
  positions. An unmeasured slot hides with `opacity: 0` and `pointer-events: none`, never
  `visibility: hidden`, so a composer mounting there can take focus.
- **Reserve.** `createSlotReserve` holds each slot's height open as `padding-block-end` on
  its block, and the slot sits at the block's bottom less that height. The reserve lives
  as long as the preview root, so a re-sync never drops a block's padding for a frame. The
  overlay state (slot boxes, the pointer and focus spans) resets on a version switch or a
  flip, as the code chrome's boxes do.
- **Highlight precedence.** The pointer's comment, else the focused comment in a slot,
  else the open composer, else the focused annotation, is highlighted as
  `caret-comment-span` over the `rangeOf` ranges of its lines.
- **Accepted trade-off.** A padded block's bottom includes its slot, so `previewTopLine`
  can report a block whose text has scrolled past the reading zone while its slot is still
  in view, and a flip to source lands on that block's start.

`keyboardCursor` is ported too. The preview cursor is `cursorLine` plus `cursorPoint`, a
column into the text that line renders, so a resize, theme switch or inserted card reflows
the text without moving the cursor off it; a `cursorPoint` on any other line than
`cursorLine` reads as the start of that line, or of the next one that renders text.
`ui/src/lib/previewLines.ts` measures visual lines per block from text-node rects, reading
only the blocks a step crosses, never the whole document. The band
(`data-caret-preview-cursor`) is an overlay sibling of `.plan-preview`, so the source
map's text order is untouched. `c`, `V` and Esc sit on their own `keyboardComments` row,
still source-only.

`textComments` opens the composer from the preview. `PlanPreview` reports a click as its
collapsed selection, and a drag as the selection the gesture changed; Shift selects
natively, and links, file references and form controls keep their own clicks.
`clampToRoot` in `previewComments.ts` resolves an end over a slot or the code chrome to
the block under the pointer. `linesOf` maps the range to source lines, and `openRange`,
the source view's opener, opens the composer there, so the open composer's line highlight
marks the selection's lines and the feedback matches a source-view comment's.
`lineComments` stays source-only: its drag readout, gutter drag and hint chips belong to
the source view's gutter, which the preview has no counterpart for; a native selection
does that job.

The preview renders a version once. `memoLast` returns the last result for the same text,
so a toggle flip or a same-version poll tick reuses it. The 2s poll re-delivers the same
version every tick; without the memo each tick would re-lex and re-sanitize the whole
plan.

### Keeping the place across a flip

A flip between source and preview keeps the reader's place, block by block. Both surfaces
read and park at the source view's reading zone and parking offset, so the block one flip
parks is the block the next flip reads back. `ui/src/lib/planPlace.ts` holds the logic;
`setPlanView` captures the place before it swaps the surface.

- **Source to preview.** The source view's top visible line goes through
  `blockIndexForLine` over `RenderedPlan.blocks`. It is a binary search over the block
  spans and measures nothing; the result indexes the preview's children.
- **Preview to source.** `previewTopLine` binary-searches the preview's children for the
  first block whose bottom passes the reading zone, then returns that block's first source
  line. A linear scan would read layout from every block above the fold, which a long plan
  makes slow. `onSourceReady` parks the source row for that line once the new `SourceView`
  mounts.
- **The landing is instant.** A flip swaps the view rather than travelling, so a smooth
  scroll would slide through unrelated text.
- **`holdPlace` re-parks** the target on every resize of the new surface's content, as
  images load and rows highlight. It releases on the reader's first wheel, touch, pointer
  press or key press, when the target or its surface is gone, on the next flip, and on a
  version change or unmount. It ignores `scroll` events, since native scroll anchoring
  moves `scrollTop` too. Each park writes an absolute `scrollTop`, never a delta, so it
  composes with native `overflow-anchor` where a browser has it and still holds in Safari
  26 and earlier, which has none.
- **A carried place beats the URL.** A resolved `?heading=` lands on the first mount of
  either surface. After that the URL holds the live mirror, so a place carried by a flip
  wins over it.
- **The keyboard cursor rides along** through `cursorLine`, with no flip code of its own;
  the next motion scrolls to it. Place-keeping does not follow the cursor.

Place-keeping is not a `SURFACE_BEHAVIORS` row. It runs at the flip itself, not on a
surface.

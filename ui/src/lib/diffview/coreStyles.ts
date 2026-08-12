// @pierre/diffs lays out a File/FileDiff (gutter + content grid, sticky header,
// annotation slots) with a core stylesheet that only its web component adopts.
// caret renders the File/FileDiff classes directly in container-managed mode, so
// it owns the shadow root and adopts that stylesheet here — without it the
// content column collapses to zero width and only the line-number gutter shows.

import fileIconRaw from "@/icons/file.svg?raw";
import folderIconRaw from "@/icons/folder.svg?raw";
import { DIFFS_CORE_STYLES } from "$lib/diffview/diffsCoreStyles.ts";

// The vendored Lucide `file` glyph as a CSS mask source (EXC-687). Rendered as a
// mask rather than an <img> so it takes the ink color of the surrounding text via
// background-color, matching how Icon.svelte colors an SVG through currentColor.
const FILE_ICON_MASK = `url("data:image/svg+xml,${encodeURIComponent(fileIconRaw)}")`;
// Its counterpart for a reference the daemon resolved to a directory (EXC-918).
const FOLDER_ICON_MASK = `url("data:image/svg+xml,${encodeURIComponent(folderIconRaw)}")`;

// caret's adjustments layered over the vendored core stylesheet. The gutter and
// content sit in adjacent grid columns with no gap, which reads cramped — line
// numbers crowd the code, most visibly under a line's hover highlight. Inline-start
// padding on the content column opens that seam without shifting the gutter, and
// also gives the hover "+" comment button a lane to sit in. By default the library
// pins that button to the number column's right edge and pulls it left with a
// negative margin, so it overlaps the line number; widening that negative margin
// nudges it past the digits into the gutter→content seam instead. That margin
// value is empirical — tuned against the library's own `calc(1ch - 1lh)` offset,
// so it may need revisiting if @pierre/diffs changes its gutter layout.
//
// The gutter "+" carries caret's accent. The library fills [data-utility-button]
// with var(--diffs-modified-base) — library blue — which the amber-selection-only
// strategy keeps for the change-type icons and merge-conflict incoming. Recoloring
// the comment affordance has to stay scoped to this one element rather than
// retargeting --diffs-modified-base (that would bleed amber into those too), so the
// fill is set here, in the override sheet caret already adopts into the shadow root.
// caret's accent tokens are :root custom properties and inherit through the shadow
// boundary, so var(--accent) resolves correctly. The "+" reads accent at rest and
// brightens on hover/focus, matching the composer's solid action button; the
// focus-visible ring keeps the keyboard path to the composer visible.
const CARET_OVERRIDES = `
  /* Single source for the gutter→content seam width (EXC-664). The content inset
     that opens the seam and the selected-band pull that fills it must move
     together, so they share one named value rather than coupled literals. */
  :host { --caret-seam: 20px; }
  [data-content] { padding-inline-start: var(--caret-seam); }
  [data-utility-button] {
    margin-right: calc(1ch - 1lh - 0.5rem);
    background-color: var(--accent);
    color: var(--accent-ink);
    /* Raised, softened comment affordance: rounder corners and a layered drop
       shadow (a tight contact shadow plus a wider ambient one) lift the "+" off
       the diff surface, with a top-edge inset highlight for the bevel. Static (no
       transition) — this sheet isn't in the motion.test chrome set, but keeping it
       still avoids surprises. */
    border-radius: var(--radius);
    box-shadow:
      0 1px 1.5px #0000003d,
      0 2px 5px #0000004d,
      inset 0 1px 0 #ffffff4d;
  }
  [data-utility-button]:hover { background-color: var(--accent-bright); }
  [data-utility-button]:focus-visible {
    background-color: var(--accent-bright);
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }

  /* EXC-788: the focused-line cursor. SourceView tags BOTH cells of the row the
     keyboard cursor sits on (j/k, Ctrl+d/u, gg/G, ]]/[[, }/{) — the content
     [data-line] and its gutter [data-column-number], mirroring the library's own
     [data-selected-line] — with data-caret-cursor. A faint neutral band
     illuminates the whole row, and a solid bar hangs off the gutter's far-left
     edge (left of the line number) as the caret marker. Deliberately NON-amber
     (amber stays reserved for the selection band), so the three affordances read
     distinct: bar + row band = cursor, "+" = hover, amber band = selection. No
     transition — the diff surface swaps state instantly (svelte-rules § Motion).
     :not([data-selected-line]) yields a selected line to the amber band; declared
     before the code-block rules so a cursor on a fenced line keeps its panel fill.
     The band joins across the gutter→content seam through the shared seam-fill
     :is() groups below, which list data-caret-cursor alongside hover/selection. */
  [data-gutter] > [data-column-number][data-caret-cursor]:not([data-selected-line]) {
    background-color: color-mix(in lab, var(--paper), var(--ink) 7%);
    box-shadow: inset 3px 0 0 0 var(--ink);
  }
  [data-content] [data-line][data-caret-cursor]:not([data-selected-line]) {
    background-color: color-mix(in lab, var(--paper), var(--ink) 7%);
  }

  /* Multi-line selection affordance (GitHub-style). During a click-drag range
     select, the library renders the "+" button only in the row under the pointer
     (the one it flags [data-hovered]); the other selected rows would otherwise
     show nothing in the seam. Give each of those a faded accent tick centered in
     the "+" lane, so the whole range reads as one selection and it's clear the
     button rides with the pointer. Scoped to :not([data-hovered]) so it never
     doubles up with the real button on the active row. */
  [data-gutter] > [data-column-number][data-selected-line]:not([data-hovered]) {
    position: relative;
  }
  [data-gutter] > [data-column-number][data-selected-line]:not([data-hovered])::after {
    content: "";
    position: absolute;
    top: 22%;
    bottom: 22%;
    right: calc(var(--caret-seam) / -2 - 1.5px);
    width: 3px;
    border-radius: var(--radius);
    background-color: var(--accent);
    opacity: 0.45;
    pointer-events: none;
  }

  /* EXC-692: a fenced code block reads as a slightly-indented, darker, rounded
     panel in the content column. The library paints no per-line code marker, so
     caret tags each content line inside a fence with data-code-line, plus
     data-code-start / -end on the block's first / last line (see codeBlocks.ts,
     re-applied after every repaint by SourceView). Line numbers stay in the gutter
     — the panel is the content column only. The fill mixes one step toward --ink
     off the diff surface (--paper-sunk) with the same in-lab color-mix the layered
     surfaces use, so it carries correct depth in both schemes (a sunk panel on
     light paper, a raised one on dark). The panel is a contained card: inset from
     the gutter (margin-inline-start) and from the right (margin-inline-end), and
     capped at a comfortable reading width (max-width) so it never stretches full-
     bleed across a wide viewport — when the content column is narrower than the cap,
     the right margin still keeps it off the edge. The code keeps the library's
     default 2ch inset within the card (no extra indent). Only the OUTER edges of the
     block are padded — the opening fence's top and the closing fence's bottom — so
     the fence lines hug the code (no gap below the opening markers or above the
     closing markers). The closing fence's bottom pad is smaller than the opening
     fence's top pad on purpose: a fence marker glyph sits high in its line box (a
     digit at the baseline), so an equal pad would leave a visibly larger gap below
     the closing markers; the smaller value evens the top and bottom margins by eye.
     This is a glyph metric, not a gutter thing, so the gutter stays as-is. The
     :not([data-selected-line]) guard yields a selected code line to the amber
     band below: CARET_OVERRIDES is adopted after the core sheet, so without it this
     fill would win over the library's selection highlight. Rounding hangs off the
     block's first line (top) and last line (bottom), tagged explicitly rather than
     via :not(~) since a plan may hold several blocks. */
  [data-content] > [data-line][data-code-line]:not([data-selected-line]) {
    background-color: color-mix(in lab, var(--paper-sunk), var(--ink) 6%);
    margin-inline-start: 0.75rem;
    margin-inline-end: 0.75rem;
    max-width: 720px;
    padding-inline-start: 2ch;
    padding-inline-end: 0.75rem;
    /* EXC-729: the library renders source lines white-space: pre (never wrapping), so a line
       wider than the capped card would break out of the panel background. An overflowing block
       is wrapped in a scroll card (codeBlockScroll.ts + the [data-code-card] rules below) that
       scrolls it as one unit; this clip is the guard for the frame before that wrap runs (and
       the graceful floor if the script never does) — the over-wide line clips at the card's
       right edge instead of spilling out. Only the inline axis is clipped, so the block axis
       stays visible and the EXC-692 fence-glyph nudges are not shaved. */
    overflow-x: clip;
  }
  [data-content] > [data-line][data-code-start]:not([data-selected-line]) {
    border-top-left-radius: var(--radius);
    border-top-right-radius: var(--radius);
    padding-block-start: 0.5rem;
  }
  [data-content] > [data-line][data-code-end]:not([data-selected-line]) {
    border-bottom-left-radius: var(--radius);
    border-bottom-right-radius: var(--radius);
    padding-block-end: 0.1rem;
  }
  /* EXC-692 glyph centering. A fence marker glyph sits high in its line box, so it
     reads as too high when the row is not top-padded. The opening markers already
     look centered (their row carries padding-block-start), so they are left alone;
     only the closing markers and the opening language tag are shifted to their row's
     vertical center. shiki attaches no classes, so codeBlocks.ts tags both tokens
     (data-code-fence on each fence's markers, data-code-lang on the language) and each
     is shifted with position: relative, which moves the glyph without touching the
     panel background or the row layout. The closing markers move down; the language,
     a baseline word that its row's top padding has pushed low, moves up. Both offsets
     are em-relative eyeball values — the two knobs to tune if either token looks off
     center. */
  [data-content] > [data-line][data-code-end]:not([data-selected-line]) [data-code-fence] {
    position: relative;
    top: 0.2em;
  }
  [data-content] > [data-line][data-code-start]:not([data-selected-line]) [data-code-lang] {
    position: relative;
    top: -0.12em;
  }

  /* EXC-869: the fence markers wear the chip family's round-rect treatment (EXC-855), so a
     block's delimiters read as deliberate punctuation rather than stray backticks. ONE
     descendant selector covers both card paths — direct-child rows and the rows an
     overflowing block's scroll card re-parents (codeBlockScroll.ts) — the same form the
     hover/cursor band below already uses, rather than the duplicated pair the EXC-692 nudges
     above still carry. The :not() guard is not about the amber band (this paints a token, not
     a row fill, so it never competes): it drops the chip on a row the reviewer has selected,
     so a drag-selection reads as one flat band.

     The tint is --chip-code itself, the family's inline-code token (EXC-858 derives all five
     in the palette recipe), so the fence chip and the inline-code chip are the same tint by
     construction rather than by a matched value. Nothing is declared here. The token is a
     translucent wash rather than an opaque mix, which is what lets one tint serve both
     surfaces: it composites over the code panel here and over the bare diff surface where
     inline code sits, reading the same on each.

     The markers keep the --ink-faint ink caret-theme.ts already gives them, which is the ink
     the chip family prescribes for markers.

     The chip carries NO padding, in either axis, and each axis is refused for its own reason.
     Inline padding would shift every glyph after the markers (rows render white-space: pre)
     and on the opening row would slide the tint under the language tag, which keeps its own
     prominent treatment — a cancelled padding/negative-margin pair, as [data-file-ref] below
     uses, is the escape hatch if the chip ever needs breathing room. Block padding is free of
     that hazard (padding on an inline box never grows the line box) but has nowhere to go on
     the CLOSING row, which spends its slack twice over: the panel's own padding-block-end is
     only 0.1rem there, and the markers additionally carry the EXC-692 downward nudge. Padded,
     the chip escaped that row's box and drew a sliver under the panel's rounded bottom edge.
     The inline content box is already most of the line box, so the chip reads as a round-rect
     without it. diff-surface.e2e.ts pins the containment in a real browser. */
  [data-content] [data-line][data-code-line]:not([data-selected-line]) [data-code-fence] {
    background-color: var(--chip-code);
    border-radius: var(--radius);
  }

  /* EXC-867: the inline emphasis chips, the first prose members of the chip family
     (EXC-855). inlineDecorate.ts splits each row's tokens so none straddles an element
     boundary and tags them data-md; these rules are the whole visual treatment, and the
     REAL weight and slant come from shiki (caret-theme.ts) rather than from here — which
     matters, because EXC-858 measured bold's and italic's tints within a 1.05 contrast
     ratio in five of the nine palettes. The tint says "this span is a chip"; the glyph
     says which one it is.

     Two background LAYERS rather than one background-color, because a run can carry two
     members at once and both must show. Triple-starred text is genuinely bold and italic,
     and the middle run of a bold element wrapping inline code is bold and code — with a
     single background-color the more specific rule would win and punch a visible gap
     through the middle of the bold pill. Each layer resolves to transparent through the
     var() fallback when its member is absent, so no default declaration is needed and
     nothing has to out-specify anything. A later member (EXC-868, EXC-859, EXC-880) adds
     one line here and one layer above.

     No backtick appears in this comment, or anywhere else in CARET_OVERRIDES: the sheet is
     a template literal, so one would close it early.

     NO PADDING, in either axis, and here the inline half is not a preference but the
     issue's stated ladder trigger. Rows render white-space: pre, so inline padding shifts
     every glyph after the chip and the monospace grid stops matching the source columns —
     which is what vim motions, drag-range selection and the search highlights all resolve
     against. The cancelled padding/negative-margin pair [data-file-ref] uses works there
     only because a reference is an isolated token; emphasis chips can abut, so the
     negative margins would overlap. Block padding is refused for the reason EXC-869 gives
     just above, and because a chip taller than its line box reads as confetti in a dense
     paragraph — the failure mode EXC-855 names.

     Rounded ends ride the GROUP, not the run: an element fragmented into several runs
     gets its radius on the first and last only, so the pill closes once. That is why the
     start/end attributes exist rather than a blanket border-radius, and it is the same
     shape data-code-start / data-code-end already draw for fenced blocks. Logical
     longhands so the ends follow the writing direction. The :not() guard drops the chip on
     a selected row, so a drag-selection reads as one flat band — exactly as the fence chip
     above does. */
  /* The weight and slant themselves, which have to be declared HERE rather than coming
     from shiki, and this is the one surprise in the whole ticket. shiki does resolve the
     emphasis font style (caret-theme.ts appends the rules, and they win), and @pierre/diffs
     does carry it into the DOM — but as a custom property, consumed by its own core sheet as
     font-weight: light-dark(var(--diffs-token-light-font-weight, inherit), …). light-dark()
     is defined over <color> only, so that declaration is invalid and dropped: in a real
     Chromium, CSS.supports("font-weight", "light-dark(bold, bold)") is false while the color
     form is true. The property lands on the element carrying "bold" and the computed weight
     stays 400. Every token in the library renders at one weight and one slant, whatever the
     theme says — a standing upstream finding, not something caret can fix in the theme.

     So the decoration pass's own attributes carry it. That is also why the emphasis rules in
     caret-theme.ts are still worth having: their MARKER half is a color, so it does survive,
     and it is what splits a bold span into three tokens for this pass to tag.

     Deliberately NOT guarded by :not([data-selected-line]). Weight and slant are what the
     text IS, not decoration on top of it — a selected row still contains bold text — so only
     the chip tint below drops on selection. Same distinction EXC-880 draws for the reference
     chip, arrived at from the other side. */
  [data-content] [data-line] [data-md~="bold"] {
    font-weight: bold;
  }
  [data-content] [data-line] [data-md~="italic"] {
    font-style: italic;
  }

  [data-md~="bold"] {
    --md-bold: var(--chip-bold);
  }
  [data-md~="italic"] {
    --md-italic: var(--chip-italic);
  }
  [data-content] [data-line]:not([data-selected-line]) [data-md] {
    background-image:
      linear-gradient(var(--md-bold, transparent), var(--md-bold, transparent)),
      linear-gradient(var(--md-italic, transparent), var(--md-italic, transparent));
  }
  [data-content] [data-line]:not([data-selected-line]) [data-md-start] {
    border-start-start-radius: var(--radius);
    border-end-start-radius: var(--radius);
  }
  [data-content] [data-line]:not([data-selected-line]) [data-md-end] {
    border-start-end-radius: var(--radius);
    border-end-end-radius: var(--radius);
  }

  /* EXC-729: an overflowing fenced block is wrapped in one scroll card (codeBlockScroll.ts)
     that is a single native horizontal scroll container — the whole block scrolls as one unit
     (short lines follow the wide ones, one scrollbar at the bottom, no per-row jelly). The card
     is a subgrid, so its rows still map to the parent row tracks and the gutter line numbers
     stay aligned; grid-auto-columns: max-content sizes the scroll content to the widest line
     while max-width caps the visible card. It carries the same panel look as the per-row card
     above — a fitting block keeps that path (its direct-child rows never match this card
     selector), so a scrolling block and a fitting one read identically. */
  [data-content] > [data-code-card] {
    grid-column: 1 / -1;
    display: grid;
    grid-template-rows: subgrid;
    grid-auto-columns: max-content;
    overflow-x: auto;
    overflow-y: hidden;
    max-width: 720px;
    margin-inline: 0.75rem;
    background-color: color-mix(in lab, var(--paper-sunk), var(--ink) 6%);
    border-radius: var(--radius);
  }
  /* The library paints every line with its own --diffs-bg, so clear it inside the card for
     the darker panel fill to show through; keep the code's 2ch inset and end padding. A
     selected line is left to the library's amber highlight (EXC-664) via the :not guard. */
  [data-content] > [data-code-card] > [data-line][data-code-line] {
    padding-inline-start: 2ch;
    padding-inline-end: 0.75rem;
  }
  [data-content] > [data-code-card] > [data-line][data-code-line]:not([data-selected-line]) {
    background-color: transparent;
  }
  /* Symmetric breathing room top and bottom. The ::-webkit-scrollbar height (below) makes the
     browser reserve the bar's own lane at the card's bottom edge, so this padding is only the
     gap between the last code line and that bar — no extra bar-height reservation is needed
     here (that double-counted and left a dead gap). The gutter's matching tracks grow with
     these paddings via subgrid, so the line numbers stay aligned. */
  [data-content] > [data-code-card] > [data-line][data-code-start] {
    padding-block-start: 0.5rem;
  }
  [data-content] > [data-code-card] > [data-line][data-code-end] {
    padding-block-end: 0.5rem;
  }
  /* One always-visible scrollbar at the card's bottom. Styling ::-webkit-scrollbar opts out
     of the platform's auto-hiding overlay bar (the standard scrollbar-* props would pull it
     back in Chromium, where caret renders); the thumb is a caret-neutral ink mix — no amber,
     the diff surface reserves amber for selection — inset by a transparent border so it reads
     as a thin pill in the lane. */
  [data-content] > [data-code-card]::-webkit-scrollbar { height: 12px; }
  [data-content] > [data-code-card]::-webkit-scrollbar-track { background: transparent; }
  [data-content] > [data-code-card]::-webkit-scrollbar-thumb {
    background: color-mix(in lab, var(--paper-sunk), var(--ink) 45%);
    border: 3px solid transparent;
    border-radius: var(--radius);
    background-clip: content-box;
  }
  [data-content] > [data-code-card]::-webkit-scrollbar-thumb:hover {
    background: color-mix(in lab, var(--paper-sunk), var(--ink) 60%);
    background-clip: content-box;
  }
  /* The card's fence lines need the same glyph-centering nudges as the per-row card above
     (whose rules match direct-child rows only). */
  [data-content] > [data-code-card] > [data-line][data-code-end]:not([data-selected-line]) [data-code-fence] {
    position: relative;
    top: 0.2em;
  }
  [data-content] > [data-code-card] > [data-line][data-code-start]:not([data-selected-line]) [data-code-lang] {
    position: relative;
    top: -0.12em;
  }

  /* EXC-788: a banded row — the focused-line cursor OR a pointer hover — ON a
     fenced code line. The code-panel fill above is same-specificity-but-later than
     the base cursor/hover bands, so on a code row the band dies at the seam: the
     content cell keeps the flat panel fill (hover), or the gutter cell keeps the
     dim base cursor tint (cursor), so the row reads half-banded. Re-assert the band
     on BOTH columns as a brighter step OF the panel — paper-sunk + ink 9%, ~one
     prose-cursor step (+2.8 L) above the panel base — so a focused/hovered code row
     lifts within the block the way a prose row lifts off the surface: visible over
     the syntax colors, panel identity intact, cursor and hover consistent (the caret
     bar vs the "+" still tell them apart). The content arm is a descendant combinator
     so it also covers an overflowing block's rows (moved into [data-code-card]); the
     gutter arm needs its number cell tagged data-code-line (tagCodeBlockRows), since
     CSS can't relate a gutter cell to its content sibling across the two grid
     columns. Placed after the card rules so it beats the card's transparent fill on
     source order. Yields to the amber selection; the +/- change tints never reach
     the panel (it is single-version only). */
  [data-content] [data-line][data-code-line]:is([data-hovered], [data-caret-cursor]):not([data-selected-line]),
  [data-gutter] > [data-column-number][data-code-line]:is([data-hovered], [data-caret-cursor]):not([data-selected-line]) {
    background-color: color-mix(in lab, var(--paper-sunk), var(--ink) 9%);
  }
  /* Fill the gutter→content seam on a banded code row so the band reads continuous
     across it, like a non-code row does. A non-code banded row pulls its content
     cell left across --caret-seam (the seam-fill group below) to cover the seam;
     a code row can't — its panel inset (margin-inline-start: 0.75rem, on top of the
     content column's --caret-seam) overrides that pull, so the strip between the
     banded gutter cell and the inset band stays unpainted. A left box-shadow paints
     exactly that strip (width = the two insets, --caret-seam + 0.75rem) WITHOUT
     moving the cell or its code text, and without fighting the panel's
     overflow-x: clip / max-width the way a negative margin would. Same band color as
     the fill; the gutter's own divider is already cleared to transparent for banded
     rows (seam-fill group), so gutter band + this strip + content band read as one.
     Fitting-block rows only ([data-content] > …); an overflowing block's card owns
     its own inset. Yields to the amber selection via the shared :not guard. */
  [data-content] > [data-line][data-code-line]:is([data-hovered], [data-caret-cursor]):not([data-selected-line]) {
    box-shadow: calc(-1 * (var(--caret-seam) + 0.75rem)) 0 0 0
      color-mix(in lab, var(--paper-sunk), var(--ink) 9%);
  }

  /* EXC-664: the drag-to-comment selection reads as ONE continuous amber band
     spanning the gutter and content columns, with a tighter corner than before
     (--radius, down from --radius-lg). The amber is the library's per-cell
     [data-selected-line] highlight; the view is a two-column grid (line-number
     cells [data-column-number] in [data-gutter], content cells [data-line] in
     [data-content]), and [data-content]'s padding-inline-start (above) opens a
     seam between the columns. To make the band continuous, each selected content
     line cell is pulled across that seam with a negative inline-start margin (the
     shared --caret-seam), the inset re-added as padding so the text never moves;
     the gutter column's per-row divider is dropped for selected rows so the two
     halves join with no unfilled gap. Rounding hangs only off the band's OUTER
     corners — the gutter's left (top + bottom) and the content's right; inner
     corners stay square so the join is seamless. :not(~) selects a column's first
     selected line (top), :not(:has(~)) its last (bottom). Everything is scoped to
     the line cells ([data-column-number] / [data-line]), and the last-row detection
     only counts trailing line cells — so an open composer's row (the
     [data-gutter-buffer] / [data-line-annotation] pair the library also flags
     selected) is excluded from the band: its fill is cleared so the surface shows
     through, reading as a card over the background rather than as more band. Line
     numbers are always shown, so the gutter never collapses and the content's left
     corners never need rounding. */
  /* Continuous row band across the seam (EXC-664 generalized). The pull that made
     the drag-select amber band unbroken is shared by EVERY row that carries a
     background band: the drag-select selection ([data-selected-line]), the pointer
     hover grey ([data-hovered]), and the add/del change tint
     ([data-line-type=change-*]). Without it each band stops at the content
     column's inset and the surface-colored gutter divider, leaving a gap at the
     "+" lane. Two moves per banded row: (1) pull the content line cell left across
     the shared --caret-seam with a negative margin and re-add the inset as padding
     so the line's background covers the seam while its text never moves; (2) clear
     the gutter number column's 2px divider (painted in the surface color, so on a
     tinted row it reads as a gap) — a transparent border lets the cell's own band
     show through, joining the two halves. Rounding stays selection-only (below),
     so change/hover bands read square and multi-row change blocks stay continuous.
     The base [data-line] inline padding is 1ch; when a glyph lane is shown
     (classic or caret's "both" indicators) it is 2ch, handled by the override. */
  [data-content]
    > [data-line]:is(
      [data-selected-line],
      [data-hovered],
      [data-line-type="change-addition"],
      [data-line-type="change-deletion"],
      [data-caret-cursor]
    ) {
    margin-inline-start: calc(-1 * var(--caret-seam));
    padding-inline-start: calc(1ch + var(--caret-seam));
  }
  [data-indicators="classic"]
    [data-content]
    > [data-line]:is(
      [data-selected-line],
      [data-hovered],
      [data-line-type="change-addition"],
      [data-line-type="change-deletion"]
    ),
  :host([data-caret-indicators="both"])
    [data-content]
    > [data-line]:is(
      [data-selected-line],
      [data-hovered],
      [data-line-type="change-addition"],
      [data-line-type="change-deletion"]
    ) {
    padding-inline-start: calc(2ch + var(--caret-seam));
  }
  [data-gutter]
    > [data-column-number]:is(
      [data-selected-line],
      [data-hovered],
      [data-line-type="change-addition"],
      [data-line-type="change-deletion"],
      [data-caret-cursor]
    ) {
    border-right-color: transparent;
  }

  /* Combined markers — caret's "both" indicators (the library has no such mode).
     The library is driven at "bars", so the gutter bars already render; here caret
     overlays the classic +/- glyphs in the content column so both cues show at
     once. This mirrors the library's own classic-glyph rules — a 2ch inline lane
     on every content line, plus a positioned ::before carrying + / - on the
     add/del change rows — scoped to the host flag so it never leaks into bars or
     classic mode. The glyph sits at the content line's inline-start; on change
     rows the seam-fill pull above moves that origin across the seam, so the glyph
     reads as sitting in the "+" lane — the same placement classic mode gets. */
  :host([data-caret-indicators="both"]) [data-content] [data-line] {
    padding-inline-start: 2ch;
  }
  :host([data-caret-indicators="both"])
    [data-content]
    :is([data-line], [data-no-newline])[data-line-type="change-addition"]::before,
  :host([data-caret-indicators="both"])
    [data-content]
    :is([data-line], [data-no-newline])[data-line-type="change-deletion"]::before {
    content: "";
    width: 1ch;
    height: 1lh;
    display: inline-block;
    position: absolute;
    top: 0;
    left: 0;
    -webkit-user-select: none;
    user-select: none;
  }
  :host([data-caret-indicators="both"])
    [data-content]
    :is([data-line], [data-no-newline])[data-line-type="change-addition"]::before {
    content: "+";
    color: var(--diffs-addition-base);
  }
  :host([data-caret-indicators="both"])
    [data-content]
    :is([data-line], [data-no-newline])[data-line-type="change-deletion"]::before {
    content: "-";
    color: var(--diffs-deletion-base);
  }
  [data-gutter]
    > [data-column-number][data-selected-line]:not(
      [data-selected-line] ~ [data-column-number][data-selected-line]
    ) {
    border-top-left-radius: var(--radius);
  }
  [data-content]
    > [data-line][data-selected-line]:not(
      [data-selected-line] ~ [data-line][data-selected-line]
    ) {
    border-top-right-radius: var(--radius);
  }
  [data-gutter]
    > [data-column-number][data-selected-line]:not(:has(~ [data-column-number][data-selected-line])) {
    border-bottom-left-radius: var(--radius);
  }
  [data-content]
    > [data-line][data-selected-line]:not(:has(~ [data-line][data-selected-line])) {
    border-bottom-right-radius: var(--radius);
  }
  /* The composer/annotation row the library also flags selected is NOT part of the
     band: clear its selection fill (both columns) so the surface background shows
     through to the left of the composer card. */
  [data-gutter] > [data-gutter-buffer][data-selected-line],
  [data-content] > [data-line-annotation][data-selected-line] {
    background-color: transparent;
  }

  /* Match the annotation row's gutter to the plan surface (EXC-765). The library
     bases the annotation row's background on --diffs-bg-context — a step lighter
     than --diffs-bg — so the gutter strip to the left of a saved or draft comment
     read subtly lighter than the code gutter above and below it, drawing the eye
     to a seam that isn't meaningful. Rebinding the row's single base var to
     --diffs-bg drops it onto the same surface as the surrounding lines (the
     library's computed row backgrounds all cascade from this one var); the
     card/composer still paints its own paper-raised over the content cell, so only
     the bare gutter buffer changes. Higher specificity than the library's
     [data-line-annotation] base rule, and adopted after it, so it wins. */
  [data-gutter] > [data-gutter-buffer="annotation"],
  [data-content] > [data-line-annotation] {
    --diffs-annotation-bg: var(--diffs-bg);
  }

  /* EXC-687: a resolved filename reference in the plan carries a small file icon
     before its token. fileRefTag.ts tags the token that starts each reference
     data-file-ref; the icon is the vendored Lucide file glyph as a mask, so it
     takes the faint ink color and sits inline with the mono text. Scoped to the
     content column so it never lands in the gutter. */
  [data-content] [data-file-ref]::before {
    content: "";
    display: inline-block;
    width: 0.85em;
    height: 0.85em;
    margin-right: 0.25em;
    vertical-align: -0.1em;
    background-color: var(--ink-faint);
    -webkit-mask: ${FILE_ICON_MASK} no-repeat center / contain;
    mask: ${FILE_ICON_MASK} no-repeat center / contain;
  }

  /* EXC-918: a reference the daemon resolved to a DIRECTORY draws the folder
     glyph instead. The mask is all that changes — the rule above already sized,
     tinted and spaced the box, and every other [data-file-ref] rule below (the
     pointer cursor, the chip padding, the resting fill, the hover wash) matches a
     directory token
     too, because the kind rides on the attribute's value rather than a second
     attribute. So a folder reference reads as the same pressable chip, pointing
     at a different surface. */
  [data-content] [data-file-ref="directory"]::before {
    -webkit-mask: ${FOLDER_ICON_MASK} no-repeat center / contain;
    mask: ${FOLDER_ICON_MASK} no-repeat center / contain;
  }

  /* The reference opens its preview on click, so the token reads as a pressable
     chip — always the pointer cursor, and always a filled round-rect. It RESTS in
     --chip-ref (EXC-880), the reference member of the chip family: a resolved path
     is tinted where it sits, so which spans of a plan can be opened is a glance
     rather than a pointer sweep. The tint is the derived token, never a literal,
     which is what makes all nine palettes supply it; it rides a different source
     hue from --chip-code, so a reference is distinct from ordinary inline code by
     construction. A file and a directory share the one tint — they are the same
     class of thing, and the glyph above is what tells them apart.

     Hover then swaps the fill to the warm accent wash (EXC-840) — a change of hue and
     a touch more alpha, the hue carrying nearly all of it — so pressing one still
     reads as a change of state. theme.test.ts holds that pair 60 degrees apart in
     every palette, because the resting state used to be transparent and any wash read
     against it for free; now it has to be told from a green. Padding gives the fill
     breathing room so it reads as a chip around the whole reference rather than
     crowding the glyphs; a matching negative inline margin offsets it so the backticks
     bracketing the token never shift. The radius sits on the resting rule because the
     shape is constant — only the fill moves. The swap is instant: the diff surface is
     motionless by design, so no transition here. The icon sharpens from faint to full
     ink alongside it.

     Unlike the fence chip above, this one is NOT suppressed on a selected row. The
     fence chip is decoration, so dropping it lets a drag-selection read as one flat
     band; this one is an affordance, and hiding it on selection would claim the span
     stopped being clickable when it hasn't. A green pill inside the selection band is
     the deliberate cost. */
  [data-content] [data-file-ref] {
    cursor: pointer;
    padding: 0.1em 0.3em;
    margin-inline: -0.3em;
    background-color: var(--chip-ref);
    border-radius: var(--radius);
  }
  [data-content] [data-file-ref]:hover {
    background-color: var(--accent-wash);
  }
  [data-content] [data-file-ref]:hover::before {
    background-color: var(--ink);
  }

  /* EXC-832: the vim / search highlights. searchHighlight.ts registers two named
     CSS Custom Highlights over the rendered rows — every non-current match in
     "caret-search", the active match in "caret-search-current". They are styled
     here, in the override sheet adopted into the same shadow root the highlighted
     ranges live in, because ::highlight() resolves against the tree scope of the
     text it paints (not the document). A search hit is a marked region of the
     document, so the pair reads caret's content-highlight vocabulary — --mark for
     every match, --mark-active for the current one. That is the two-step the
     recipe's ALPHA.mark / ALPHA.markActive exists to produce, and it leaves the
     syntax colors legible under both washes rather than replacing them. The accent
     these used to carry belongs to selection, a different job (EXC-905). */
  ::highlight(caret-search) {
    background-color: var(--mark);
  }
  ::highlight(caret-search-current) {
    background-color: var(--mark-active);
  }

  /* The resting-state link mark. The link layer collapses [label](url)
     to its label, so shiki paints a link as ordinary prose and it read as body
     copy until hovered. linkHighlight.ts registers the exact link columns as the
     "caret-link" highlight and this styles them — the only two properties a
     highlight pseudo needs here, both of which it supports.

     A LINK, not a marked region: the search pair above washes a background,
     because a hit is a region of the document caret painted onto. A link is a
     control the reader can act on, so it marks itself the way body text does —
     the glyphs take the color and the underline sits under them. The tint is a
     minority mix of the accent into --ink rather than the accent itself: amber
     stays scarce and brand-reserved (the amber-selection-only strategy in
     styles/diffview.css), and prose littered with full-strength accent would
     spend it everywhere. Both operands carry light/dark variants, so the mix
     resolves warm-on-dark and warm-on-paper without a second rule. The underline
     is dotted and offset clear of the descenders — present at a glance, quiet
     enough to read a paragraph through. Hover still adds the pointer cursor and
     the href tooltip (linkInteractions.ts); this is what the link looks like
     before the pointer arrives. */
  ::highlight(caret-link) {
    color: color-mix(in lab, var(--ink), var(--accent) 45%);
    text-decoration: underline dotted;
    text-underline-offset: 0.22em;
  }
`;

// Constructable sheets shared across every view's shadow root, the override
// adopted after the core sheet so it wins. Adopted sheets are independent of a
// root's child nodes, so they survive the replaceChildren() the lifecycle runs
// when it swaps content.
let sheet: CSSStyleSheet | undefined;
let overrides: CSSStyleSheet | undefined;

/**
 * Ensures the @pierre/diffs core stylesheet is present in `root`. Idempotent:
 * adopting the shared sheet a second time is a no-op, and the <style> fallback
 * is keyed so it is only inserted once. Prefers adoptedStyleSheets, falling back
 * to a <style> node where constructable stylesheets are unavailable.
 */
export function ensureCoreStyles(root: ShadowRoot): void {
  if (typeof CSSStyleSheet === "function" && "adoptedStyleSheets" in root) {
    if (!sheet) {
      sheet = new CSSStyleSheet();
      sheet.replaceSync(DIFFS_CORE_STYLES);
    }
    if (!overrides) {
      overrides = new CSSStyleSheet();
      overrides.replaceSync(CARET_OVERRIDES);
    }
    const want = [sheet, overrides];
    if (!want.every((s) => root.adoptedStyleSheets.includes(s))) {
      root.adoptedStyleSheets = [
        sheet,
        ...root.adoptedStyleSheets.filter((s) => s !== sheet && s !== overrides),
        overrides,
      ];
    }
    return;
  }
  if (!root.querySelector("style[data-caret-core-css]")) {
    const el = document.createElement("style");
    el.dataset.caretCoreCss = "";
    el.textContent = `${DIFFS_CORE_STYLES}\n${CARET_OVERRIDES}`;
    root.prepend(el);
  }
}

// @pierre/diffs lays out a File/FileDiff (gutter + content grid, sticky header,
// annotation slots) with a core stylesheet that only its web component adopts.
// caret renders the File/FileDiff classes directly in container-managed mode, so
// it owns the shadow root and adopts that stylesheet here — without it the
// content column collapses to zero width and only the line-number gutter shows.

import fileIconRaw from "@/icons/file.svg?raw";
import { DIFFS_CORE_STYLES } from "$lib/diffview/diffsCoreStyles.ts";

// The vendored Lucide `file` glyph as a CSS mask source (EXC-687). Rendered as a
// mask rather than an <img> so it takes the ink color of the surrounding text via
// background-color, matching how Icon.svelte colors an SVG through currentColor.
const FILE_ICON_MASK = `url("data:image/svg+xml,${encodeURIComponent(fileIconRaw)}")`;

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
    outline: 2px solid var(--accent-bright);
    outline-offset: 2px;
  }

  /* EXC-788: the focused-line cursor. SourceView tags the content row the
     keyboard cursor sits on (j/k, Ctrl+d/u, gg/G, ]]/[[) with data-caret-cursor;
     a solid left bar — the caret ^ motif — is the marker, with a faint neutral
     band reinforcing the row. Deliberately NON-amber (amber stays reserved for
     the selection band) and content-column only (NOT the full-width row band the
     grey hover-+ paints), so the three affordances read distinct: bar = cursor,
     "+" = hover, amber band = selection. No transition — the diff surface swaps
     state instantly (svelte-rules § Motion). :not([data-selected-line]) yields an
     amber-selected line to selection; declared before the code-block rules so a
     cursor on a fenced line keeps its panel fill (the code rules set only
     background-color, so the box-shadow bar still shows over the panel). */
  [data-content] [data-line][data-caret-cursor]:not([data-selected-line]) {
    background-color: color-mix(in lab, var(--paper), var(--ink) 7%);
    box-shadow: inset 2px 0 0 0 var(--ink);
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
     vertical center. shiki attaches no classes, so codeBlocks.ts tags the two tokens
     (data-code-fence on the closing markers, data-code-lang on the language) and each
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
      [data-line-type="change-deletion"]
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
      [data-line-type="change-deletion"]
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

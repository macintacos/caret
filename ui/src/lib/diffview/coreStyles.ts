// @pierre/diffs lays out a File/FileDiff (gutter + content grid, sticky header,
// annotation slots) with a core stylesheet that only its web component adopts.
// caret renders the File/FileDiff classes directly in container-managed mode, so
// it owns the shadow root and adopts that stylesheet here — without it the
// content column collapses to zero width and only the line-number gutter shows.

import fileIconRaw from "@/icons/file.svg?raw";
import folderIconRaw from "@/icons/folder.svg?raw";
import squareIconRaw from "@/icons/square.svg?raw";
import squareCheckIconRaw from "@/icons/square-check-big.svg?raw";
import squareSlashIconRaw from "@/icons/square-slash.svg?raw";
import { DIFFS_CORE_STYLES } from "$lib/diffview/diffsCoreStyles.ts";

// The vendored Lucide `file` glyph as a CSS mask source (EXC-687). Rendered as a
// mask rather than an <img> so it takes the ink color of the surrounding text via
// background-color, matching how Icon.svelte colors an SVG through currentColor.
const FILE_ICON_MASK = `url("data:image/svg+xml,${encodeURIComponent(fileIconRaw)}")`;
// Its counterpart for a reference the daemon resolved to a directory (EXC-918).
const FOLDER_ICON_MASK = `url("data:image/svg+xml,${encodeURIComponent(folderIconRaw)}")`;
// The task-list checkbox's three states, one vendored Lucide glyph each. Masks for the
// same reason the file glyph is one: the row's ink is a palette token, and a mask takes
// it through background-color where an <img> would be stuck with whatever the file draws.
const CHECKBOX_MASKS = {
  unchecked: `url("data:image/svg+xml,${encodeURIComponent(squareIconRaw)}")`,
  checked: `url("data:image/svg+xml,${encodeURIComponent(squareCheckIconRaw)}")`,
  slashed: `url("data:image/svg+xml,${encodeURIComponent(squareSlashIconRaw)}")`,
};

/**
 * How far a blockquote's ink fades (EXC-863). Quoted prose is still body copy a
 * reviewer has to read, so this is bounded by contrast rather than by taste: it is
 * the deepest fade that keeps `--ink` over `--paper-sunk` at WCAG AA on EVERY
 * palette, and the palettes differ enormously in how much room they have to give
 * (`--ink` on sunk runs from 6.0:1 to 18.9:1), so the tightest one sets it for all
 * nine. Exported because a bare number in the sheet is invisible to the palette
 * suite — `theme.test.ts` composites against this and fails if a new palette, or a
 * deeper fade, drops quoted text below the floor.
 *
 * The result is a QUIET fade by necessity: measured against unquoted prose it is a
 * ~1.3:1 step, where a fade deep enough to read at a glance (~2.2–3.4:1) puts three
 * of the nine palettes under AA. The bars are what make a quote unmistakable; this
 * is the second, softer signal. Going deeper means deciding that quoted plan text
 * may sit at the tertiary tier `--ink-faint` occupies (>3:1, where the gutter's line
 * numbers live) rather than with body copy — a call for a human, not a tuning knob.
 */
export const QUOTE_SUBDUE = 0.88;

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
  /* Three more of the same kind, one level down (EXC-865).

     --caret-card-inset is how far the content column's own indented surfaces sit in
     from it — the fenced-code row and the code card both spend it — and
     the band extension that reaches across it must be the same number or the band
     stops short. --caret-read-max is the reading cap those same three share; a comment
     anchored inside a card is capped by it too, so the composer cannot outgrow the card
     that scrolls it. EXC-870's inline image spends both as well — its own comments
     already said it borrowed them, and a test pinned the two indents as a pair by
     comparing literals; the token is what that pairing wanted to be.

     --caret-gutter-divider is NOT caret's: it restates the library's own
     border-right on a gutter cell (2px, its --diffs-gap-style default, which caret
     never overrides). The band extension is positioned from the cell's PADDING box, so
     without adding the border back it lands 2px short of the card and leaves a
     surface-coloured hairline in the seam it exists to fill. */
  :host {
    --caret-card-inset: 0.75rem;
    --caret-read-max: 720px;
    --caret-gutter-divider: 2px;
  }
  /* The chip family's breathing room, stated once for every member that has any: the
     inline-markup pills (EXC-867/868/859) and the file reference (EXC-687/880). Two
     numbers rather than one because the axes are bounded differently — the inline half
     is real space that pushes the next glyph along, so it is what keeps two abutting
     chips from sharing a cell, while the block half only paints (padding on an inline
     box never grows its line box) and is held under the line box's own slack so a dense
     paragraph does not read as confetti. Both are em-relative, so they track the type
     scale rather than a fixed pixel that would crowd at one size and gape at another. */
  :host {
    --chip-pad-inline: 0.32em;
    --chip-pad-block: 0.16em;
  }
  /* The task-list checkbox's size (EXC-860) — the box the masked Lucide glyph is painted
     into, which every state measures from. Lucide draws its square inset in the viewBox
     (18 of 24 units), so the SQUARE a reader sees is about three quarters of this: the
     number is the one that puts that square a little under 1em, inside the row's line box
     rather than filling it. Em-relative so it tracks the type scale — the three source
     columns it is drawn over are a fixed 3ch, so a fixed pixel would drift out of the
     middle of them at any other size. */
  :host {
    --checkbox-size: 1.23em;
  }
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
     :is() groups below, which list data-caret-cursor alongside hover/selection.

     Descendant rather than child, here and in the three gutter rules that follow it
     (the selection tick and its ::after, and the divider clearing below). A carded
     block's gutter cells sit inside a display:contents card — codeBlockScroll.ts's for
     an overflowing fence — so a child combinator stops
     matching them and the row reads half-banded: the content half paints from its own
     descendant selector while the gutter half, and the 3px caret bar with it, silently
     drops out. The card has no box, so widening changes nothing else. */
  [data-gutter] [data-column-number][data-caret-cursor]:not([data-selected-line]) {
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
  [data-gutter] [data-column-number][data-selected-line]:not([data-hovered]) {
    position: relative;
  }
  [data-gutter] [data-column-number][data-selected-line]:not([data-hovered])::after {
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
    margin-inline-start: var(--caret-card-inset);
    margin-inline-end: var(--caret-card-inset);
    max-width: var(--caret-read-max);
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

  /* The fence markers take NO chip. EXC-869 gave them the family's round-rect and it was
     the one member that never read as one: a chip is a tint around a span of CONTENT, and a
     fence row has no content — the markers are the whole line, so the tint drew a small
     empty pill floating in the code panel rather than marking anything within it. They keep
     the --ink-faint ink caret-theme.ts gives them, which is the ink the family prescribes
     for markers, and the panel around them is what already says where the block begins and
     ends. The EXC-692 glyph-centering nudges above stay: those are about where the marker
     sits in its line box, which is a separate question from whether it is tinted. */

  /* EXC-867: the inline emphasis chips, the first prose members of the chip family
     (EXC-855). inlineDecorate.ts splits each row's tokens so none straddles an element
     boundary and tags them data-md; these rules are the whole visual treatment, and the
     REAL weight and slant come from shiki (caret-theme.ts) rather than from here — which
     matters, because EXC-858 measured bold's and italic's tints within a 1.05 contrast
     ratio in five of the nine palettes. The tint says "this span is a chip"; the glyph
     says which one it is.

     Background LAYERS rather than one background-color, because a run can carry two members
     at once and both must show. Triple-starred text is genuinely bold and italic, and the
     middle run of a bold element wrapping inline code is bold and code — with a single
     background-color the more specific rule would win and punch a visible gap through the
     middle of the bold pill. Each layer resolves to transparent through the var() fallback
     when its member is absent, so no default declaration is needed and nothing has to
     out-specify anything. The four layers are ordered as inlineDecorate.ts orders MEMBERS,
     so the sheet and the pass read against each other; with the code chip (EXC-868) and the
     link chip (EXC-859) the family is complete and no member is outstanding.

     EXC-868 is the code member, and it needed nothing beyond one line here and one layer
     above: the pass already tags a codespan and already closes its pill once per element,
     so the backticks stay visible and subdued (caret-theme.ts colours them apart from the
     code between them) inside one chip. Its tint is --chip-code, the token the fence chip
     above already spends — see that rule's note for why one shared token is right even
     though the two surfaces do not composite to one colour. A backticked citation is the
     one place that tint is not what the layer resolves to: the reference rebinds it for the
     whole group at the bottom of this sheet, so the pill reads as one reference chip rather
     than a green middle with code-coloured caps.

     No backtick appears in this comment, or anywhere else in CARET_OVERRIDES: the sheet is
     a template literal, so one would close it early.

     PADDING, on all four sides, and REAL padding — nothing cancels it. EXC-867 and EXC-868
     shipped these chips with none, on the reasoning that inline padding shifts every glyph
     after it (rows render white-space: pre) and the monospace grid stops matching the source
     columns. The shift is real and is now the intended behaviour: an unpadded tint sits so
     tight to its glyphs that it reads as a highlighter smear rather than as a chip, and the
     breathing room has to come from somewhere. What the grid claim overstated is the cost.
     Nothing that resolves a column resolves it in PIXELS: the comment anchors, vim motions
     and the drag-range gestures are all line- and character-indexed, and the search marks
     are painted through the CSS Custom Highlight API over real DOM ranges, so every one of
     them follows the layout wherever the padding puts it. What actually changes is that a
     chip's glyphs no longer sit on the same pixel column as the same glyphs one row up,
     which is a look rather than a broken affordance — and it is the look the padding buys.

     The negative margin [data-file-ref] used to cancel its own padding with is gone for the
     same reason (below): a cancelled pair spends the fill UNDER the neighbouring character,
     so two chips either side of one glyph — the citation shape, a slash between two paths —
     double-coat that glyph's cell in translucent wash. Real padding pushes the neighbour out
     of the way instead, which is what makes abutting chips read as two separate pills.

     Block padding is bounded by the failure mode EXC-855 names: a chip taller than its line
     box reads as confetti in a dense paragraph. It is smaller than the inline half for that
     reason, and both are stated once, here, as the two --chip-pad-* customs the file-ref
     chip below reads too — so the family cannot drift apart one rule at a time.

     Rounded ends ride the GROUP, not the run: an element fragmented into several runs
     gets its radius on the first and last only, so the pill closes once. The pass also
     withholds the cap from a member nested inside another, and that asymmetry is forced by
     this property rather than chosen: border-radius is one geometric property of the box
     and clips every background layer on it, so it cannot be drawn per layer. Were an inner
     member to cap on its own, it would round the enclosing pill's tint too and punch a
     notch through its middle. The outermost pill wins on this box; the inner one gets its
     corners from a box of its own, the pseudo-element below. That is why the start/end
     attributes exist rather than a blanket border-radius, and it is the same
     shape data-code-start / data-code-end already draw for fenced blocks. Logical
     longhands so the ends follow the writing direction. The selection guard that drops
     these chips on a drag-selected row — exactly as the fence chip above does — sits on
     the per-member tint variables below rather than on the shared fill, so the link chip
     can keep the opposite policy; see the note there. */
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
  /* EXC-859: a link's own ink, declared here for the same reason the weight and slant are
     — it is what the text IS. A link is a control the reader can act on, so it marks
     itself the way body text does: the glyphs take the color, the underline sits under
     them, and the chip below is what the collapse adds on top. All three reach the label
     through one attribute selector because the decoration pass gives the label an element
     of its own, so nothing here needs the exact-column painting of the CSS Custom
     Highlight API the search marks below use. The tint is a minority mix of the
     accent into --ink rather than the accent itself: amber stays scarce and
     brand-reserved (the amber-selection-only strategy in styles/diffview.css), and prose
     littered with full-strength accent would spend it everywhere. Both operands carry
     light/dark variants, so the mix resolves warm-on-dark and warm-on-paper without a
     second rule. The underline is offset clear of the descenders — present at a glance,
     quiet enough to read a paragraph through. CARET_OVERRIDES is unlayered while the
     library's own [data-line] span color rule sits in @layer base, so this wins on layer
     order rather than on specificity. */
  [data-content] [data-line] [data-md~="link"] {
    color: color-mix(in lab, var(--ink), var(--accent) 45%);
    text-decoration: underline dotted;
    text-underline-offset: 0.22em;
  }

  /* The guard rides each member's own tint VARIABLE rather than the shared fill rule
     below, because the members disagree about it. Bold, italic and code are decoration, so
     they drop on a row the reviewer has drag-selected and the band reads as one flat shape.
     Code sides with them rather than with the link because it marks a span instead of
     offering an action, which is the same call the fence chip above already makes with the
     same token (EXC-868); the file reference inside a codespan keeps its own fill either
     way, so a selected citation still shows where it can be opened.
     The link chip does not, and the reason is consistency across the family rather than
     necessity: EXC-880 keeps the file-reference chip lit under a selection because an
     affordance's chip is not decoration to be tidied away, and a link chip vanishing
     beside a reference chip on the SAME selected row reads as a glitch rather than as a
     policy. (Not because the tint is the only mark a link has — the ink and dotted
     underline above are ungated too, for the separate reason that they are what the text
     IS, the same footing bold's weight sits on.) background-image is ONE property, so a
     second unguarded rule would replace the whole stack rather than add a layer to it; an
     unset variable falling back to transparent is what lets one stack carry two
     policies. */
  [data-content] [data-line]:not([data-selected-line]) [data-md~="bold"] {
    --md-bold: var(--chip-bold);
  }
  [data-content] [data-line]:not([data-selected-line]) [data-md~="italic"] {
    --md-italic: var(--chip-italic);
  }
  [data-content] [data-line]:not([data-selected-line]) [data-md~="code"] {
    --md-code: var(--chip-code);
  }
  [data-content] [data-line] [data-md~="link"] {
    --md-link: var(--chip-link);
  }
  [data-content] [data-line] [data-md] {
    background-image:
      linear-gradient(var(--md-bold, transparent), var(--md-bold, transparent)),
      linear-gradient(var(--md-italic, transparent), var(--md-italic, transparent)),
      linear-gradient(var(--md-code, transparent), var(--md-code, transparent)),
      linear-gradient(var(--md-link, transparent), var(--md-link, transparent));
    padding-block: var(--chip-pad-block);
  }
  /* No selection guard, matching the link tint above: the link chip has to keep its
     round-rect inside a drag-selection. Ungated costs the other members nothing — a bold
     or italic token on a selected row has no tint at all (the rule above withholds it) and
     the amber band is painted on the ROW rather than the token, so there is no background
     for a radius to clip.

     The INLINE padding rides these same two attributes rather than [data-md] above, and
     that pairing is load-bearing rather than tidy. A pill fragmented into several runs is
     several elements — a bold element wrapping a codespan is three — and inline padding on
     each of them would open a gap around every interior fragment, spacing the pill's own
     glyphs apart from the inside. data-md-start / data-md-end are precisely the outer ends of the pill (the
     pass withholds them from a member nested inside another, for the radius's sake), so
     hanging the padding there gives the pill breathing room at its two edges and none in
     its middle. The block half above needs no such care: it is on the cross axis, where
     every fragment shares one line box and the padding only paints.

     No backtick appears in this comment; see the note above. */
  [data-content] [data-line] [data-md-start] {
    border-start-start-radius: var(--radius);
    border-end-start-radius: var(--radius);
    padding-inline-start: var(--chip-pad-inline);
  }
  [data-content] [data-line] [data-md-end] {
    border-start-end-radius: var(--radius);
    border-end-end-radius: var(--radius);
    padding-inline-end: var(--chip-pad-inline);
  }

  /* The NESTED member's own corners, and the whole reason this block exists. The rule
     above rounds the outermost pill and the pass withholds the cap from a member nested
     inside another — so a nested tint drew a square-ended rectangle inside a rounded pill,
     which is the one shape in this family that reads as an accident. The cap cannot simply
     be handed back: border-radius is one geometric property of the box and clips every
     background layer on it, so rounding there would cut the enclosing pill's tint too and
     punch a notch through its middle (the data-md-start note above).

     A second RADIUS needs a second BOX, so the inner tint moves to a pseudo-element. It is
     sized with inset: 0, which resolves against the token's PADDING box — the chip's own
     rect, block padding included — so the inner pill matches the outer one's height by
     construction rather than by a second measurement. data-md-inner-start / -end are the
     inner group's ends, exactly as the pair above are the outer's, so an inner member
     fragmented across several tokens still closes once — and they carry the same
     --chip-pad-inline the outer pill's ends do, on the ELEMENT rather than on the pseudo.
     A chip tight to its glyphs reads as a highlighter smear whether or not it sits inside
     another chip, and putting the room on the token is what makes it real space that
     pushes the enclosing pill's own glyphs aside; padding the pseudo instead would only
     paint wider and overhang them. The pseudo follows for free, since inset: 0 resolves
     against the padding box it just grew.

     The z-index pair is load-bearing in both halves. -1 puts the pseudo under the token's
     glyphs — a positioned descendant paints ABOVE inline content by default, which would
     wash the very text it is meant to sit behind. z-index: 0 on the token then makes the
     token a stacking context so that -1 stays INSIDE it; without it the pseudo would sink
     past the row and disappear under the hover and selection bands, which are backgrounds
     on the row.

     The tint variables mirror the token's own one level down: --md-<member> is reset to
     initial so the layer on the element paints nothing (a custom property set to initial
     is guaranteed-invalid, so var() falls back to transparent), and --nest-<member>
     carries it here instead. Each member's rule names both halves, so a nested member can
     never be painted twice — once on the element and once on the pseudo would double its
     alpha and read as a third tint. The selection policy is carried per member exactly as
     above and for the same reasons: bold, italic and code are decoration and drop on a
     drag-selected row, the link chip is an affordance and keeps its tint.

     ::after rather than ::before, and that is not a coin toss: a citation inside a bold
     element is a file reference that is ALSO a nested code member, and the reference draws
     its glyph on ::before at the bottom of this sheet. Both rules would land on one
     pseudo-element and merge — the icon absolutely positioned at inset 0 behind the text
     it should sit left of, wearing the chip's gradient through its own mask. The two
     decorations need two slots, and the checkbox is the only other ::after here (a
     line-start marker, which can never carry an inner member). */
  [data-content] [data-line]:not([data-selected-line]) [data-md~="bold"][data-md-inner~="bold"] {
    --md-bold: initial;
    --nest-bold: var(--chip-bold);
  }
  [data-content]
    [data-line]:not([data-selected-line])
    [data-md~="italic"][data-md-inner~="italic"] {
    --md-italic: initial;
    --nest-italic: var(--chip-italic);
  }
  [data-content] [data-line]:not([data-selected-line]) [data-md~="code"][data-md-inner~="code"] {
    --md-code: initial;
    --nest-code: var(--chip-code);
  }
  [data-content] [data-line] [data-md~="link"][data-md-inner~="link"] {
    --md-link: initial;
    --nest-link: var(--chip-link);
  }
  [data-content] [data-line] [data-md-inner] {
    position: relative;
    z-index: 0;
  }
  [data-content] [data-line] [data-md-inner]::after {
    content: "";
    position: absolute;
    inset: 0;
    z-index: -1;
    background-image:
      linear-gradient(var(--nest-bold, transparent), var(--nest-bold, transparent)),
      linear-gradient(var(--nest-italic, transparent), var(--nest-italic, transparent)),
      linear-gradient(var(--nest-code, transparent), var(--nest-code, transparent)),
      linear-gradient(var(--nest-link, transparent), var(--nest-link, transparent));
  }
  [data-content] [data-line] [data-md-inner-start] {
    padding-inline-start: var(--chip-pad-inline);
  }
  [data-content] [data-line] [data-md-inner-end] {
    padding-inline-end: var(--chip-pad-inline);
  }
  [data-content] [data-line] [data-md-inner-start]::after {
    border-start-start-radius: var(--radius);
    border-end-start-radius: var(--radius);
  }
  [data-content] [data-line] [data-md-inner-end]::after {
    border-start-end-radius: var(--radius);
    border-end-end-radius: var(--radius);
  }

  /* EXC-861: the list markers. This is the epic's transform-in-place stance (EXC-855) at
     its most literal — the marker characters are never removed, and the bullet is drawn
     ON TOP of the one they occupy. inlineSpans.ts emits a run over the marker characters
     alone and never over the indentation before them, so what reaches the sheet is a child
     exactly one character cell wide for a bullet, sitting at the column the source puts it
     at. Every column downstream — the comment anchors, vim motions, drag-range selection,
     the search highlights — therefore never learns that anything was drawn.

     A marker is INK rather than a chip. No --chip-* token is added here, and the sheet grows
     no new background layer — a pill around a single dash would read as confetti, which is
     the failure mode EXC-855 names.

     WHICH ink depends on whether the character survives, and the two halves of this rule
     land on opposite sides of that line (EXC-871 settled it epic-wide; svelte-rules.md
     § chips carries the rule). An ordered item's 1. keeps its glyph and is merely tinted,
     so it is SUPPLEMENTARY and takes --ink-faint, the ink the fence markers and the ** / _
     emphasis markers already take. A bullet's dash goes transparent and the drawn dot
     REPLACES it, so the dot is the only thing left saying "list item here" — that is 1.4.11's
     test for a graphical object required to understand the content, and --ink-faint fails its
     3:1 floor on the surface this actually renders on (2.90 on catppuccin-latte, 2.97 on
     github-light, against --paper-sunk and the row's 2-8% ink bands). --ink-soft bottoms at
     4.21 across the nine and theme.test.ts pins the whole replacement family there.

     THE GLYPH IS A PSEUDO-ELEMENT, not an appended node, and that is a correctness
     requirement rather than a preference. A pass that APPENDS a node to a row is one a
     repaint-settling check can disagree with, and the loop that follows is expensive —
     EXC-870 measured ~10,800 childList mutations in two seconds with an image. Generated
     content is invisible to any such count, so the only DOM this decoration causes is the
     token split inlineDecorate.ts was already performing.

     Two independent declarations carry the placement, and they are worth reading apart.
     position: absolute is what keeps the advance at zero — an out-of-flow box contributes
     nothing to the line, insets or no insets. The ABSENCE of insets is what keeps the box
     over the marker: with every inset auto it lands at its static position rather than
     against the nearest positioned ancestor. The zero advance matters more here than
     anywhere else in this sheet, because the alternative spellings all cost width: rows
     render white-space: pre, so a pseudo-element in flow would shift every glyph after it,
     which is precisely the no-inline-padding rule the emphasis chips above obey.

     The glyph shares the row's baseline because it inherits the token's font and
     line-height and so builds an identical line box — not because absolute positioning put
     it there. Giving this pseudo-element a font-size or line-height of its own is therefore
     the one edit that would silently break the alignment.

     user-select: none is the copy contract, and it is load-bearing rather than tidy. Blink
     emits generated content into the plain-text flavour of a copied selection the same way
     EXC-870 found it emitting an image's alt — invisible to Selection.toString(), which
     takes a different path, and visible only in the real clipboard. A bullet leaking into a
     copied plan would corrupt the markdown the epic exists to keep honest, so lists.e2e.ts
     reads navigator.clipboard rather than the selection. Should a future engine emit it
     anyway, the fallback is a radial-gradient dot painted as a background, which cannot
     reach a selection because it is paint rather than content.

     A TASK item's marker takes neither the ink nor the glyph, and it is the ONE member of
     this family that does not keep its columns either. That the marker is a task at all is
     decided in the emission (inlineSpans.ts tags it "task", never "bullet") rather than
     unpicked here, and so is the run's width: it covers the marker AND the gap to the
     checkbox, which is exactly what this rule takes away.

     font-size: 0 is what takes it. The run keeps its characters — they are still in the DOM
     and still in the clipboard, which tasks.e2e.ts reads — but it costs no advance, so the
     checkbox and the item's text slide left onto the columns the marker was spending and the
     box lands where the item begins. Every other decoration on this surface is drawn in
     place precisely so no column moves; this one moves them on purpose, because a box
     floating two cells into a row nothing else indents reads as a stray indent rather than
     as a control. Indentation is NOT part of the run, so a nested item keeps its nesting.
     The collapse is spelled as a font-size rather than as display: none or visibility:
     hidden because those two are the spellings Blink drops from a copied selection, which
     would cost the row its markdown.

     No transition — the diff surface swaps state instantly (svelte-rules § Motion). */
  [data-content] [data-line] [data-md-list] {
    color: var(--ink-faint);
  }
  [data-content] [data-line] [data-md-list="bullet"] {
    color: transparent;
  }
  [data-content] [data-line] [data-md-list="task"] {
    font-size: 0;
  }
  [data-content] [data-line] [data-md-list="bullet"]::before {
    content: "•";
    position: absolute;
    color: var(--ink-soft);
    user-select: none;
  }

  /* EXC-860: the task-list checkbox, drawn over the [ ] / [x] / [/] run
     inlineSpans.ts tags. Structurally this IS the list marker above — the same overdraw,
     the same zero advance — scaled from the one cell a bullet covers to the three the
     brackets cover. Everything the bullet's comment says about why the glyph is a
     pseudo-element rather than an appended node, why absolute positioning with no insets
     holds the advance at zero, and why user-select: none is the copy contract rather than
     tidiness applies here unchanged and is not repeated.

     THREE things are genuinely new, and all three are worth reading.

     ONE BOX PER RUN. A bullet is a single character, so its run can never be cut in two; a
     three-character run can, and shiki really does cut it — an uppercase bracket run comes
     back as three tokens, as does a lowercase one on a row carrying other inline markup.
     inlineDecorate's tagRow tags EVERY token a run covers, so without the suppression rule
     below the sheet draws three boxes side by side rather than one. The rule leaves the
     glyph on the run's FIRST tagged token, which is the token the run starts at and
     therefore the one the centring offset is measured from. Two properties make it hold:
     it wins on selector weight rather than on source order — four attribute selectors
     against the state rules' three — so reordering this block cannot undo it; and it is
     spelled with the GENERAL sibling combinator, not the adjacent one, because tagRow skips
     a zero-length token without tagging it, which would leave an untagged element between
     two tagged ones and break an adjacent-only chain. A second run on one row cannot occur
     to be wrongly suppressed: a task marker is line-start-only. The data-md members solve
     the same problem with pillGroups and the data-md-start / data-md-end caps; a
     pseudo-element needs only this.

     The CENTRING. A bullet needs no offset because it overdraws the single cell it was
     already sitting on; a box drawn over a three-cell run has to be placed in it. The
     inline half is arithmetic on the run: 1.5ch is the run's middle, and half the box's own
     width brings its left edge back to centre it there. 1ch is the width of the zero glyph,
     which on this monospace surface is the cell width — the same unit the grid is built
     from, so the centring cannot drift from the columns. It is spelled as a transform-free
     inset on the marker span (position: relative) rather than resolved against whatever
     ancestor happens to be positioned. The block half is a nudge rather than a calculation
     — the static position is the top of the font's content box, which sits a little above
     the row's optical middle — and it is small enough that no metric it could be derived
     from would be more honest than the number.

     IT IS AN ICON, NOT A GLYPH. A checkbox spelled with U+2610 / U+2611 takes its weight,
     its corner radius, its tick and its size from whichever font the platform resolves, it
     renders at the text's own stroke weight beside prose set in the same face, and it reads
     as ASCII art of a checkbox rather than as a control. What draws it instead is the same
     vendored Lucide set the rest of the product wears (doc/agents/icon-rules.md), masked
     into ::before exactly the way the file-reference glyph below is: square unchecked,
     square-check-big checked, square-slash for the in-progress [/]. One property
     separates the three — the mask image — because the box, the ink, the size and the
     placement are the shared rule's, so a state cannot drift in anything but its shape.
     A mask rather than an <img> or a background-image is what lets the ink stay a palette
     token: the glyph is painted by background-color through the mask, so it inherits the
     row's ramp the way Icon.svelte's SVGs inherit currentColor.

     The INK AND THE STATE. This is the one member of the marker family that WCAG 1.4.11
     binds, because it reports STATE rather than merely marking structure, and that is why
     it spends --ink-soft where every other marker here spends --ink-faint. The faint ink is
     pinned above 3:1 only on --paper and --paper-raised (theme.test.ts); the diff surface is
     --paper-sunk and its 2-8% ink mixes, where --ink-faint measures 2.90 on catppuccin-latte
     and 2.97 on github-light — under the floor 1.4.11 sets for a non-text indicator. One
     step up the ramp clears it everywhere, bottoming at 4.21, and theme.test.ts pins exactly
     that on the surface the checkbox actually renders on. The faint markers around it are
     structure rather than state and are left as they are; that gap is real but it is the
     epic's, not this rule's.

     The three states are then told apart by SHAPE — an empty square, a square with a check,
     a square with a slash — on one ink. Separating them by hue or by an opacity step
     instead would fail outright for a colour-blind reader whatever a contrast ratio said
     about it (the failure mode EXC-863 records one rule family over), so shape is what makes
     the distinction palette-independent and is why this block still needs no subdue
     constant.

     No transition — the diff surface swaps state instantly (svelte-rules § Motion). */
  [data-content] [data-line] [data-md-checkbox] {
    position: relative;
    color: transparent;
  }
  [data-content] [data-line] [data-md-checkbox]::before {
    content: "";
    position: absolute;
    inset-inline-start: calc(1.5ch - var(--checkbox-size) / 2);
    inset-block-start: calc((100% - var(--checkbox-size)) / 2);
    width: var(--checkbox-size);
    height: var(--checkbox-size);
    background-color: var(--ink-soft);
    -webkit-mask: ${CHECKBOX_MASKS.unchecked} no-repeat center / contain;
    mask: ${CHECKBOX_MASKS.unchecked} no-repeat center / contain;
    user-select: none;
  }
  [data-content] [data-line] [data-md-checkbox="checked"]::before {
    -webkit-mask-image: ${CHECKBOX_MASKS.checked};
    mask-image: ${CHECKBOX_MASKS.checked};
  }
  [data-content] [data-line] [data-md-checkbox="slashed"]::before {
    -webkit-mask-image: ${CHECKBOX_MASKS.slashed};
    mask-image: ${CHECKBOX_MASKS.slashed};
  }
  [data-content] [data-line] [data-md-checkbox] ~ [data-md-checkbox]::before {
    content: none;
  }

  /* EXC-870: a markdown image, drawn onto the row its image markup sits on
     (inlineImages.ts). This is the epic's transform-in-place stance applied to the one
     construct that has something to render: the markup is NOT replaced — it keeps its link
     chip and stays copyable — and the picture is added below it inside the same row.

     display: block is what makes that work, and it is the whole reason this element needs
     no geometry negotiation with its neighbours. Every other decoration in this sheet is an
     inline box sharing a line with shiki's tokens, which is where EXC-868 found a chip's
     padding/margin overhang double-coating the wash beside it. A block-level replaced
     element leaves the inline flow entirely: the row's text keeps its own line, the image
     takes the next one, and the rows render white-space: pre either way. So the inline
     margin here can be positive without shifting a single glyph, and it spends the same
     0.75rem the fenced panel above spends — the same indent for the same reason, a block
     the plan embedded rather than prose it wrote. Same VALUE, not the same pixel rail:
     the panel's margin moves the whole row box, while this one sits inside that box's own
     1ch text padding, so the image's edge lands about a character to the panel's right.
     Aligning them exactly would mean subtracting the library's padding here, and coupling
     a caret rule to a library metric is the fragility the utility-button note above
     already warns about.

     The size caps are the design decision. max-width borrows the panel's own --caret-read-max
     reading measure rather than inventing a number, and min() keeps a narrow viewport in charge;
     max-height caps the image at roughly fourteen of the library's 20px line boxes, which
     is enough for a diagram to be read and not enough for one asset to own the plan. Width
     and height stay auto so the aspect ratio survives whichever cap bites first, which is
     also why no object-fit is needed — with one axis free there is nothing to letterbox.

     The hairline border is legibility rather than decoration: plan images are overwhelmingly
     screenshots and diagrams on a white ground, which dissolves into --paper with no edge in
     the light scheme. The ink mix is the same color-mix idiom the panel fill and the scroll
     thumb use, so it carries correct contrast in both schemes from one declaration. The
     radius is the chip family's, so the figure reads as part of the same vocabulary. No
     transition — the diff surface swaps state instantly (svelte-rules § Motion).

     user-select: none is the one declaration here that is not about looks, and it is
     load-bearing: without it the epic's copy contract breaks. Blink emits an image's alt
     text into the plain-text flavour of a copied selection, so selecting the image's row
     and copying yielded the source markdown with the accessible name stapled to its end —
     while Selection.toString(), which takes a different path, showed nothing wrong. The
     row's text is what the reader is copying; the picture is a rendering of markup that
     row already spells out, so excluding it from the selection is what the element IS
     rather than a workaround. Doing it here also keeps the alt attribute, which stays the
     accessible name; moving the name to aria-label with an empty alt cleans the clipboard
     the same way but leans on the presentational-role conflict rule to do it.
     images.e2e.ts reads the real clipboard, which is the only place this is visible.

     The [hidden] rule is not boilerplate. A failed load hides the element rather than
     removing it, so the observer pass stays idempotent (inlineImages.ts), and the UA
     stylesheet's own [hidden] { display: none } is overridden by the display: block
     above — without this line a broken image would still occupy the row. */
  [data-content] [data-line] [data-md-image] {
    display: block;
    user-select: none;
    max-width: min(100%, var(--caret-read-max));
    max-height: 18rem;
    width: auto;
    height: auto;
    margin-block: 0.35rem;
    margin-inline-start: var(--caret-card-inset);
    border: 1px solid color-mix(in lab, var(--paper-sunk), var(--ink) 14%);
    border-radius: var(--radius);
  }
  [data-content] [data-line] [data-md-image][hidden] {
    display: none;
  }

  /* EXC-863: blockquote level bars. This is EXC-855's OTHER category — transform-in-place
     rather than keep-and-chip — so nothing here is a chip and nothing here spends a
     --chip-* token; the chip family stays five members and closed.

     The bar overdraws the marker instead of sitting beside it. The marker glyph is still
     in the text — copy, drag-selection, vim motions, search columns and the comment
     anchors all read the real source, which is the whole point of keeping the characters —
     so the glyph goes transparent and the bar is drawn in the column it vacated. Deleting
     the character would have been the other way to get one bar per level, and it would
     have broken every one of those in the same stroke.

     The rule tokens were tried first, on the reading that a bar is a rule; measured on the
     showcase in both schemes --rule-strong is legible but not COUNTABLE, and counting is the
     entire job here. They are sized for hairlines that span a whole edge, where length
     carries the signal — this mark is 2px wide and one row tall, so it has no length to
     spend and needs its ink instead.

     What it takes is --ink-soft, and for the reason the marker being GONE supplies rather
     than for a reason about how a bar looks. EXC-863 shipped it on --ink-faint, the marker
     ink EXC-855 prescribes; EXC-871 swept the epic's markers together and split them on
     whether the source character survives (svelte-rules.md § chips carries the rule). This
     one does not — the glyph is transparent two declarations up, so the bars are the only
     thing carrying "this is quoted, and this deep", which is exactly WCAG 1.4.11's test for
     a graphical object required to understand the content. --ink-faint measures 2.90 on
     catppuccin-latte and 2.97 on github-light against --paper-sunk and the row's 2-8% ink
     bands, under the 3:1 floor; --ink-soft bottoms at 4.21 across the nine. theme.test.ts
     pins the whole replacement family — this bar, the list bullet, the task checkbox, a
     table's column and header rules — on that surface, and it reds naming the palette if any of them is stepped back down.

     Depth reads off the BAR COUNT, and that comes free: the decoration pass gives every
     marker its own child at its own source column (data-md-quote carries the level), so a
     two-level quote draws two bars 2ch apart with no nesting logic here and no per-level
     rule — the source's own indentation is the spacing. Nothing participates in flow — the
     bar is absolutely positioned and sized in ch — so the monospace grid is untouched by
     construction rather than by cancellation. That matters more here than for the emphasis
     chips: a leading decoration is exactly the shape that shifts every glyph on the line,
     and the gutter's line numbers would drift with it.

     ONE CONTINUOUS BAR down the quote, not one mark per row, and that is what the block
     inset spells. A bar is drawn per row because a marker is per row, so the rows have to
     close up exactly or the seams read as a dotted line — which is what EXC-863's fixed
     -0.1em bleed left: it covered most of the gap and stopped 1.75px short of it, once per
     row, all the way down. The gap cannot be closed by a bigger constant, because its size
     is the difference between two things neither rule owns — the row's line box, and the
     font's own content box, which is what an absolutely positioned pseudo-element resolves
     a percentage against. So the inset MEASURES that difference instead: 1lh is the row's
     line box and 100% is the containing block the bar already sits in, so half their
     difference, negated, is exactly the bleed that makes the bar the height of its row.
     Whatever the font metrics or --diffs-line-height do, it stays exact.

     The extra half-pixel each side is for the radius rather than the arithmetic. The radius
     clamps to a pill at this width, which is what keeps the bar a round-rect rather than a
     hairline — and rounded ends that merely TOUCH pinch visibly at every row seam, so the
     bars overlap by a pixel and the pinch closes. What is left is the intended shape: round
     ends at the top and bottom of the quote, one unbroken line between them.

     No selection guard, and deliberately: the emphasis chips drop their tint on a
     drag-selected row because a tint is decoration, but this bar is what the marker IS —
     the same footing bold's weight sits on a few rules above. A quoted row that lost its
     bars inside a selection would lose its depth, not just its polish. */
  [data-content] [data-line] [data-md-quote] {
    position: relative;
    color: transparent;
  }
  [data-content] [data-line] [data-md-quote]::before {
    content: "";
    position: absolute;
    inset-block: calc((1lh - 100%) / -2 - 0.5px);
    inset-inline-start: 0.375ch;
    width: 0.25ch;
    border-radius: var(--radius);
    background-color: var(--ink-soft);
  }

  /* The subdue, and it rides the row's TOKENS rather than the row. Opacity is the
     mechanism because the alternative is not available: token colour arrives from the
     library's own [data-line] span rule, so an unlayered colour here would win — and win
     too hard, flattening every syntax hue on the line to one value. Fading instead keeps
     each token's own colour and carries the inline chips down with it, which is what the
     issue asks for: a link, a codespan or a bold pill inside a quote keeps its treatment,
     quieter, rather than losing it.

     It cannot ride [data-line] itself. The amber drag-selection band and the hover band
     are background-colors on that element, so a row-level opacity would fade them too and
     a selected quoted row would read differently from a selected unquoted one. The marker
     child is exempt: it carries the bar, and dimming the bar with the ink it replaced
     would cost exactly the legibility the bar exists for.

     The two combinators are chosen separately and neither is free. DESCENDANT at the
     [data-content] end, so a row a scroll card has re-parented still matches. CHILD at
     the row end, and that one is load-bearing: opacity is not idempotent, so a descendant
     selector would apply again to any nested element and compound to 0.88^2. The bar
     survives here only because it hangs off the marker child this excludes.

     How deep the fade goes is not a taste call and is not declared here — see
     QUOTE_SUBDUE above, which is bounded by the worst palette's contrast headroom.
     A gentler fade than the eye would choose is the price of quoted prose staying
     readable in all nine.

     A search highlight inside a quote fades with the line, since ::highlight() paints
     over these same tokens and no selector can lift a highlight out of an ancestor's
     opacity group. That is accepted rather than compensated: the fade is the LINE
     reading quieter, and a mark on a quieter line being quieter with it is the same
     statement, where the selection band above is row chrome about the reviewer's own
     action and has to stay constant. Both marks keep their full alpha relative to the
     ink they sit on either way. */
  [data-content] [data-line][data-quote-depth] > :not([data-md-quote]) {
    opacity: ${QUOTE_SUBDUE};
  }

  /* EXC-862: a thematic break — three dashes, asterisks or underscores alone on a line —
     drawn as a real horizontal rule across the content column. Transform-in-place again,
     and the same trade the level bars above make: the characters stay in the row, so the
     gutter number, the hover comment affordance, the cursor and the comment anchors are all
     untouched and copy carries the real source; the glyphs go transparent and the rule is
     drawn in the space they vacate. Subduing them instead was the other option and it does
     not survive all three spellings — underscores sit at the baseline and asterisks sit
     high, so a centered rule would read as a double line under one spelling and as a
     strikethrough under another, while a transparent row renders the three identically.
     Which is what the row IS: one rule, however it was typed.

     Drawn as a background rather than an appended element or a ::before, and that is the
     load-bearing choice rather than a stylistic one. A pass that appends a node to a row
     can disagree with a repaint-settling check, rebuild the row, and loop the repaint
     observer — EXC-870 measured ~10,800 childList mutations in two seconds on exactly that.
     A background paints no node at all, so the loop is impossible by construction rather
     than by measurement, and unlike a pseudo-element it needs no positioning context, so no
     stacking order moves.

     It takes --ink-soft, and neither token a divider suggests first survived measurement on
     the surface this actually renders on. --rule-strong was the obvious pick — the level
     bars above reject the rule tokens only for a 2px mark, on the grounds that they are
     "sized for hairlines that span a whole edge", and this IS that hairline — but those
     tokens are 10% and 16% ink, and composited over --paper-sunk and the row's own 2-8%
     bands --rule measures 1.15 to 1.37 and --rule-strong 1.24 to 1.64 across the nine
     palettes. That is barely above the 1.05 this epic treats as indistinguishable: the line
     is in the DOM and not on the screen. --ink-faint, the marker ink the chip family
     prescribes, is the other candidate and lands at 2.63 to 4.79 — under WCAG 1.4.11's 3:1
     floor on catppuccin-latte and github-light, the gap EXC-860 measured for the checkbox.

     That floor binds here, which is the part worth being explicit about rather than
     inheriting. The glyphs above are transparent, so this line is the ONLY thing carrying
     "a section break sits here". A decoration beside a legible marker could argue it is
     ornamental; one that has replaced its marker cannot. --ink-soft bottoms at 4.21 across
     the nine and is pinned in theme.test.ts against the banded diff surface, the same shape
     and for the same reason as the checkbox's pin.

     No inset and no margin: the row must keep its height to the character, since the gutter
     numbers are one per row and a rule that changed the vertical rhythm would be visible as
     drift long before it was visible as a divider. background-size is the whole geometry —
     the full width of the box background-origin names, one pixel tall, centered in the row's
     own line box.

     That origin is CONTENT-BOX rather than the padding-box default, and it is not a detail:
     the seam-fill group below pulls a banded row 20px left (a negative inline margin with
     the inset re-added as padding) whenever it is hovered, cursored or selected, which is
     every time the comment affordance is revealed. A percentage of the padding box would
     grow with that pull and the divider would lengthen 20px into the gutter lane and snap
     back. The content box is invariant under the pull — the margin and the padding cancel —
     so the rule spans the character column and stays that length in every row state. The
     rule survives those states deliberately: the band is a background-color and this is a
     background-image over it, the same standing the bars take.

     A vim-search hit landing on a rule row paints ::highlight(caret-search)'s band with no
     glyph inside it, since that highlight sets background-color alone and the text under it
     is transparent. Accepted rather than compensated: the mark still shows the reviewer
     which row matched, which is what a hit on a row of punctuation can usefully say. */
  [data-content] [data-line][data-md-rule] {
    background-image: linear-gradient(var(--ink-soft), var(--ink-soft));
    background-repeat: no-repeat;
    background-origin: content-box;
    background-position: center;
    background-size: 100% 1px;
  }
  /* The row and its tokens both, so a repaint that has not yet wrapped the line in shiki
     spans shows no glyph either — the library's own [data-line] span color rule is what
     makes the second selector necessary once they exist. */
  [data-content] [data-line][data-md-rule],
  [data-content] [data-line][data-md-rule] > * {
    color: transparent;
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
    max-width: var(--caret-read-max);
    margin-inline: var(--caret-card-inset);
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

  /* EXC-864: a GFM table renders as a real column-aligned table. This is the one place
     in the epic that RESTRUCTURES the DOM instead of overdrawing in place, because the
     source's pipe columns do not line up with a table's columns — alignment has to come
     from layout. tables.ts moves a table's rows into a card and groups each row's tokens
     into cells; these rules are the whole visual treatment.

     TWO NESTED SUBGRIDS, and both are load-bearing. The card takes its ROWS from the
     parent, exactly as the code card above does, so a table's rows still map to the
     shared row tracks and the gutter numbers stay aligned — including when a cell wraps
     and grows its track, which is why there is no ResizeObserver and no per-row height
     syncing here. The card declares the COLUMN tracks, and each row takes those from the
     card, so cells line up across rows while every row keeps its own box. That last part
     is why a real table element was refused rather than merely awkward: table rows cannot
     participate in the parent's row tracks, and display: contents rows would drop the box
     the library's selection and hover fills, the cursor band and the annotation anchors
     all need.

     NO max-width and NO overflow, which is the one place this card parts company with the
     code card above. A fenced block is a different MODE of reading and earns a panel with
     a scroll box of its own; a table is prose-adjacent data whose whole value is being
     comparable at a glance, so it grows past the prose measure until every column is
     visible rather than hiding the last ones behind a scrollbar. The per-column cap below
     is what keeps that from running away.

     The sizing policy is max-content tracks plus a max-width on the CELL, and the split
     between the two is what makes the cap per-column rather than per-table. A max-content
     track never shrinks under space pressure, so a track resolves to min(its content, the
     cap): a column of ordinary data keeps its natural width and never wraps, while a
     genuinely prose-heavy cell hits the cap and wraps inside its own column, growing the
     ROW rather than the table. Sizing the TRACKS with minmax(min-content, …) or
     fit-content() cannot express this — both let the grid squeeze every column at once, so
     a wide table reflows and the prose cell never wraps any sooner. justify-content keeps
     a narrow table at its natural width rather than stretching it across the card.

     64ch is the one tuned number, and it means "a cell wider than this is prose". It is
     the measure prose is set to everywhere else for the same reason — a line much longer
     than this is hard to return from, and one much shorter breaks too often to read as a
     sentence — and the seed plan splits cleanly around it: across its eight tables every
     data cell is at most 39ch wide, and everything above is a sentence (the reflow
     exemption table's 94ch link cell, the two wrapping rows under Tables). Nothing sits in
     between. A cell measures its own box, so a cell that opens with a pipe spends two of
     those characters on the pipe and the space after it.

     No fill and no padding. The table sits on the bare diff surface rather than in a
     panel: a fenced block is a different mode of reading and earns its own surface, where
     a table is prose-adjacent data. And a cell needs no padding because the source already
     carries it — a written cell has its own spaces, so the breathing room inside one is
     text the author typed. The chip family's no-padding rule (EXC-867, EXC-869) lands
     here free.

     THE FRAME IS THE ONE MARK HERE WITH NO CHARACTER BEHIND IT. Every other decoration in
     this sheet stands in for something the author typed; markdown has no syntax for a
     table's outer edge, so the border is drawn because a table without one reads as a
     stack of rules that stop in mid-air rather than as a table. It is the third case
     doc/agents/svelte-rules.md § chips leaves open — a decoration that replaces nothing —
     and it takes the same ink and weight as the rules it closes off, because a frame a
     shade off from the dividers it meets reads as a mistake rather than as a choice.

     --table-rule is declared HERE, on the card, and nowhere else. The frame, the column
     dividers and the header rule are one mark in three places; a tuned number written out
     three times is three numbers waiting to drift apart. */
  [data-content] > [data-table-card] {
    grid-column: 1 / -1;
    display: grid;
    grid-template-rows: subgrid;
    grid-template-columns: repeat(var(--table-columns, 1), max-content);
    /* The card shrinks to its tracks rather than stretching across the content column,
       which it has to do now that it draws a frame: a border on a stretched card would
       box the column the table sits in rather than the table. It is still free to grow
       PAST the column when the tracks are wider than it — max-content never shrinks
       under pressure — which is the "grows until every column is visible" behaviour. */
    justify-self: start;
    margin-inline: var(--caret-card-inset);
    --table-rule: light-dark(
      color-mix(in srgb, var(--ink-soft), var(--paper-sunk) 15%),
      color-mix(in srgb, var(--ink-soft), var(--paper-sunk) 30%)
    );
    border: 1px solid var(--table-rule);
    border-radius: var(--radius);
  }
  /* The frame's corners, taken back from the rows. Every row of the surface carries an
     opaque background of its own, so the first and last row of a card paint their square
     corners straight over the arc the border draws around them and the frame reads as a
     rounded rectangle with a bite out of each corner. Rounding the two end rows to the
     same radius clears the arc. The 1px border makes the row's arc a hair wider than the
     border's inner one; the sliver that leaves is the card's own background, which is
     nothing, so what shows through is the surface the row was painting anyway.

     overflow: hidden on the card would do this in one declaration and is refused: it
     would make the card a scroll container, which is the one thing a table's card must
     never be (see the sizing note above, and the test that pins it).

     :first-child / :last-child rather than the rows by name. The last child is an
     annotation row whenever someone comments on the table's final line, and it is then
     the row whose corners meet the frame. */
  [data-content] > [data-table-card] > :first-child {
    border-top-left-radius: var(--radius);
    border-top-right-radius: var(--radius);
  }
  [data-content] > [data-table-card] > :last-child {
    border-bottom-left-radius: var(--radius);
    border-bottom-right-radius: var(--radius);
  }
  /* The library gives every row a 1ch inline padding. On a subgrid that padding insets
     the row's OWN tracks from the card's, so the cells stop filling the columns they
     are supposed to define: the header rule (a percentage of the row) and the column
     rules (a percentage of a cell) then measure two different boxes and neither lines
     up with the frame. Zeroing it makes the row's tracks the card's tracks exactly,
     which is what lets every rule in this block be stated as a plain percentage. */
  [data-content] > [data-table-card] > [data-line] {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: subgrid;
    padding-inline: 0;
  }
  /* pre-wrap rather than the library's pre: wrapping is opt-in INSIDE cells only, and
     stays off everywhere else. The max-width is the wrap trigger described above — it caps
     the cell's max-content contribution, which is what caps the track. text-align rides
     the CELL rather than its tokens so a wrapped cell's continuation lines follow the
     column's declared alignment too; alignment is a property of the column, and a
     token-level rule would only ever reach the first visual line. */
  [data-content] > [data-table-card] [data-table-cell] {
    white-space: pre-wrap;
    max-width: 64ch;
  }
  /* A wrapped cell hangs its continuation lines under its own first line. The text of a
     cell does not start at the cell's edge — the source puts two characters before it,
     the pipe and the space after it — so continuation lines starting at the edge sat two
     characters left of everything above them, and ran through the column rule painted
     half a character in.

     The classic hanging-indent pair: the padding moves every line of the cell right by
     those two characters, and the negative indent pulls the FIRST one back to where it
     was, so the pipe still sits on its own character column and the rule still lands on
     it. It costs the track nothing — a negative text-indent takes the same two characters
     off the first line's max-content contribution that the padding adds — so a cell that
     does not wrap is exactly as wide as it was.

     Keyed on the edge attribute because that IS "this cell opens with a pipe". A table
     written without outer pipes has a first cell whose text starts at the cell edge, and
     it correctly indents nothing. */
  [data-content]
    > [data-table-card]
    [data-table-cell]:is([data-table-edge="start"], [data-table-edge="both"]) {
    padding-inline-start: 2ch;
    text-indent: -2ch;
  }
  /* The source's own alignment padding, and the delimiter row's dashes (tables.ts's
     inertRuns). Zero-size rather than hidden: the characters stay in the layout tree,
     so selectionCopy.ts still reads them back and a search Range still resolves over
     them, but a column is sized to what the reader can see rather than to the widest
     thing anyone typed. Without this a column of one-word cells stays as wide as the
     URL of a link that collapsed to three characters. */
  [data-content] > [data-table-card] [data-table-cell] [data-table-inert] {
    font-size: 0;
  }
  [data-content] > [data-table-card] [data-table-cell][data-table-align="left"] {
    text-align: left;
  }
  [data-content] > [data-table-card] [data-table-cell][data-table-align="center"] {
    text-align: center;
  }
  [data-content] > [data-table-card] [data-table-cell][data-table-align="right"] {
    text-align: right;
  }
  /* A celled row can hold a node this pass did not make — inlineImages.ts appends its
     <img> past the cells. Span it across the tracks so it drops onto its own line
     under the row rather than taking the first column and pushing every cell right.
     Stated as everything that is NOT a cell rather than by naming the image: what the
     rule means is that only cells belong to the column grid, which stays true for
     whatever the next pass appends. */
  [data-content] > [data-table-card] > [data-line] > :not([data-table-cell]) {
    grid-column: 1 / -1;
  }

  /* THE PIPES GO; THE RULES THEY STOOD FOR STAY. Every cell opens with its own pipe and
     a row's last cell closes with one. The glyphs are taken to transparent and a hairline is
     painted down the column each vacated, so the reader sees borders where they had been
     reading a picket fence — which is the whole issue. Nothing is added to the source and
     nothing moves, so copy, vim search and motions, and the comment anchors all still
     resolve against the same column space. The selector outranks the library's own
     [data-line] span color rule, which is where a token's shiki ink is applied.

     Inking the glyph instead cannot work: a pipe does not
     fill its line box, so a column of them reads as a dotted stack rather than a border,
     and the moment a cell wraps the pipes are all on its first visual line with nothing
     down the rest of the row. */
  [data-content] [data-line] [data-table-pipe] {
    color: transparent;
  }

  /* The rules themselves, painted on the CELL rather than on the pipe token — which is
     what makes one continuous down a wrapped row's full height instead of one line of it.
     A background layer rather than a border, because a border joins the box model and
     would shift the monospace grid by a pixel per column; that grid is what the search
     highlights, the drag range and the vim motions all resolve against.

     Positioned at the CENTRE of the pipe's own character cell — 0.5ch in from the cell's
     inline start. The ch unit is the width of the zero glyph, which on this monospace
     surface IS the cell width, so the rule lands where the character it replaces was
     drawn. That is unconditional, where the air around it is not: at the default
     alignment a cell's text clears its own pipe by one space and the next cell's by one,
     so each rule sits in a cell and a half of space either side, but a centred or
     right-aligned column moves its glyphs within the track and the gaps stop matching.
     The rule stays on the character column regardless, which is the property that has
     to hold.

     INTERIOR rules only. A cell's own pipe is what it draws, so the first cell of a row
     would draw the table's left-hand edge and the last its right — and the frame above
     already draws both, half a character further out, which reads as a doubled line
     rather than as one. :first-child drops the leading one and there is no inline-end
     layer at all, so what is left is exactly the dividers BETWEEN columns. A table
     written without a leading pipe is covered by the same rule for a second reason: its
     first cell carries no data-table-edge to begin with.

     The edge is an attribute the pass writes rather than a :has() probe, because this
     selector runs on every cell of every table on every repaint.

     --table-rule, declared once on the card, is --ink-soft softened toward the surface —
     never --rule or --rule-strong. The glyph these replace is transparent, so the rules
     are the only thing left saying where one column ends and the next begins, which is
     WCAG 1.4.11's own test for a graphical object required to understand the content.

     The softening is split by scheme because the two schemes are held by two different
     limits: on a LIGHT palette the floor binds and 15% is the most that clears it, while
     on a DARK one the eye binds long before the floor does — light ink on a dark ground
     reads heavier at the same ratio — so 30% is a design choice with the floor merely
     respected. doc/agents/svelte-rules.md § chips carries both ranges, and carries them
     alone; a measured number restated here is a number that drifts.

     light-dark() rather than a scheme-keyed selector, which the shadow boundary puts out
     of reach anyway: paintTheme writes color-scheme along with the tokens, and it
     inherits through the host, so one declaration covers both. Mixed in sRGB rather than
     the lab the rest of this sheet uses, deliberately: the light margin is a fifth of a
     ratio point, too thin to absorb the difference between the space theme.test.ts
     measures in and the space the browser paints in. */
  [data-content]
    > [data-table-card]
    [data-table-cell]:not(:first-child):is(
      [data-table-edge="start"],
      [data-table-edge="both"]
    ) {
    background-image: linear-gradient(var(--table-rule), var(--table-rule));
    background-repeat: no-repeat;
    background-size: 1px 100%;
    background-position: 0.5ch 0;
  }

  /* The header row is bold, and the weight is declared HERE rather than routed through
     shiki's fontStyle — @pierre/diffs carries that into an invalid font-weight:
     light-dark(...) and drops it, so every token renders at one weight whatever the theme
     says (EXC-867's standing upstream finding). */
  [data-content] [data-line][data-table-head] {
    font-weight: bold;
  }

  /* The delimiter row keeps its line AND its gutter number: one source line is one table
     row, which is correctness rather than look — the comment anchors rest on it. What the
     reader sees in place of a row of dashes and colons is the separator it stands for. The dashes and
     colons go transparent and the row draws one full-width rule, which the dashes
     themselves cannot do because they are only ever as long as someone typed them.

     EXC-862's thematic-break paint shape. A background rather than an appended node or a
     ::before, because paint is invisible to a settle check — tables.ts settles a celled
     row by COUNTING its cells, so a pass that appended a rule here would have every
     repaint rebuild the row and never adopt it, the loop EXC-870 measured at ~10,800
     childList mutations in two seconds. And no inset and no margin, so the row keeps its
     height to the character: the gutter numbers are one per row, and a rule that changed
     the vertical rhythm would read as drift long before it read as a separator.

     A plain 100% spans exactly the frame's inner width, which is the whole reason the
     row's inline padding is zeroed above. The break needs background-origin: content-box
     to survive the seam pull; a carded row is never pulled — the pull is a direct-child
     rule, and EXC-865's gutter-side ::before covers this case instead — so the default
     padding box is already the right one, and naming an origin here would only invite
     the next reader to wonder which box it was correcting for.

     It spends the same --table-rule as the column rules, so the separator and the
     dividers it meets read as one weight. The dashes and colons are transparent, so this
     line is the only thing carrying what they said, which puts it under the same 3:1
     floor as the thematic break above. */
  [data-content] > [data-table-card] > [data-line][data-table-rule] {
    background-image: linear-gradient(var(--table-rule), var(--table-rule));
    background-repeat: no-repeat;
    background-position: center;
    background-size: 100% 1px;
  }
  /* The row and everything under it, so a repaint that has not yet celled the line — or
     not yet wrapped it in shiki spans — shows no glyph either. A descendant selector
     rather than the thematic break's child combinator: a celled row's tokens sit one level
     further down, inside the cells. */
  [data-content] [data-line][data-table-rule],
  [data-content] [data-line][data-table-rule] * {
    color: transparent;
  }
  /* And the row that carries it keeps almost no height, which is where the air under a
     header was coming from. The delimiter is a full text line of the source that draws a
     single hairline, so at the surrounding line height it set half a line of space above
     that hairline and half below — more space under the header than the header's own row
     occupies. At 0.4 the header and the first body row close on the rule from both sides
     and read as one table rather than as two blocks with a line between them.

     line-height rather than a height, so the row tracks the type scale like everything
     else here, and 0.4 is the tuned number: a fifth of a line of air on each side of the
     hairline, which is enough to keep it clear of both rows' descenders and ascenders and
     little enough that the pair reads as adjacent. It is a floor as much as a choice —
     the row still has to hold the dot below.

     Both columns or neither. The row track is the taller of the gutter cell and the
     content row, and the gutter cell still holds its line number — hidden, but in flow,
     because the dot below is positioned on that number's own box — so a declaration that
     reached only the content row would resolve to the number's line box and change
     nothing on screen. */
  [data-content] > [data-table-card] > [data-line][data-table-rule],
  [data-gutter] [data-table-card-gutter] > :nth-child(2 of [data-column-number]) {
    line-height: 0.4;
  }
  /* The gutter half: no number, a dot. A line number is an address a reader takes to a
     comment or a diff, and the delimiter is the one line of a table that says nothing —
     it is punctuation for the parser, and its rendering is the header rule two rules up.
     Numbering it spent a full line of vertical rhythm on an address for nothing, and the
     row above is now far too short to set a digit in anyway. The dot says "a line is
     here" — which stays true, because it is still a line: the comment anchors rest on it
     and the numbering either side of it is unbroken.

     PAINTED, not swapped. The number is the library's own node, so replacing its text
     would mean writing to the DOM on every repaint — the childList churn tables.ts is
     built to avoid — and a ::before is spoken for on these cells by EXC-865's seam strip.
     A background layer is neither. currentColor rather than a token of its own: the dot
     stands exactly where a number stood and is the same mark, so it takes the same ink
     the numbers around it do, hover and selection states included.

     ON THE NUMBER'S OWN BOX, which is the only thing that puts it under the numbers
     rather than merely near them. The library sizes every number to the widest one in
     the file and right-aligns the digits inside that, so the column's centre is the
     centre of the LONGEST line number: in a file that runs past a thousand lines, every
     three-digit number sits half a digit right of it, and a dot centred on the column
     reads visibly off the stack it belongs to. Taking the box back to its own digits
     (min-width) and stretching it to the row (height, from the row's top rather than
     from the text baseline it would otherwise sit on) makes the box exactly the one this
     line's number occupied, so the dot lands on the numbers above and below to the pixel.

     The glyphs are hidden with visibility rather than display, because the box is now
     what positions the dot and display would take it away — and with a ::before to carry
     the paint, since visibility hides an element's background along with its text. That
     pseudo is free here: the one EXC-865 spends is on the CELL, one level up.

     The cell is reached positionally because the gutter carries no per-line marker and
     adding one would cost a query per repaint. It is exact rather than a guess about the
     DOM — "of [data-column-number]" counts only the line cells, skipping the buffer a
     comment inserts, and the second line of a table is its delimiter by GFM's grammar. */
  [data-gutter]
    [data-table-card-gutter]
    > :nth-child(2 of [data-column-number])
    > [data-line-number-content] {
    visibility: hidden;
    position: relative;
    min-width: 0;
    height: 100%;
    vertical-align: top;
  }
  [data-gutter]
    [data-table-card-gutter]
    > :nth-child(2 of [data-column-number])
    > [data-line-number-content]::before {
    content: "";
    visibility: visible;
    position: absolute;
    inset: 0;
    /* closest-side, so the disc is inscribed in the box below rather than reaching its
       corners — a farthest-corner circle is clipped square by its own painting area and
       the "dot" comes out a tiny block. */
    background-image: radial-gradient(circle closest-side, currentColor 100%, transparent 100%);
    background-position: center;
    background-repeat: no-repeat;
    background-size: 0.3em 0.3em;
  }
  /* The hover "+" is a fixed size and its row is not, so it is centred on the row rather
     than hung from the top of it. On every other line the two are the same height and
     this changes nothing; on the delimiter row the button is several times the height of
     the line it is offered for, and flex centring overflows it evenly above and below
     instead of dropping it out of the bottom. Stated for every row rather than for that
     one, because "the affordance is centred on its line" is the rule and the delimiter is
     only the row that made it visible. */
  [data-gutter] [data-gutter-utility-slot] {
    align-items: center;
  }

  /* A comment anchored to a table line. Its row rides inside the table's card so it lands
     under the row it belongs to and pushes the rest of the table down, rather than after
     the whole table — but the card is a grid of max-content columns, so the row needs
     placing in it, and placing it there must not change the table.

     contain: inline-size is what keeps the columns exactly where they were. A spanning
     grid item otherwise contributes its own max-content to every track it covers, and a
     composer's is large enough to stretch a narrow table wider the moment someone comments
     on it. Containment takes the row's width from the grid instead of from its contents,
     so opening a comment moves nothing.

     container-type on the card would express the visible width directly, and is not
     usable: it brings layout containment, which stops the card's subgrid contributing the
     comment's height to the parent's row track, and the whole thread collapses to one
     line. */
  [data-content] > [data-table-card] > [data-line-annotation] {
    grid-column: 1 / -1;
    contain: inline-size;
  }
  /* The width the comment is actually drawn at. It cannot be set on the row above: a grid
     item with a definite width distributes it back across the tracks it spans, which is
     the inflation the containment was for. It belongs on the library's own wrapper, which
     already carries an explicit width (--diffs-column-content-width, the full content
     column). The cap is the reading measure and nothing else — the table's own width is
     the wrong answer at both ends, giving a cramped thread on a narrow table and an
     over-long one on a wide. */
  [data-content] > [data-table-card] > [data-line-annotation] > [data-annotation-content] {
    max-width: var(--caret-read-max);
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
     a code row can't — its panel inset (margin-inline-start, on top of the content
     column's --caret-seam) overrides that pull, so the strip between the banded
     gutter cell and the inset band stays unpainted. A left box-shadow paints exactly
     that strip (width = the two insets, --caret-seam + --caret-card-inset) WITHOUT
     moving the cell or its code text, and without fighting the panel's
     overflow-x: clip / max-width the way a negative margin would. Same band color as
     the fill; the gutter's own divider is already cleared to transparent for banded
     rows (seam-fill group), so gutter band + this strip + content band read as one.
     Fitting-block rows only ([data-content] > …); an overflowing block's card owns
     its own inset. Yields to the amber selection via the shared :not guard. */
  [data-content] > [data-line][data-code-line]:is([data-hovered], [data-caret-cursor]):not([data-selected-line]) {
    box-shadow: calc(-1 * (var(--caret-seam) + var(--caret-card-inset))) 0 0 0
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
    [data-column-number]:is(
      [data-selected-line],
      [data-hovered],
      [data-line-type="change-addition"],
      [data-line-type="change-deletion"],
      [data-caret-cursor]
    ) {
    border-right-color: transparent;
  }

  /* EXC-865: the same seam fill, for a row that lives inside a card of either kind.
     The pull above is a direct-child rule and deliberately stays one — a code card is
     an overflow-x: auto scroll container, so anything a row inside it painted outside
     that padding box is clipped, and widening the pull to reach a table's rows would
     move it into a state the code card's own rows cannot honour. So the strip is
     painted from the GUTTER side instead, which nothing clips and which both card
     kinds share: a ::before hung off the banded gutter
     cell's inline-end edge, spanning the content column's seam plus the card's own
     inset — exactly the gap between the two halves. background-color: inherit takes
     the cell's own band, so one rule covers selection amber, hover grey and the
     cursor tint without naming any of them, and follows the library if it recolors.
     ::before rather than ::after: the multi-line selection tick above owns ::after on
     these same cells. Reached through the gutter card, which is display: contents and
     so does not disturb matching.

     The offset starts at the cell's BORDER box, not its padding box. An absolutely
     positioned pseudo resolves 100% against the padding box, and a gutter cell carries
     the library's 2px border-right, so 100% alone lands the strip two pixels early —
     re-painting two pixels the cell's own background already covers (its border is
     transparent on a banded row) and leaving two unpainted in the seam.

     position: relative is set unconditionally rather than on the same state list: it
     costs nothing on an unbanded cell, and two copies of a six-state list is a rule
     that silently mispositions the strip the day someone extends one of them. */
  [data-gutter] :is([data-table-card-gutter], [data-code-card-gutter]) > [data-column-number] {
    position: relative;
  }
  [data-gutter]
    :is([data-table-card-gutter], [data-code-card-gutter])
    > [data-column-number]:is(
      [data-selected-line],
      [data-hovered],
      [data-line-type="change-addition"],
      [data-line-type="change-deletion"],
      [data-caret-cursor]
    )::before {
    content: "";
    position: absolute;
    top: 0;
    bottom: 0;
    inset-inline-start: calc(100% + var(--caret-gutter-divider));
    width: calc(var(--caret-seam) + var(--caret-card-inset));
    background-color: inherit;
    pointer-events: none;
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
  /* The band's outer corners. Descendant rather than child (EXC-865): a carded row is
     no longer a child of its column, and left on a child combinator a selection inside
     a card drew square ends while every other selection rounded. Widening works
     because the sibling logic is column-relative — inside a card the row's siblings ARE
     the block's other rows, so :not(~) still finds that card's first selected row and
     :not(:has(~)) its last. What widening cannot see is the band continuing PAST the
     card, so the two overrides below take those corners back off: a card preceded by a
     selected line is not where the band starts, and one followed by a selected line is
     not where it ends. Both are scoped to line cells, so an open composer's row — which
     the library also flags selected — never counts as the continuation. */
  [data-gutter]
    [data-column-number][data-selected-line]:not(
      [data-selected-line] ~ [data-column-number][data-selected-line]
    ) {
    border-top-left-radius: var(--radius);
  }
  [data-content]
    [data-line][data-selected-line]:not(
      [data-selected-line] ~ [data-line][data-selected-line]
    ) {
    border-top-right-radius: var(--radius);
  }
  [data-gutter]
    [data-column-number][data-selected-line]:not(:has(~ [data-column-number][data-selected-line])) {
    border-bottom-left-radius: var(--radius);
  }
  [data-content]
    [data-line][data-selected-line]:not(:has(~ [data-line][data-selected-line])) {
    border-bottom-right-radius: var(--radius);
  }
  [data-gutter]
    > [data-column-number][data-selected-line]
    ~ :is([data-table-card-gutter], [data-code-card-gutter])
    > [data-column-number][data-selected-line] {
    border-top-left-radius: 0;
  }
  [data-content]
    > [data-line][data-selected-line]
    ~ :is([data-table-card], [data-code-card])
    > [data-line][data-selected-line] {
    border-top-right-radius: 0;
  }
  [data-gutter]
    > :is([data-table-card-gutter], [data-code-card-gutter]):has(
      ~ [data-column-number][data-selected-line]
    )
    > [data-column-number][data-selected-line] {
    border-bottom-left-radius: 0;
  }
  [data-content]
    > :is([data-table-card], [data-code-card]):has(~ [data-line][data-selected-line])
    > [data-line][data-selected-line] {
    border-bottom-right-radius: 0;
  }
  /* The composer/annotation row the library also flags selected is NOT part of the
     band: clear its selection fill (both columns) so the surface background shows
     through to the left of the composer card. Descendant since EXC-865 — a carded row's
     comment sits inside the card, with its buffer inside the gutter mirror. */
  [data-gutter] [data-gutter-buffer][data-selected-line],
  [data-content] [data-line-annotation][data-selected-line] {
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
  [data-gutter] [data-gutter-buffer="annotation"],
  [data-content] [data-line-annotation] {
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
     breathing room so it reads as a chip around the whole reference rather than crowding
     the glyphs, and it is the family's own --chip-pad-* pair rather than a second set of
     numbers. EXC-880 cancelled the inline half with a matching negative margin so the
     backticks bracketing a citation never shifted; that is gone, because a cancelled pair
     spends the fill under the neighbouring glyph and two chips either side of one
     character double-coat its cell. The reference shifts its neighbours now, exactly as
     the inline chips above do. The radius sits on the resting rule because the
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
    padding: var(--chip-pad-block) var(--chip-pad-inline);
    background-color: var(--chip-ref);
    border-radius: var(--radius);
  }
  [data-content] [data-file-ref]:hover {
    background-color: var(--accent-wash);
  }
  [data-content] [data-file-ref]:hover::before {
    background-color: var(--ink);
  }

  /* A reference INSIDE a codespan — a backticked path behind a link target, the repo's
     commonest citation — is not a chip beside the code chip but ONE reference chip that
     happens to have backticks at its ends. (No backtick is written anywhere in this sheet;
     see the note above.) The two boxes composited before, and the seam showed twice over:
     the fill changed colour at the backticks, where --chip-code capped a --chip-ref middle,
     and it changed HEIGHT there too, because the reference's box was the bare text advance
     while the code chip either side of it carried the family's block padding.

     So the whole group takes the reference tint, and it is spelled as a REBIND of
     --chip-code on the tokens the pass marked data-md-cite rather than as an override of
     the layer variable. One declaration then reaches every rule that resolves the code
     tint — the token's own layer above and the nested one on the pseudo-element — with no
     specificity to lose, which is what a citation inside a bold element needs. The second
     declaration is the affordance's selection policy, unchanged from the standalone chip
     below: the code member drops its tint on a drag-selected row, and a citation must not,
     or the row would claim the path stopped being clickable.

     What the reference's own box gives up is what would otherwise show as a seam inside
     that pill. Its inline padding, because the group is already padded at both ends and
     the backticks are meant to sit tight around the path. Its fill, because the group's
     layer now carries it — keeping both would double-coat the middle in the same wash it
     is trying to match. And its radius, in that order: once the box is exactly the text
     advance it abuts the backticks rather than overlapping them, so a rounded corner would
     cut the fill with nothing underneath to show through. What it KEEPS is the block
     padding the chip family gives every member, which is what makes the pill one thickness
     end to end, and its hover, which is still the only part of the pill the pointer can
     press — the spread rule below then carries that one state across the rest of the group.

     Scoped to a reference the pass tagged as code, so a prose-labelled reference — which
     carries no member at all — keeps the standalone chip this rule is carved out of. */
  [data-content] [data-line] [data-md-cite] {
    --chip-code: var(--chip-ref);
    --md-code: var(--chip-ref);
  }
  [data-content] [data-line] [data-file-ref][data-md~="code"] {
    padding-inline: 0;
    background-color: transparent;
    border-radius: 0;
  }
  [data-content] [data-line] [data-file-ref][data-md~="code"]:hover {
    background-color: var(--accent-wash);
  }

  /* And the hover washes the WHOLE pill, not just the path inside it. The wash is the
     signal that a chip the reader sees as one object is pressable, so lighting only its
     middle reads as a chip with a lit core rather than as a lit chip.

     The rest of the group is the backtick token either side, reached as the reference's
     two ADJACENT siblings — hence the pair of combinators rather than a subtree
     selector, since there is no element around the group to hang one on. That
     adjacency is the citation shape's, not every cited group's: the reference is the
     codespan's whole interior there, so the group is exactly three tokens
     (inlineDecorate.test.ts pins it). A group carrying a further cut inside it — two
     resolved paths in one span, which detection deliberately still allows — puts an
     interior token next to the pointer instead, and that end of the pill stays
     unwashed. The cost is a partly-lit chip in a shape nobody writes; the alternative
     is an element around the group, which the split-only pass exists not to create.

     Both halves require the cite member on BOTH tokens, so a reference abutting a
     codespan it is not inside never lights that codespan.

     background-color, matching the reference's own hover above: the group's resting tint
     rides a background-IMAGE layer, so the wash lands underneath it and the two
     translucent fills blend into the single step up. The radius is the group's own, so
     the wash takes the pill's shape at the ends for free. */
  [data-content] [data-line] [data-md-cite]:has(+ [data-file-ref][data-md-cite]:hover),
  [data-content] [data-line] [data-file-ref][data-md-cite]:hover + [data-md-cite] {
    background-color: var(--accent-wash);
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

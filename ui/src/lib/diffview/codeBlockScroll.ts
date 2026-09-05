// Per-block horizontal scroll for the plan source view's fenced-code panels (EXC-729).
// @pierre/diffs renders each source line as an independent [data-line] cell, and EXC-692
// caps each fenced-code row at a reading width, so a line wider than that cap broke out of
// the panel background. The fix wraps an overflowing block's rows in ONE per-block card that
// is a single native horizontal scroll container, so the whole block scrolls as one unit:
// short lines scroll along with the wide ones (they share the card's scroll area), there is
// exactly one scrollbar at the card's bottom, and — because the wrapper is a subgrid whose
// rows still map to the parent's row tracks — the gutter line numbers stay perfectly aligned.
// Per-row scroll with a JS sync is the alternative that does not work: a short line cannot
// scroll at all, and syncing N ports lags into a visible "jelly".
//
// The card takes the contiguous RUN of the column's children across the block rather than its
// [data-line] rows alone (cardSlice.ts), so an open comment's annotation row — which carries
// no line index — rides inside the card at its anchor instead of below the whole block,
// beneath its scrollbar (EXC-1228).
//
// The card styling and its scrollbar live in coreStyles.ts (CARD_ATTR selects the card); this
// module only owns the DOM structure — which blocks are wrapped, kept, or unwrapped. A block
// that fits is left as plain direct-child rows, which EXC-692's per-row rules still style. The
// library owns and repaints these rows, so this re-runs after every repaint (SourceView's
// MutationObserver) and on viewport resize (a narrower viewport can push a fitting block into
// overflow, or the reverse); it is idempotent — an already-correct block mutates nothing, so a
// re-run cannot re-trigger that observer. happy-dom reports 0 for every layout metric, so
// overflow is read through an injectable `read`.

import { unwrappedSlice } from "$lib/diffview/cardSlice.ts";
import type { CodeBlockRange } from "$lib/diffview/codeBlocks.ts";

/** Marks a block's scroll card; its value is the block's 1-based start line, the key that
 * ties it to its block for idempotent reuse and for the card's coreStyles.ts styling. */
export const CARD_ATTR = "data-code-card";

/** Marks a block's gutter card — the line-number-column mirror of its content scroll card,
 * keyed by the same 1-based start line. @pierre/diffs' selection walk
 * (InteractionManager.renderSelection) pairs the gutter and content columns by direct-child
 * index and THROWS when their child counts differ ("gutter and content children dont match");
 * a content card collapses a block's N rows into one child, so without this mirror the columns
 * diverge and the throw kills the drag-selection highlight for the WHOLE view whenever any
 * block is carded. The gutter card is `display: contents` (set inline, like the content card's
 * grid-row) so it is purely structural — its cells still map to the shared subgrid row tracks
 * and keep their library styling (descendant-selector based) — and it lands at the same child
 * index as its content card, so the library's walk skips both (a card has no line index) and
 * stays balanced. That the walk skips them is also why a carded block's own code lines get no
 * selection band from the library; cardSelection.ts re-applies it inside both card kinds
 * (EXC-865), so they highlight while dragging like any other row. */
export const GUTTER_CARD_ATTR = "data-code-card-gutter";

/** The layout metrics that decide whether a block overflows its card. For an unwrapped block
 * these are read per row (does the capped row box overflow?); for a wrapped block they are
 * read from the card (does the block still overflow after wrapping?). */
export interface RowMetrics {
  scrollWidth: number;
  clientWidth: number;
}

export type MetricsReader = (el: Element) => RowMetrics;

const readMetrics: MetricsReader = (el) => ({
  scrollWidth: el.scrollWidth,
  clientWidth: el.clientWidth,
});

/** A block's 1-based line numbers — the key sequence its card's slice must cover. */
function blockLines(range: CodeBlockRange): number[] {
  return Array.from({ length: range.end - range.start + 1 }, (_, i) => range.start + i);
}

/** Wraps `slice` in a fresh scroll card at its position, keyed by `key`. The card spans one
 * parent row track per child it takes — the block's rows plus any annotation row among them
 * — so its subgrid maps them back to the shared tracks, keeping the gutter aligned. */
function wrapBlock(content: Element, key: string, slice: Element[]): void {
  const card = document.createElement("div");
  card.setAttribute(CARD_ATTR, key);
  card.style.gridRow = `span ${slice.length}`;
  content.insertBefore(card, slice[0] ?? null);
  for (const row of slice) card.appendChild(row);
}

/** Unwraps a card, returning its children to the column in place, then removes it. Used for
 * both the content scroll card and the gutter mirror card. */
function unwrapCard(column: Element, card: HTMLElement): void {
  while (card.firstChild != null) column.insertBefore(card.firstChild, card);
  card.remove();
}

/** Wraps a block's gutter cells in a display:contents card at their position, keyed like its
 * content card. display:contents keeps the cells mapped to the shared subgrid row tracks (the
 * card has no box), so the mirror is invisible — it exists only to rebalance the column counts
 * the library's selection walk asserts (see GUTTER_CARD_ATTR). */
function wrapGutterBlock(gutter: Element, key: string, cells: Element[]): void {
  const card = document.createElement("div");
  card.setAttribute(GUTTER_CARD_ATTR, key);
  card.style.display = "contents";
  gutter.insertBefore(card, cells[0] ?? null);
  for (const cell of cells) card.appendChild(cell);
}

/**
 * Ensures every overflowing fenced block is wrapped in one scroll card, and that blocks which
 * fit (or no longer exist) are not. Idempotent: an already-wrapped block that still overflows
 * is left exactly as-is (no DOM mutation), and a fitting unwrapped block is left as plain
 * rows. `read` is injectable for tests — it is called on a row to decide whether an unwrapped
 * block overflows, and on a card to decide whether a wrapped block still overflows.
 */
export function syncCodeBlockCards(
  root: ParentNode,
  ranges: CodeBlockRange[],
  read: MetricsReader = readMetrics,
): void {
  const content = root.querySelector<HTMLElement>("[data-content]");
  if (content == null) return;

  const wanted = new Set<string>();
  for (const range of ranges) {
    const key = String(range.start);
    const card = content.querySelector<HTMLElement>(`:scope > [${CARD_ATTR}="${key}"]`);
    if (card != null) {
      // Already wrapped: keep it only while it still overflows; otherwise the retire pass
      // below unwraps it (e.g. the viewport widened until the block fits). No equivalent of
      // tables.ts's cardHoldsRange, which re-validates a kept card's span: an annotation
      // change makes the library's partial render ineligible, so a card never survives one
      // to hold a stale span.
      const m = read(card);
      if (m.scrollWidth > m.clientWidth) wanted.add(key);
      continue;
    }
    // Not wrapped: wrap it if any row overflows its capped box. Measured on the slice's
    // [data-line] members alone — an open composer's annotation row rides in the slice too,
    // and its scrollWidth would card a block whose code fits.
    const slice = unwrappedSlice(content, "data-line", blockLines(range));
    // A partial column is a mid-repaint state, not a block to card: a slice short of the
    // range would mis-size grid-row, and the next repaint brings this pass back.
    if (slice === null) continue;
    const overflows = slice.some((el) => {
      if (!el.hasAttribute("data-line")) return false;
      const m = read(el);
      return m.scrollWidth > m.clientWidth;
    });
    if (overflows) {
      wrapBlock(content, key, slice);
      wanted.add(key);
    }
  }

  // Unwrap any card that is no longer wanted — its block now fits, or no longer exists.
  for (const card of content.querySelectorAll<HTMLElement>(`:scope > [${CARD_ATTR}]`)) {
    if (!wanted.has(card.getAttribute(CARD_ATTR) ?? "")) unwrapCard(content, card);
  }

  // Mirror the content cards into the gutter column so the two columns keep matching
  // direct-child counts (see GUTTER_CARD_ATTR). The overflow decision is content's alone — the
  // gutter never overflows — so the gutter simply follows `wanted`: wrap the cells of any newly
  // carded block, and unwrap any gutter card whose block was retired. Guarded on the gutter
  // existing so the content-only test harness (and any gutterless layout) is unaffected.
  const gutter = root.querySelector<HTMLElement>("[data-gutter]");
  if (gutter == null) return;
  for (const range of ranges) {
    const key = String(range.start);
    if (!wanted.has(key)) continue;
    if (gutter.querySelector(`:scope > [${GUTTER_CARD_ATTR}="${key}"]`) != null) continue;
    const cells = unwrappedSlice(gutter, "data-column-number", blockLines(range));
    if (cells !== null) wrapGutterBlock(gutter, key, cells);
  }
  for (const card of gutter.querySelectorAll<HTMLElement>(`:scope > [${GUTTER_CARD_ATTR}]`)) {
    if (!wanted.has(card.getAttribute(GUTTER_CARD_ATTR) ?? "")) unwrapCard(gutter, card);
  }
}

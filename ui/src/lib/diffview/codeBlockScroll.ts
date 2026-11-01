// Per-block cards for the plan source view's fenced code (EXC-729). @pierre/diffs renders
// each source line as an independent [data-line] cell, so no single element frames a block.
// This wraps EVERY block's rows in one card: a frame drawn across separate rows would seam
// its ring and drop shadow at every row boundary, and a card is also a single native
// horizontal scroll container, so a wide block scrolls as one unit — short lines scroll
// along with the wide ones, there is exactly one scrollbar, and because the card is a
// subgrid whose rows still map to the parent's row tracks, the gutter line numbers stay
// aligned. Per-row scroll with a JS sync is the alternative that does not work: a short
// line cannot scroll at all, and syncing N ports lags into a visible "jelly".
//
// The card takes the contiguous RUN of the column's children across the block rather than its
// [data-line] rows alone (cardSlice.ts), so an open comment's annotation row — which carries
// no line index — rides inside the card at its anchor instead of below the whole block
// (EXC-1228).
//
// The card styling and its scrollbar live in coreStyles.ts (CARD_ATTR selects the card); this
// module only owns the DOM structure — which blocks are wrapped, kept, or retired. The
// library owns and repaints these rows, so this re-runs after every repaint (SourceView's
// MutationObserver); it is idempotent — an already-correct block mutates nothing, so a re-run
// cannot re-trigger that observer.

import { unwrappedSlice } from "$lib/diffview/cardSlice.ts";
import type { CodeBlockRange } from "$lib/diffview/codeBlocks.ts";

/** Marks a block's card; its value is the block's 1-based start line, the key that
 * ties it to its block for idempotent reuse and for the card's coreStyles.ts styling. */
export const CARD_ATTR = "data-code-card";

/** Marks a block's gutter card — the line-number-column mirror of its content card,
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

/** Marks a card whose block the reviewer has soft-wrapped — caret's per-block, transient
 * reflow, distinct from the library's global `overflow: "wrap"` over every source line. Set
 * on both the content card and its gutter mirror, whose coreStyles.ts rules turn it into
 * pre-wrap rows and a top-aligned line number. */
export const REFLOW_ATTR = "data-code-card-reflow";

/** Marks a card whose code is wider than it, so it scrolls, and its gutter mirror, where
 * coreStyles.ts clears the scrollbar's lane beside the card's last row. */
export const SCROLLS_ATTR = "data-code-card-scrolls";

/** A block's 1-based line numbers — the key sequence its card's slice must cover. */
function blockLines(range: CodeBlockRange): number[] {
  return Array.from({ length: range.end - range.start + 1 }, (_, i) => range.start + i);
}

/** Wraps `slice` in a fresh card at its position, keyed by `key`. The card spans one
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
 * both the content card and the gutter mirror card. */
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
 * Ensures every fenced block is wrapped in one card, and that a card whose block no longer
 * exists is not. Idempotent: an already-wrapped block is left exactly as-is (no DOM
 * mutation).
 */
export function syncCodeBlockCards(root: ParentNode, ranges: CodeBlockRange[]): void {
  const content = root.querySelector<HTMLElement>("[data-content]");
  if (content == null) return;

  const wanted = new Set<string>();
  for (const range of ranges) {
    const key = String(range.start);
    if (content.querySelector(`:scope > [${CARD_ATTR}="${key}"]`) != null) {
      // No equivalent of tables.ts's cardHoldsRange, which re-validates a kept card's
      // span: an annotation change makes the library's partial render ineligible, so a
      // card never survives one to hold a stale span.
      wanted.add(key);
      continue;
    }
    const slice = unwrappedSlice(content, "data-line", blockLines(range));
    // A partial column is a mid-repaint state, not a block to card: a slice short of the
    // range would mis-size grid-row, and the next repaint brings this pass back.
    if (slice === null) continue;
    wrapBlock(content, key, slice);
    wanted.add(key);
  }

  for (const card of content.querySelectorAll<HTMLElement>(`:scope > [${CARD_ATTR}]`)) {
    if (!wanted.has(card.getAttribute(CARD_ATTR) ?? "")) unwrapCard(content, card);
  }

  // Mirror the content cards into the gutter column so the two columns keep matching
  // direct-child counts (see GUTTER_CARD_ATTR). Guarded on the gutter existing so the
  // content-only test harness (and any gutterless layout) is unaffected.
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

/**
 * Marks every card whose block the reviewer has reflowed, and clears the mark from the
 * rest. Runs immediately after syncCodeBlockCards in the same pass, so a card the library's
 * repaint destroyed and this pass rebuilt is re-marked on the frame it reappears — which is
 * why the state rides the DOM rather than syncCodeBlockCards' signature.
 */
export function applyCodeBlockReflow(root: ParentNode, reflowed: ReadonlySet<number>): void {
  for (const card of root.querySelectorAll(`[${CARD_ATTR}], [${GUTTER_CARD_ATTR}]`)) {
    const key = card.getAttribute(CARD_ATTR) ?? card.getAttribute(GUTTER_CARD_ATTR);
    card.toggleAttribute(REFLOW_ATTR, reflowed.has(Number(key)));
  }
}

/**
 * Marks every card whose code is wider than it, and its gutter mirror, and clears the mark
 * from the rest. Reads layout, so it runs after the passes that change a card's width: the
 * carding and the reflow marks above.
 */
export function markScrollingCards(root: ParentNode): void {
  for (const card of root.querySelectorAll(`[data-content] > [${CARD_ATTR}]`)) {
    const scrolls = card.scrollWidth > card.clientWidth;
    card.toggleAttribute(SCROLLS_ATTR, scrolls);
    const key = card.getAttribute(CARD_ATTR);
    root
      .querySelector(`[data-gutter] > [${GUTTER_CARD_ATTR}="${key}"]`)
      ?.toggleAttribute(SCROLLS_ATTR, scrolls);
  }
}

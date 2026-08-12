// Per-block horizontal scroll for the plan source view's fenced-code panels (EXC-729).
// @pierre/diffs renders each source line as an independent [data-line] cell, and EXC-692
// caps each fenced-code row at a reading width, so a line wider than that cap broke out of
// the panel background. The fix wraps an overflowing block's rows in ONE per-block card that
// is a single native horizontal scroll container, so the whole block scrolls as one unit:
// short lines scroll along with the wide ones (they share the card's scroll area), there is
// exactly one scrollbar at the card's bottom, and — because the wrapper is a subgrid whose
// rows still map to the parent's row tracks — the gutter line numbers stay perfectly aligned.
// This replaces the earlier per-row scroll + JS sync + injected scrollbar, which made each
// row its own scroll port (a short line couldn't scroll, and syncing N ports lagged into a
// visible "jelly"). Native scroll of one container has neither problem.
//
// The card styling and its scrollbar live in coreStyles.ts (CARD_ATTR selects the card); this
// module only owns the DOM structure — which blocks are wrapped, kept, or unwrapped. A block
// that fits is left as plain direct-child rows, which EXC-692's per-row rules still style. The
// library owns and repaints these rows, so this re-runs after every repaint (SourceView's
// MutationObserver) and on viewport resize (a narrower viewport can push a fitting block into
// overflow, or the reverse); it is idempotent — an already-correct block mutates nothing, so a
// re-run cannot re-trigger that observer. happy-dom reports 0 for every layout metric, so
// overflow is read through an injectable `read`.

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

export type MetricsReader = (el: HTMLElement) => RowMetrics;

const readMetrics: MetricsReader = (el) => ({
  scrollWidth: el.scrollWidth,
  clientWidth: el.clientWidth,
});

/** The direct-child content rows of a block, in document order, read by 1-based data-line.
 * Only direct children — a wrapped block is handled through its card, never this path. */
function directBlockRows(content: Element, range: CodeBlockRange): HTMLElement[] {
  const rows: HTMLElement[] = [];
  for (let n = range.start; n <= range.end; n++) {
    const row = content.querySelector<HTMLElement>(`:scope > [data-line="${n}"]`);
    if (row != null) rows.push(row);
  }
  return rows;
}

/** Wraps `rows` in a fresh scroll card at their position, keyed by `key`. The card spans the
 * block's rows (grid-row) so its subgrid maps them to the shared row tracks, keeping the
 * gutter aligned. Rows are moved in document order. */
function wrapBlock(content: Element, key: string, rows: HTMLElement[]): void {
  const card = document.createElement("div");
  card.setAttribute(CARD_ATTR, key);
  card.style.gridRow = `span ${rows.length}`;
  content.insertBefore(card, rows[0] ?? null);
  for (const row of rows) card.appendChild(row);
}

/** Unwraps a card, returning its children to the column in place, then removes it. Used for
 * both the content scroll card and the gutter mirror card. */
function unwrapCard(column: Element, card: HTMLElement): void {
  while (card.firstChild != null) column.insertBefore(card.firstChild, card);
  card.remove();
}

/** The direct-child gutter cells for a block, in document order, by 1-based column number —
 * the gutter counterpart of directBlockRows. Only direct children (a wrapped block's cells
 * live inside its gutter card and are handled through that card). */
function directGutterCells(gutter: Element, range: CodeBlockRange): HTMLElement[] {
  const cells: HTMLElement[] = [];
  for (let n = range.start; n <= range.end; n++) {
    const cell = gutter.querySelector<HTMLElement>(`:scope > [data-column-number="${n}"]`);
    if (cell != null) cells.push(cell);
  }
  return cells;
}

/** Wraps a block's gutter cells in a display:contents card at their position, keyed like its
 * content card. display:contents keeps the cells mapped to the shared subgrid row tracks (the
 * card has no box), so the mirror is invisible — it exists only to rebalance the column counts
 * the library's selection walk asserts (see GUTTER_CARD_ATTR). */
function wrapGutterBlock(gutter: Element, key: string, cells: HTMLElement[]): void {
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
      // below unwraps it (e.g. the viewport widened until the block fits).
      const m = read(card);
      if (m.scrollWidth > m.clientWidth) wanted.add(key);
      continue;
    }
    // Not wrapped: wrap it if any row overflows its capped box.
    const rows = directBlockRows(content, range);
    if (rows.length === 0) continue;
    const overflows = rows.some((row) => {
      const m = read(row);
      return m.scrollWidth > m.clientWidth;
    });
    if (overflows) {
      wrapBlock(content, key, rows);
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
    const cells = directGutterCells(gutter, range);
    if (cells.length > 0) wrapGutterBlock(gutter, key, cells);
  }
  for (const card of gutter.querySelectorAll<HTMLElement>(`:scope > [${GUTTER_CARD_ATTR}]`)) {
    if (!wanted.has(card.getAttribute(GUTTER_CARD_ATTR) ?? "")) unwrapCard(gutter, card);
  }
}

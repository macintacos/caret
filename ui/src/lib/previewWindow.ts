// Which of a file preview's rows are worth mounting (EXC-970).
//
// The preview accumulates a chunk at a time and can end up holding a whole file,
// so the DOM — not the fetch — is what a large file costs. Only the rows near the
// viewport are mounted; a spacer above and a spacer below carry the height of the
// rest, so total scroll height and the scrollbar's proportions are exactly what
// they would be with every row present.
//
// **Fixed row height is load-bearing.** Every `.fp-row` is a flex box of two
// `white-space: pre` items with no padding or border, so a row is exactly one
// `line-height` tall and the nth row's top is `n * rowHeight`. Anything that lets
// rows wrap or vary in height — soft wrap, an inline widget, a taller marked row —
// invalidates this arithmetic, and the window would have to measure rows
// individually instead.
//
// Pure, so the component keeps only the Svelte shell (the scroll handler, the
// ResizeObserver, the row measurement) and this stays testable without a browser
// — the same split diffview/lineDrag.ts and fileDrawer.ts take.

/** Rows mounted beyond each edge of the viewport, so a scroll that outruns a
 * frame's re-render still finds rows there instead of a blank band. */
export const OVERSCAN_ROWS = 10;

/** The region's geometry, as the scroller reports it. A `rowHeight` or
 * `viewportHeight` of 0 means "not measured yet" — before first layout, and
 * always under happy-dom, which has no layout engine. */
export interface RowWindowInput {
  /** Rows the loaded region holds, mounted or not. */
  total: number;
  rowHeight: number;
  /** How far the viewport's top sits below the **first row's** top. A scroller
   * with leading padding owes that padding back before passing its `scrollTop`,
   * or every row lands a fraction of a row late. */
  scrollTop: number;
  viewportHeight: number;
  overscan?: number;
}

/** The mounted slice `[first, first + count)`, plus the pixel heights the
 * spacers standing in for the rows on either side of it must carry. */
export interface RowWindow {
  first: number;
  count: number;
  above: number;
  below: number;
}

/**
 * The rows to mount for a region scrolled to `scrollTop`. Unmeasured geometry
 * mounts everything: that is the honest answer before the region has been laid
 * out, and rendering nothing until a measurement lands would flash an empty
 * panel on open.
 */
export function rowWindow({
  total,
  rowHeight,
  scrollTop,
  viewportHeight,
  overscan = OVERSCAN_ROWS,
}: RowWindowInput): RowWindow {
  if (rowHeight <= 0 || viewportHeight <= 0) {
    return { first: 0, count: total, above: 0, below: 0 };
  }
  // The rows the viewport covers, plus the one straddling its bottom edge, plus
  // the overscan at both ends.
  const span = Math.ceil(viewportHeight / rowHeight) + 1 + overscan * 2;
  // Clamped to a full span at both ends, so an offset past either end of the
  // region still mounts a screenful rather than collapsing to the one row that
  // technically exists there — which is the blank band the overscan is for.
  const first = Math.min(
    Math.max(0, Math.floor(scrollTop / rowHeight) - overscan),
    Math.max(0, total - span),
  );
  const count = Math.min(total - first, span);
  return { first, count, above: first * rowHeight, below: (total - first - count) * rowHeight };
}

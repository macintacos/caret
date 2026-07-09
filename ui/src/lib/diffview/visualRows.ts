// Grouping per-source-line rectangles into VISUAL rows (display lines) for the
// rendered plan view (EXC-693). The rendered view joins soft-wrapped source lines
// into flowing prose, so a display line the reader sees can carry parts of two
// source lines, and one source line can wrap across two display lines. Interaction
// is by DISPLAY line: hovering or clicking a display line highlights that whole row
// and maps it back to the source line(s) it covers, so the range handed to the
// reviewer stays correct while the highlight matches what the eye calls "the line."
//
// This is the pure geometry — the caller passes in the line rectangles it read from
// the DOM — so it unit-tests deterministically without a browser layout.

/** One rectangle fragment of a source line, in viewport coordinates. */
export interface LineRect {
  /** 1-based source line this fragment belongs to. */
  line: number;
  top: number;
  bottom: number;
}

/** A display line: a horizontal band and the source lines that appear on it. */
export interface VisualRow {
  top: number;
  bottom: number;
  /** The source lines present on this display row, ascending and de-duplicated. */
  lines: number[];
}

/**
 * Cluster line-fragment rects into display rows by vertical band. Fragments that
 * overlap vertically sit on the same display row; a fragment whose top clears the
 * current band opens a new row. Input order does not matter (sorted internally). A
 * one-pixel slack absorbs sub-pixel differences between fragments on one line — the
 * leading between two display lines is far larger, so a new row still opens cleanly.
 */
export function groupVisualRows(rects: LineRect[]): VisualRow[] {
  const sorted = [...rects].sort((a, b) => a.top - b.top || a.bottom - b.bottom);
  const rows: { top: number; bottom: number; lines: Set<number> }[] = [];
  for (const r of sorted) {
    const cur = rows[rows.length - 1];
    if (cur != null && r.top < cur.bottom - 1) {
      cur.bottom = Math.max(cur.bottom, r.bottom);
      cur.lines.add(r.line);
    } else {
      rows.push({ top: r.top, bottom: r.bottom, lines: new Set([r.line]) });
    }
  }
  return rows.map((row) => ({
    top: row.top,
    bottom: row.bottom,
    lines: [...row.lines].sort((a, b) => a - b),
  }));
}

/**
 * Close the small vertical gaps between consecutive rows (up to `maxGap` px) by
 * meeting them at their midpoint, so the rows read as contiguous — hovering never
 * falls into the thin leading between wrapped lines. Larger gaps stay open: a block
 * margin holding an inline comment thread, or a section break, is not a line and
 * must not be attributed to one. Outer edges are left at the text rect.
 */
export function closeRowGaps(rows: VisualRow[], maxGap: number): VisualRow[] {
  for (let i = 0; i < rows.length - 1; i++) {
    const lo = rows[i];
    const hi = rows[i + 1];
    if (lo == null || hi == null) continue;
    const gap = hi.top - lo.bottom;
    if (gap > 0 && gap <= maxGap) {
      const mid = (lo.bottom + hi.top) / 2;
      lo.bottom = mid;
      hi.top = mid;
    }
  }
  return rows;
}

/** The display row whose band contains viewport `y`, or null when `y` is in a gap. */
export function rowAtY(rows: VisualRow[], y: number): VisualRow | null {
  for (const row of rows) {
    if (y >= row.top && y <= row.bottom) return row;
  }
  return null;
}

/** The display rows that carry any source line in the inclusive range [start, end]. */
export function rowsIntersecting(rows: VisualRow[], start: number, end: number): VisualRow[] {
  return rows.filter((row) => row.lines.some((n) => n >= start && n <= end));
}

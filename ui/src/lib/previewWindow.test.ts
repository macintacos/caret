import { describe, expect, test } from "bun:test";

import { OVERSCAN_ROWS, rowWindow } from "$lib/previewWindow.ts";

// The file preview windows its rows: only those near the viewport are mounted,
// and two spacers stand in for the rest. These pin the arithmetic that decides
// which rows those are — the part that needs no layout engine. Whether the rows
// it names actually render where they should is real-browser behaviour and lives
// in test/e2e/file-refs.e2e.ts.

/** Every row of a `total`-row region, laid end to end, is still reachable: the
 * two spacers plus the mounted rows always add up to the full scroll height. */
function scrollHeight(w: ReturnType<typeof rowWindow>, rowHeight: number): number {
  return w.above + w.count * rowHeight + w.below;
}

describe("rowWindow degenerate geometry", () => {
  test("renders every row when the row height has not been measured", () => {
    expect(rowWindow({ total: 500, rowHeight: 0, scrollTop: 0, viewportHeight: 400 })).toEqual({
      first: 0,
      count: 500,
      above: 0,
      below: 0,
    });
  });

  test("renders every row when the region has no height yet", () => {
    expect(rowWindow({ total: 500, rowHeight: 20, scrollTop: 0, viewportHeight: 0 })).toEqual({
      first: 0,
      count: 500,
      above: 0,
      below: 0,
    });
  });

  test("an empty region windows to nothing", () => {
    expect(rowWindow({ total: 0, rowHeight: 20, scrollTop: 0, viewportHeight: 400 })).toEqual({
      first: 0,
      count: 0,
      above: 0,
      below: 0,
    });
  });
});

describe("rowWindow row selection", () => {
  test("windows a scrolled region to the rows around the offset", () => {
    const w = rowWindow({ total: 1000, rowHeight: 20, scrollTop: 4000, viewportHeight: 400 });
    // Row 200 sits at the top edge; the overscan reaches ten rows back from it.
    expect(w.first).toBe(200 - OVERSCAN_ROWS);
    // Twenty rows fill the region, one more straddles its bottom edge, and the
    // overscan pads both ends.
    expect(w.count).toBe(21 + OVERSCAN_ROWS * 2);
  });

  test("a row straddling the top edge is still mounted", () => {
    // Row 200 spans 4000–4020, so at 4010 its lower half is on screen.
    const w = rowWindow({
      total: 1000,
      rowHeight: 20,
      scrollTop: 4010,
      viewportHeight: 400,
      overscan: 0,
    });
    expect(w.first).toBe(200);
    // …and row 220 (4400–4420) straddles the bottom edge, so the span covers it.
    expect(w.first + w.count - 1).toBe(220);
  });

  test("the overscan pads both ends of the visible span", () => {
    const tight = rowWindow({
      total: 1000,
      rowHeight: 20,
      scrollTop: 4000,
      viewportHeight: 400,
      overscan: 0,
    });
    const padded = rowWindow({
      total: 1000,
      rowHeight: 20,
      scrollTop: 4000,
      viewportHeight: 400,
      overscan: 5,
    });
    expect(padded.first).toBe(tight.first - 5);
    expect(padded.count).toBe(tight.count + 10);
  });

  test("the window never reaches above the first row", () => {
    const w = rowWindow({ total: 1000, rowHeight: 20, scrollTop: 0, viewportHeight: 400 });
    expect(w.first).toBe(0);
    expect(w.above).toBe(0);
  });

  test("a rubber-band scroll past the top still starts at the first row", () => {
    // Overscroll hands the scroller a negative offset on macOS.
    const w = rowWindow({ total: 1000, rowHeight: 20, scrollTop: -80, viewportHeight: 400 });
    expect(w.first).toBe(0);
    expect(w.above).toBe(0);
  });

  test("the window never reaches past the last row", () => {
    // Scrolled hard against the bottom of a 20,000px region.
    const w = rowWindow({ total: 1000, rowHeight: 20, scrollTop: 19_600, viewportHeight: 400 });
    expect(w.first + w.count).toBe(1000);
    expect(w.below).toBe(0);
  });

  test("a rubber-band scroll past the bottom still mounts the last row", () => {
    const w = rowWindow({ total: 1000, rowHeight: 20, scrollTop: 40_000, viewportHeight: 400 });
    expect(w.count).toBeGreaterThan(0);
    expect(w.first + w.count).toBe(1000);
  });
});

describe("rowWindow spacers", () => {
  test("the spacers stand in for exactly the rows they replace", () => {
    const w = rowWindow({ total: 1000, rowHeight: 20, scrollTop: 4000, viewportHeight: 400 });
    expect(w.above).toBe(w.first * 20);
    expect(w.below).toBe((1000 - w.first - w.count) * 20);
  });

  test("total scroll height is preserved wherever the window sits", () => {
    // A scrollbar whose proportions moved as the reader scrolled would be the
    // most visible failure of windowing, so pin the height at every offset.
    for (const scrollTop of [0, 137, 4000, 10_000, 19_600]) {
      const w = rowWindow({ total: 1000, rowHeight: 20, scrollTop, viewportHeight: 400 });
      expect(scrollHeight(w, 20)).toBe(20_000);
    }
  });

  test("a region shorter than its viewport needs no spacers", () => {
    const w = rowWindow({ total: 5, rowHeight: 20, scrollTop: 0, viewportHeight: 400 });
    expect(w).toEqual({ first: 0, count: 5, above: 0, below: 0 });
  });
});

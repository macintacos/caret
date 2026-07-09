import { describe, expect, test } from "bun:test";
import {
  closeRowGaps,
  groupVisualRows,
  type LineRect,
  rowAtY,
  rowsIntersecting,
} from "./visualRows.ts";

// visualRows groups per-source-line rectangles into DISPLAY rows: the rendered plan
// joins soft-wrapped source lines into flowing prose, so a display line can carry
// two source lines and a source line can wrap across two display lines. These pure
// tests pin that mapping with injected geometry (no browser layout needed).

describe("groupVisualRows", () => {
  test("fragments sharing a vertical band become one display row", () => {
    // Two source lines packed onto the same display row (line 3's tail + line 4).
    const rects: LineRect[] = [
      { line: 3, top: 0, bottom: 20 },
      { line: 4, top: 0, bottom: 20 },
    ];
    const rows = groupVisualRows(rects);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.lines).toEqual([3, 4]);
  });

  test("a source line wrapping across two display rows appears on both", () => {
    // A joined paragraph of source lines 3,4,5 reflowed onto two display rows:
    // row A = line 3 (whole) + line 4 (start); row B = line 4 (rest) + line 5.
    const rects: LineRect[] = [
      { line: 3, top: 0, bottom: 20 },
      { line: 4, top: 0, bottom: 20 },
      { line: 4, top: 22, bottom: 42 },
      { line: 5, top: 22, bottom: 42 },
    ];
    const rows = groupVisualRows(rects);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.lines).toEqual([3, 4]);
    expect(rows[1]?.lines).toEqual([4, 5]);
  });

  test("input order does not matter; lines are ascending and de-duplicated", () => {
    const rects: LineRect[] = [
      { line: 5, top: 22, bottom: 42 },
      { line: 3, top: 0, bottom: 20 },
      { line: 4, top: 22, bottom: 42 },
      { line: 4, top: 0, bottom: 20 },
    ];
    const rows = groupVisualRows(rects);
    expect(rows.map((r) => r.lines)).toEqual([
      [3, 4],
      [4, 5],
    ]);
  });

  test("a clear vertical gap opens a new display row", () => {
    const rects: LineRect[] = [
      { line: 1, top: 0, bottom: 20 },
      { line: 2, top: 40, bottom: 60 },
    ];
    const rows = groupVisualRows(rects);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.lines)).toEqual([[1], [2]]);
  });
});

describe("closeRowGaps", () => {
  test("small gaps between rows meet at the midpoint (contiguous)", () => {
    const rows = groupVisualRows([
      { line: 1, top: 0, bottom: 20 },
      { line: 2, top: 30, bottom: 50 }, // 10px leading gap
    ]);
    closeRowGaps(rows, 14);
    expect(rows[0]?.bottom).toBe(25);
    expect(rows[1]?.top).toBe(25);
  });

  test("large gaps stay open (a comment thread / section break is not a line)", () => {
    const rows = groupVisualRows([
      { line: 1, top: 0, bottom: 20 },
      { line: 2, top: 80, bottom: 100 }, // 60px gap
    ]);
    closeRowGaps(rows, 14);
    expect(rows[0]?.bottom).toBe(20);
    expect(rows[1]?.top).toBe(80);
  });

  test("outer edges are left untouched", () => {
    const rows = groupVisualRows([
      { line: 1, top: 5, bottom: 20 },
      { line: 2, top: 30, bottom: 50 },
    ]);
    closeRowGaps(rows, 14);
    expect(rows[0]?.top).toBe(5);
    expect(rows[1]?.bottom).toBe(50);
  });
});

describe("rowAtY", () => {
  const rows = groupVisualRows([
    { line: 1, top: 0, bottom: 20 },
    { line: 2, top: 20, bottom: 40 },
  ]);

  test("returns the row whose band contains y", () => {
    expect(rowAtY(rows, 10)?.lines).toEqual([1]);
    expect(rowAtY(rows, 30)?.lines).toEqual([2]);
  });

  test("returns null when y is outside every band", () => {
    expect(rowAtY(rows, 100)).toBeNull();
    expect(rowAtY(rows, -5)).toBeNull();
  });
});

describe("rowsIntersecting", () => {
  const rows = groupVisualRows([
    { line: 3, top: 0, bottom: 20 },
    { line: 4, top: 0, bottom: 20 },
    { line: 4, top: 22, bottom: 42 },
    { line: 5, top: 22, bottom: 42 },
  ]);

  test("selects every display row carrying a line in the range", () => {
    // A range on source line 4 lights up both rows it wraps across.
    expect(rowsIntersecting(rows, 4, 4)).toHaveLength(2);
    // A range on source line 3 lights up only its row.
    expect(rowsIntersecting(rows, 3, 3).map((r) => r.lines)).toEqual([[3, 4]]);
  });

  test("an out-of-range span selects nothing", () => {
    expect(rowsIntersecting(rows, 9, 12)).toEqual([]);
  });
});

import { describe, expect, test } from "bun:test";
import { anchorPoint, isAnchorVisible } from "./popoverAnchor.ts";

describe("anchorPoint", () => {
  test("centers horizontally on the mark and sits at its bottom", () => {
    expect(anchorPoint({ left: 100, width: 40, bottom: 200 })).toEqual({
      x: 120,
      y: 200,
    });
  });
});

describe("isAnchorVisible", () => {
  test("true when the mark overlaps the viewport", () => {
    expect(isAnchorVisible({ top: 50, bottom: 70 }, { top: 0, bottom: 100 })).toBe(true);
  });

  test("false when the mark is scrolled fully above the viewport", () => {
    expect(isAnchorVisible({ top: -40, bottom: -10 }, { top: 0, bottom: 100 })).toBe(false);
  });

  test("false when the mark is scrolled fully below the viewport", () => {
    expect(isAnchorVisible({ top: 120, bottom: 160 }, { top: 0, bottom: 100 })).toBe(false);
  });
});

import "@ui/support/setup.ts";
import { describe, expect, test } from "bun:test";

import { outlineFits } from "$lib/fileDrawer.ts";
import { outlineBounds, outlineReset, outlineWidth } from "$lib/outlineColumn.ts";

// At a 16px root the column opens at 248px (15.5rem), narrows to 192px (12rem) and
// widens to 480px (30rem).
describe("outlineBounds", () => {
  test("lets the column widen until the plan beside it reads at 800px", () => {
    expect(outlineBounds(1200, 16)).toEqual({ min: 192, max: 400 });
  });

  test("caps the column at 30rem however wide the window", () => {
    expect(outlineBounds(2400, 16).max).toBe(480);
  });

  test("never caps the column under its opening width", () => {
    expect(outlineBounds(1000, 16).max).toBe(248);
  });

  test("scales with the root font size", () => {
    expect(outlineBounds(2400, 20)).toEqual({ min: 240, max: 600 });
  });

  test("beside a drawer, stops where the column would yield to it", () => {
    expect(outlineBounds(1800, 16, { chosen: 600 }).max).toBe(400);
    expect(outlineBounds(1800, 16, { chosen: null }).max).toBe(345);
    expect(outlineFits(1800, 400, 600)).toBe(true);
    expect(outlineFits(1800, 401, 600)).toBe(false);
  });

  test("beside a drawer that leaves the column no room, the bounds meet at the minimum", () => {
    expect(outlineBounds(1600, 16, { chosen: 700 })).toEqual({ min: 192, max: 192 });
  });
});

describe("outlineWidth", () => {
  test("opens at 15.5rem with nothing chosen", () => {
    expect(outlineWidth(null, 1440, 16)).toBe(248);
    expect(outlineWidth(null, 1440, 20)).toBe(310);
  });

  test("holds a chosen width inside the bounds", () => {
    expect(outlineWidth(300, 1440, 16)).toBe(300);
  });

  test("clamps a chosen width to the bounds", () => {
    expect(outlineWidth(100, 1440, 16)).toBe(192);
    expect(outlineWidth(900, 1440, 16)).toBe(480);
  });

  test("narrows a chosen width with the window and restores it as the window widens", () => {
    expect(outlineWidth(450, 1150, 16)).toBe(350);
    expect(outlineWidth(450, 1600, 16)).toBe(450);
  });
});

describe("outlineReset", () => {
  test("returns the column to its opening width wherever the bounds reach it", () => {
    expect(outlineReset(outlineBounds(1200, 16).max, 16)).toBeNull();
    expect(outlineReset(outlineBounds(1800, 16, { chosen: 600 }).max, 16)).toBeNull();
  });

  test("beside a file the opening width yields to, stands the column as wide as keeps it there", () => {
    expect(outlineReset(outlineBounds(1680, 16, { chosen: null }).max, 16)).toBe(225);
  });
});

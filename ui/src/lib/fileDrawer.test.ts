import "@ui/support/setup.ts";
import { afterEach, describe, expect, test } from "bun:test";

import {
  clampDrawerSize,
  FILE_DRAWER_HEIGHT_KEY,
  FILE_DRAWER_WIDTH_KEY,
  MIN_DRAWER_PX,
  MIN_PLAN_PX,
  MIN_PLAN_WIDTH_PX,
  maxDrawerSize,
  readDrawerSize,
  writeDrawerSize,
} from "$lib/fileDrawer.ts";

afterEach(() => localStorage.clear());

describe("clampDrawerSize", () => {
  test("passes a size that fits both bounds through unchanged", () => {
    expect(clampDrawerSize(400, 1200, "right")).toBe(400);
  });

  test("raises a too-small size to MIN_DRAWER_PX", () => {
    expect(clampDrawerSize(40, 1200, "right")).toBe(MIN_DRAWER_PX);
  });

  test("caps a right drawer so the plan keeps MIN_PLAN_WIDTH_PX", () => {
    expect(clampDrawerSize(1100, 1200, "right")).toBe(1200 - MIN_PLAN_WIDTH_PX);
  });

  test("caps a bottom drawer so the plan keeps MIN_PLAN_PX", () => {
    expect(clampDrawerSize(1100, 1200, "bottom")).toBe(1200 - MIN_PLAN_PX);
  });

  test("falls back to MIN_DRAWER_PX when the axis cannot hold both minimums", () => {
    // available - MIN_PLAN_PX is below MIN_DRAWER_PX here, so the two bounds
    // cross: the drawer keeps its floor rather than collapsing to nothing.
    expect(clampDrawerSize(400, MIN_PLAN_PX + 10, "bottom")).toBe(MIN_DRAWER_PX);
  });
});

describe("maxDrawerSize", () => {
  test("leaves the plan its minimum on the docking axis", () => {
    expect(maxDrawerSize(1200, "right")).toBe(1200 - MIN_PLAN_WIDTH_PX);
    expect(maxDrawerSize(1200, "bottom")).toBe(1200 - MIN_PLAN_PX);
  });

  test("never drops below the drawer's own floor", () => {
    expect(maxDrawerSize(MIN_PLAN_WIDTH_PX + 10, "right")).toBe(MIN_DRAWER_PX);
  });

  test("is the bound clampDrawerSize enforces", () => {
    expect(clampDrawerSize(99_999, 1200, "right")).toBe(maxDrawerSize(1200, "right"));
  });
});

describe("drawer size persistence", () => {
  test("returns null when nothing is stored", () => {
    expect(readDrawerSize("right")).toBeNull();
    expect(readDrawerSize("bottom")).toBeNull();
  });

  test("round-trips a size per edge", () => {
    writeDrawerSize("right", 420);
    expect(readDrawerSize("right")).toBe(420);
  });

  test("keeps the two edges independent", () => {
    writeDrawerSize("right", 420);
    writeDrawerSize("bottom", 310);
    expect(readDrawerSize("right")).toBe(420);
    expect(readDrawerSize("bottom")).toBe(310);

    writeDrawerSize("right", 500);
    expect(readDrawerSize("bottom")).toBe(310);
  });

  test("writes each edge under its own key", () => {
    writeDrawerSize("right", 420);
    writeDrawerSize("bottom", 310);
    expect(localStorage.getItem(FILE_DRAWER_WIDTH_KEY)).toBe("420");
    expect(localStorage.getItem(FILE_DRAWER_HEIGHT_KEY)).toBe("310");
  });
});

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
  outlineFits,
  outlineRoom,
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

// The outline column yields to an open drawer once the plan beside both would read under
// 800px. A 248px column (15.5rem) and the default 45% drawer part ways at about 1,703px.
describe("outlineFits", () => {
  test("keeps the column while the plan reads at 800px or more beside the default drawer", () => {
    expect(outlineFits(1710, 248, null)).toBe(true);
    expect(outlineFits(1700, 248, null)).toBe(false);
  });

  test("measures a remembered drawer width rather than the default share", () => {
    expect(outlineFits(1440, 248, 300)).toBe(true);
    expect(outlineFits(1440, 248, 400)).toBe(false);
  });
});

describe("outlineRoom", () => {
  test("is the widest column outlineFits keeps beside the drawer", () => {
    for (const [available, chosen] of [
      [1710, null],
      [1800, null],
      [1440, 300],
      [1440, 100],
      [2000, 800],
    ] as const) {
      const room = outlineRoom(available, chosen);
      expect(outlineFits(available, room, chosen)).toBe(true);
      expect(outlineFits(available, room + 1, chosen)).toBe(false);
    }
  });

  test("measures the drawer the column would stand beside", () => {
    expect(outlineRoom(1710, null)).toBe(255);
    expect(outlineRoom(1440, 300)).toBe(340);
    // A remembered width under the drawer's floor opens at the floor.
    expect(outlineRoom(1440, 100)).toBe(400);
  });
});

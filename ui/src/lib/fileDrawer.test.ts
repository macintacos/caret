import "@ui/test-setup.ts";
import { afterEach, describe, expect, test } from "bun:test";

import {
  clampDrawerSize,
  drawerSizeFromPointer,
  FILE_DRAWER_HEIGHT_KEY,
  FILE_DRAWER_WIDTH_KEY,
  MIN_DRAWER_PX,
  MIN_PLAN_PX,
  maxDrawerSize,
  readDrawerSize,
  writeDrawerSize,
} from "$lib/fileDrawer.ts";

afterEach(() => localStorage.clear());

/** Swap localStorage for one that throws on every access, for the fail-safe tests. */
function withBlockedStorage(body: () => void): void {
  const original = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new Error("blocked");
    },
  });
  try {
    body();
  } finally {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: original,
    });
  }
}

describe("clampDrawerSize", () => {
  test("passes a size that fits both bounds through unchanged", () => {
    expect(clampDrawerSize(400, 1200)).toBe(400);
  });

  test("raises a too-small size to MIN_DRAWER_PX", () => {
    expect(clampDrawerSize(40, 1200)).toBe(MIN_DRAWER_PX);
  });

  test("caps the size so the plan keeps MIN_PLAN_PX", () => {
    expect(clampDrawerSize(1100, 1200)).toBe(1200 - MIN_PLAN_PX);
  });

  test("falls back to MIN_DRAWER_PX when the axis cannot hold both minimums", () => {
    // available - MIN_PLAN_PX is below MIN_DRAWER_PX here, so the two bounds
    // cross: the drawer keeps its floor rather than collapsing to nothing.
    expect(clampDrawerSize(400, MIN_PLAN_PX + 10)).toBe(MIN_DRAWER_PX);
  });
});

describe("maxDrawerSize", () => {
  test("leaves the plan its minimum", () => {
    expect(maxDrawerSize(1200)).toBe(1200 - MIN_PLAN_PX);
  });

  test("never drops below the drawer's own floor", () => {
    expect(maxDrawerSize(MIN_PLAN_PX + 10)).toBe(MIN_DRAWER_PX);
  });

  test("is the bound clampDrawerSize enforces", () => {
    expect(clampDrawerSize(99_999, 1200)).toBe(maxDrawerSize(1200));
  });
});

describe("drawerSizeFromPointer", () => {
  const outer = { right: 1000, bottom: 800 };

  test("measures a right drawer back from its own right edge", () => {
    expect(drawerSizeFromPointer("right", { clientX: 600, clientY: 400 }, outer, 1000)).toBe(400);
  });

  test("measures a bottom drawer up from its own bottom edge", () => {
    expect(drawerSizeFromPointer("bottom", { clientX: 600, clientY: 500 }, outer, 800)).toBe(300);
  });

  test("clamps a right drag past the plan's minimum", () => {
    expect(drawerSizeFromPointer("right", { clientX: 10, clientY: 400 }, outer, 1000)).toBe(
      1000 - MIN_PLAN_PX,
    );
  });

  test("clamps a right drag dragged past the drawer's own minimum", () => {
    expect(drawerSizeFromPointer("right", { clientX: 995, clientY: 400 }, outer, 1000)).toBe(
      MIN_DRAWER_PX,
    );
  });

  test("clamps a bottom drag past the plan's minimum", () => {
    expect(drawerSizeFromPointer("bottom", { clientX: 600, clientY: 10 }, outer, 800)).toBe(
      800 - MIN_PLAN_PX,
    );
  });

  test("clamps a bottom drag dragged past the drawer's own minimum", () => {
    expect(drawerSizeFromPointer("bottom", { clientX: 600, clientY: 799 }, outer, 800)).toBe(
      MIN_DRAWER_PX,
    );
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

  test("returns null on an unparseable stored value", () => {
    localStorage.setItem(FILE_DRAWER_WIDTH_KEY, "wide");
    expect(readDrawerSize("right")).toBeNull();
  });

  test("returns null on a non-finite or non-positive stored value", () => {
    localStorage.setItem(FILE_DRAWER_WIDTH_KEY, "0");
    expect(readDrawerSize("right")).toBeNull();
    localStorage.setItem(FILE_DRAWER_WIDTH_KEY, "-200");
    expect(readDrawerSize("right")).toBeNull();
    localStorage.setItem(FILE_DRAWER_WIDTH_KEY, "Infinity");
    expect(readDrawerSize("right")).toBeNull();
  });

  test("fails safe to null when localStorage throws", () => {
    withBlockedStorage(() => {
      expect(readDrawerSize("right")).toBeNull();
    });
  });

  test("swallows a localStorage write failure", () => {
    withBlockedStorage(() => {
      expect(() => writeDrawerSize("right", 420)).not.toThrow();
    });
  });
});

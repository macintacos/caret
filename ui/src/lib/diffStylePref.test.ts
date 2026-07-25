import "@ui/test-setup.ts";
import { afterEach, describe, expect, test } from "bun:test";

import { DIFF_STYLE_KEY, readDiffStyle, writeDiffStyle } from "$lib/diffStylePref.ts";

afterEach(() => localStorage.clear());

describe("readDiffStyle", () => {
  test("returns the stored value when valid", () => {
    localStorage.setItem(DIFF_STYLE_KEY, "unified");
    expect(readDiffStyle()).toBe("unified");
  });

  test("defaults to split when nothing is stored", () => {
    expect(readDiffStyle()).toBe("split");
  });

  test("defaults to split on an unrecognized stored value", () => {
    localStorage.setItem(DIFF_STYLE_KEY, "sideways");
    expect(readDiffStyle()).toBe("split");
  });

  test("fails safe to split when localStorage throws", () => {
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    try {
      expect(readDiffStyle()).toBe("split");
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: original,
      });
    }
  });
});

describe("writeDiffStyle", () => {
  test("persists a valid value", () => {
    writeDiffStyle("unified");
    expect(localStorage.getItem(DIFF_STYLE_KEY)).toBe("unified");
    expect(readDiffStyle()).toBe("unified");
  });

  test("swallows a localStorage write failure", () => {
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    try {
      expect(() => writeDiffStyle("unified")).not.toThrow();
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: original,
      });
    }
  });
});

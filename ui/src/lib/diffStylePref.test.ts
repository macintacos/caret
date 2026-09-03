import "@ui/test-setup.ts";
import { afterEach, describe, expect, test } from "bun:test";

import { withBlockedStorage } from "@ui/test-storage.ts";
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
    withBlockedStorage(() => {
      expect(readDiffStyle()).toBe("split");
    });
  });
});

describe("writeDiffStyle", () => {
  test("persists a valid value", () => {
    writeDiffStyle("unified");
    expect(localStorage.getItem(DIFF_STYLE_KEY)).toBe("unified");
    expect(readDiffStyle()).toBe("unified");
  });

  test("swallows a localStorage write failure", () => {
    withBlockedStorage(() => {
      expect(() => writeDiffStyle("unified")).not.toThrow();
    });
  });
});

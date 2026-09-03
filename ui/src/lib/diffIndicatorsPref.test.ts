import "@ui/support/setup.ts";
import { afterEach, describe, expect, test } from "bun:test";

import { withBlockedStorage } from "@ui/support/storage.ts";
import {
  DIFF_INDICATORS_KEY,
  readDiffIndicators,
  writeDiffIndicators,
} from "$lib/diffIndicatorsPref.ts";

afterEach(() => localStorage.clear());

describe("readDiffIndicators", () => {
  test("returns the stored value when valid", () => {
    localStorage.setItem(DIFF_INDICATORS_KEY, "classic");
    expect(readDiffIndicators()).toBe("classic");
  });

  test("defaults to bars when nothing is stored", () => {
    expect(readDiffIndicators()).toBe("bars");
  });

  test("defaults to bars on an unrecognized stored value", () => {
    localStorage.setItem(DIFF_INDICATORS_KEY, "dashes");
    expect(readDiffIndicators()).toBe("bars");
  });

  test('returns the stored "both" value', () => {
    localStorage.setItem(DIFF_INDICATORS_KEY, "both");
    expect(readDiffIndicators()).toBe("both");
  });

  test("fails safe to bars when localStorage throws", () => {
    withBlockedStorage(() => {
      expect(readDiffIndicators()).toBe("bars");
    });
  });
});

describe("writeDiffIndicators", () => {
  test("persists a valid value", () => {
    writeDiffIndicators("classic");
    expect(localStorage.getItem(DIFF_INDICATORS_KEY)).toBe("classic");
    expect(readDiffIndicators()).toBe("classic");
  });

  test("swallows a localStorage write failure", () => {
    withBlockedStorage(() => {
      expect(() => writeDiffIndicators("classic")).not.toThrow();
    });
  });
});

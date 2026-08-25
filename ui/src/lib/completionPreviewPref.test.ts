import "@ui/test-setup.ts";
import { afterEach, describe, expect, test } from "bun:test";

import {
  COMPLETION_PREVIEW_KEY,
  readCompletionPreview,
  writeCompletionPreview,
} from "$lib/completionPreviewPref.ts";

afterEach(() => localStorage.clear());

describe("readCompletionPreview", () => {
  test("defaults to false when nothing is stored", () => {
    // Opposite of the shortcut-hint default, and deliberately: a hint is
    // discoverability, an accessory panel is a mode the reviewer chose.
    expect(readCompletionPreview()).toBe(false);
  });

  test('returns true for the stored "on" value', () => {
    localStorage.setItem(COMPLETION_PREVIEW_KEY, "on");
    expect(readCompletionPreview()).toBe(true);
  });

  test('returns false for the stored "off" value', () => {
    localStorage.setItem(COMPLETION_PREVIEW_KEY, "off");
    expect(readCompletionPreview()).toBe(false);
  });

  test("defaults to false on an unrecognized stored value", () => {
    localStorage.setItem(COMPLETION_PREVIEW_KEY, "maybe");
    expect(readCompletionPreview()).toBe(false);
  });

  test("fails safe to false when localStorage throws", () => {
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    try {
      expect(readCompletionPreview()).toBe(false);
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: original,
      });
    }
  });
});

describe("writeCompletionPreview", () => {
  test("persists true as on and round-trips", () => {
    writeCompletionPreview(true);
    expect(localStorage.getItem(COMPLETION_PREVIEW_KEY)).toBe("on");
    expect(readCompletionPreview()).toBe(true);
  });

  test("persists false as off and round-trips", () => {
    localStorage.setItem(COMPLETION_PREVIEW_KEY, "on");
    writeCompletionPreview(false);
    expect(localStorage.getItem(COMPLETION_PREVIEW_KEY)).toBe("off");
    expect(readCompletionPreview()).toBe(false);
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
      expect(() => writeCompletionPreview(true)).not.toThrow();
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: original,
      });
    }
  });
});

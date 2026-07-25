import "@ui/test-setup.ts";
import { afterEach, describe, expect, test } from "bun:test";

import {
  readShortcutHints,
  SHORTCUT_HINTS_KEY,
  writeShortcutHints,
} from "$lib/shortcutHintsPref.ts";

afterEach(() => localStorage.clear());

describe("readShortcutHints", () => {
  test("defaults to true when nothing is stored", () => {
    expect(readShortcutHints()).toBe(true);
  });

  test('returns true for the stored "on" value', () => {
    localStorage.setItem(SHORTCUT_HINTS_KEY, "on");
    expect(readShortcutHints()).toBe(true);
  });

  test('returns false for the stored "off" value', () => {
    localStorage.setItem(SHORTCUT_HINTS_KEY, "off");
    expect(readShortcutHints()).toBe(false);
  });

  test("defaults to true on an unrecognized stored value", () => {
    localStorage.setItem(SHORTCUT_HINTS_KEY, "maybe");
    expect(readShortcutHints()).toBe(true);
  });

  test("fails safe to true when localStorage throws", () => {
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    try {
      expect(readShortcutHints()).toBe(true);
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: original,
      });
    }
  });
});

describe("writeShortcutHints", () => {
  test("persists false as off and round-trips", () => {
    writeShortcutHints(false);
    expect(localStorage.getItem(SHORTCUT_HINTS_KEY)).toBe("off");
    expect(readShortcutHints()).toBe(false);
  });

  test("persists true as on and round-trips", () => {
    localStorage.setItem(SHORTCUT_HINTS_KEY, "off");
    writeShortcutHints(true);
    expect(localStorage.getItem(SHORTCUT_HINTS_KEY)).toBe("on");
    expect(readShortcutHints()).toBe(true);
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
      expect(() => writeShortcutHints(false)).not.toThrow();
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: original,
      });
    }
  });
});

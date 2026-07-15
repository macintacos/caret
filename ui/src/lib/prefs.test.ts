import "../../test-setup.ts";
import { afterEach, describe, expect, test } from "bun:test";
import { DIFF_INDICATORS_KEY } from "./diffIndicatorsPref.ts";
import { DIFF_STYLE_KEY } from "./diffStylePref.ts";
import {
  clearKnownPrefs,
  hasOnboarded,
  KNOWN_PREF_KEYS,
  markOnboarded,
  ONBOARDED_KEY,
  shouldShowOnboarding,
} from "./prefs.ts";
import { THEME_KEY } from "./theme.ts";

afterEach(() => localStorage.clear());

describe("KNOWN_PREF_KEYS", () => {
  test("covers every user-facing UI setting key", () => {
    expect(KNOWN_PREF_KEYS).toContain(THEME_KEY);
    expect(KNOWN_PREF_KEYS).toContain(DIFF_INDICATORS_KEY);
    expect(KNOWN_PREF_KEYS).toContain(DIFF_STYLE_KEY);
    expect(KNOWN_PREF_KEYS).toContain(ONBOARDED_KEY);
  });
});

describe("hasOnboarded / markOnboarded", () => {
  test("false until onboarding is marked, true after", () => {
    expect(hasOnboarded()).toBe(false);
    markOnboarded();
    expect(hasOnboarded()).toBe(true);
  });

  test("hasOnboarded fails safe to false when localStorage throws", () => {
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    try {
      expect(hasOnboarded()).toBe(false);
    } finally {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: original });
    }
  });

  test("markOnboarded swallows a storage failure", () => {
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    try {
      expect(() => markOnboarded()).not.toThrow();
    } finally {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: original });
    }
  });
});

describe("clearKnownPrefs", () => {
  test("removes every known preference", () => {
    localStorage.setItem(THEME_KEY, "caret-light");
    localStorage.setItem(DIFF_INDICATORS_KEY, "dashes");
    localStorage.setItem(DIFF_STYLE_KEY, "unified");
    markOnboarded();

    clearKnownPrefs();

    for (const key of KNOWN_PREF_KEYS) {
      expect(localStorage.getItem(key)).toBeNull();
    }
  });

  test("swallows a storage failure", () => {
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    try {
      expect(() => clearKnownPrefs()).not.toThrow();
    } finally {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: original });
    }
  });
});

describe("shouldShowOnboarding", () => {
  test("shows only for an undecided permission on a first-ever run", () => {
    expect(shouldShowOnboarding("default")).toBe(true);
  });

  test("never shows once the user has a decided permission", () => {
    expect(shouldShowOnboarding("granted")).toBe(false);
    expect(shouldShowOnboarding("denied")).toBe(false);
  });

  test("never shows again once onboarding is marked", () => {
    markOnboarded();
    expect(shouldShowOnboarding("default")).toBe(false);
  });
});

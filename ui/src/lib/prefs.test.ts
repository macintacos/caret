import "@ui/support/setup.ts";
import { afterEach, describe, expect, test } from "bun:test";

import { withBlockedStorage } from "@ui/support/storage.ts";
import { DARK_SLOT_KEY, LEGACY_THEME_KEY, LIGHT_SLOT_KEY, MODE_KEY } from "$lib/appearance.ts";
import { knownPrefKeys } from "$lib/definePref.ts";
import { DIFF_INDICATORS_KEY } from "$lib/diffIndicatorsPref.ts";
import { DIFF_STYLE_KEY } from "$lib/diffStylePref.ts";
import {
  clearKnownPrefs,
  freshResetApplied,
  hasOnboarded,
  markFreshResetApplied,
  markOnboarded,
  ONBOARDED_KEY,
  shouldShowOnboarding,
} from "$lib/prefs.ts";
import { SHORTCUT_HINTS_KEY } from "$lib/shortcutHintsPref.ts";

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("knownPrefKeys()", () => {
  test("covers every user-facing UI setting key", () => {
    expect(knownPrefKeys()).toContain(MODE_KEY);
    expect(knownPrefKeys()).toContain(LIGHT_SLOT_KEY);
    expect(knownPrefKeys()).toContain(DARK_SLOT_KEY);
    expect(knownPrefKeys()).toContain(DIFF_INDICATORS_KEY);
    expect(knownPrefKeys()).toContain(DIFF_STYLE_KEY);
    expect(knownPrefKeys()).toContain(ONBOARDED_KEY);
    expect(knownPrefKeys()).toContain(SHORTCUT_HINTS_KEY);
  });
});

describe("hasOnboarded / markOnboarded", () => {
  test("false until onboarding is marked, true after", () => {
    expect(hasOnboarded()).toBe(false);
    markOnboarded();
    expect(hasOnboarded()).toBe(true);
  });

  test("hasOnboarded fails safe to false when localStorage throws", () => {
    withBlockedStorage(() => {
      expect(hasOnboarded()).toBe(false);
    });
  });

  test("markOnboarded swallows a storage failure", () => {
    withBlockedStorage(() => {
      expect(() => markOnboarded()).not.toThrow();
    });
  });
});

describe("clearKnownPrefs", () => {
  test("removes every known preference", () => {
    localStorage.setItem(MODE_KEY, "dark");
    localStorage.setItem(LIGHT_SLOT_KEY, "caret-light");
    // The pre-mode key still joins the reset set, so a `--fresh` boot clears it
    // for anyone who hasn't been migrated off it yet.
    localStorage.setItem(LEGACY_THEME_KEY, "caret-light");
    localStorage.setItem(DIFF_INDICATORS_KEY, "dashes");
    localStorage.setItem(DIFF_STYLE_KEY, "unified");
    markOnboarded();

    clearKnownPrefs();

    for (const key of knownPrefKeys()) {
      expect(localStorage.getItem(key)).toBeNull();
    }
  });

  test("swallows a storage failure", () => {
    withBlockedStorage(() => {
      expect(() => clearKnownPrefs()).not.toThrow();
    });
  });
});

describe("freshResetApplied / markFreshResetApplied", () => {
  test("false until marked for a boot, true after — so --fresh resets once per boot", () => {
    expect(freshResetApplied("boot-a")).toBe(false);
    markFreshResetApplied("boot-a");
    expect(freshResetApplied("boot-a")).toBe(true);
  });

  test("a different daemon instanceId reads as not-applied, so a new --fresh boot resets again", () => {
    markFreshResetApplied("boot-a");
    expect(freshResetApplied("boot-b")).toBe(false);
  });

  test("fails safe to not-applied when sessionStorage throws (the reset still runs)", () => {
    const original = globalThis.sessionStorage;
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    try {
      expect(freshResetApplied("boot-a")).toBe(false);
      expect(() => markFreshResetApplied("boot-a")).not.toThrow();
    } finally {
      Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: original });
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

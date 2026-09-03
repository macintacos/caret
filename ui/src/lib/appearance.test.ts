import "@ui/support/setup.ts";
import { afterEach, describe, expect, test } from "bun:test";

import { fakeMediaQuery } from "@ui/support/media-query.ts";
import { withBlockedStorage } from "@ui/support/storage.ts";
import {
  appearanceSummary,
  DARK_SLOT_KEY,
  DEFAULT_MODE,
  DEFAULT_SLOT_THEME,
  LEGACY_THEME_KEY,
  LIGHT_SLOT_KEY,
  MODE_KEY,
  migrateLegacyTheme,
  readSlotTheme,
  readThemeMode,
  resolveScheme,
  resolveThemeId,
  THEME_MODES,
  type ThemeMode,
  watchSystemScheme,
  writeSlotTheme,
  writeThemeMode,
} from "$lib/appearance.ts";
import { THEMES } from "$lib/theme.ts";

afterEach(() => localStorage.clear());

const SLOTS = { light: "caret-light", dark: "caret-dark" } as const;

describe("the mode vocabulary", () => {
  test("offers exactly light, dark, and system, defaulting to system", () => {
    expect(THEME_MODES).toEqual(["light", "dark", "system"]);
    expect(DEFAULT_MODE).toBe("system");
  });

  test("each slot defaults to the caret palette of its own scheme", () => {
    expect(DEFAULT_SLOT_THEME.light).toBe("caret-light");
    expect(DEFAULT_SLOT_THEME.dark).toBe("caret-dark");
    expect(THEMES[DEFAULT_SLOT_THEME.light].scheme).toBe("light");
    expect(THEMES[DEFAULT_SLOT_THEME.dark].scheme).toBe("dark");
  });
});

describe("resolveScheme", () => {
  test("a manual mode ignores the system preference entirely", () => {
    expect(resolveScheme("light", true)).toBe("light");
    expect(resolveScheme("light", false)).toBe("light");
    expect(resolveScheme("dark", true)).toBe("dark");
    expect(resolveScheme("dark", false)).toBe("dark");
  });

  test("system follows the OS preference", () => {
    expect(resolveScheme("system", true)).toBe("dark");
    expect(resolveScheme("system", false)).toBe("light");
  });
});

describe("resolveThemeId", () => {
  test("picks the slot matching the resolved scheme", () => {
    expect(resolveThemeId("light", SLOTS, true)).toBe("caret-light");
    expect(resolveThemeId("dark", SLOTS, false)).toBe("caret-dark");
    expect(resolveThemeId("system", SLOTS, true)).toBe("caret-dark");
    expect(resolveThemeId("system", SLOTS, false)).toBe("caret-light");
  });
});

describe("appearanceSummary", () => {
  test("the system phrasing names the system, the live scheme, and the theme", () => {
    const copy = appearanceSummary("system", "dark", "caret dark");
    expect(copy).toContain("system");
    expect(copy).toContain("dark");
    expect(copy).toContain("caret dark");
  });

  test("a manual phrasing never claims to be following the system", () => {
    const copy = appearanceSummary("dark", "dark", "caret dark");
    expect(copy).not.toContain("system");
    expect(copy).toContain("dark");
    expect(copy).toContain("caret dark");
  });
});

describe("readThemeMode / writeThemeMode", () => {
  test("defaults to system when nothing is stored", () => {
    expect(readThemeMode()).toBe("system");
  });

  test("round-trips every mode through its own localStorage key", () => {
    for (const mode of THEME_MODES) {
      writeThemeMode(mode);
      expect(localStorage.getItem(MODE_KEY)).toBe(mode);
      expect(readThemeMode()).toBe(mode);
    }
  });

  test("falls back to system on an unrecognized stored value", () => {
    localStorage.setItem(MODE_KEY, "auto");
    expect(readThemeMode()).toBe("system");
  });
});

describe("readSlotTheme / writeSlotTheme", () => {
  test("each slot defaults to its scheme's caret palette", () => {
    expect(readSlotTheme("light")).toBe("caret-light");
    expect(readSlotTheme("dark")).toBe("caret-dark");
  });

  test("round-trips through the slot's own key, leaving the other slot alone", () => {
    writeSlotTheme("light", "caret-light");
    expect(localStorage.getItem(LIGHT_SLOT_KEY)).toBe("caret-light");
    expect(localStorage.getItem(DARK_SLOT_KEY)).toBeNull();
  });

  // The slot's allow-list is its own scheme's ids, so a hand-edited wrong-scheme
  // value can't make the light slot paint a dark palette (which would contradict
  // the IN USE marker and the data-theme attribute).
  test("a stored wrong-scheme theme degrades to the slot's default", () => {
    localStorage.setItem(LIGHT_SLOT_KEY, "caret-dark");
    expect(readSlotTheme("light")).toBe("caret-light");

    localStorage.setItem(DARK_SLOT_KEY, "caret-light");
    expect(readSlotTheme("dark")).toBe("caret-dark");
  });
});

describe("watchSystemScheme", () => {
  test("reports the new preference on an OS flip", () => {
    const seen: boolean[] = [];
    const media = fakeMediaQuery(false);
    watchSystemScheme((prefersDark) => seen.push(prefersDark), media.mql);
    media.flip(true);
    media.flip(false);
    expect(seen).toEqual([true, false]);
  });

  test("the returned disposer detaches the listener", () => {
    const seen: boolean[] = [];
    const media = fakeMediaQuery(false);
    const stop = watchSystemScheme((prefersDark) => seen.push(prefersDark), media.mql);
    stop();
    expect(media.listenerCount()).toBe(0);
    media.flip(true);
    expect(seen).toEqual([]);
  });

  test("degrades to a no-op disposer when no media query is available", () => {
    const stop = watchSystemScheme(() => {}, undefined);
    expect(() => stop()).not.toThrow();
  });
});

describe("migrateLegacyTheme", () => {
  test("adopts a stored single-theme pick as an explicit mode plus its slot", () => {
    localStorage.setItem(LEGACY_THEME_KEY, "caret-light");
    migrateLegacyTheme();
    expect(readThemeMode()).toBe("light");
    expect(readSlotTheme("light")).toBe("caret-light");
    // Self-erasing: the legacy key is gone, so the migration never re-runs.
    expect(localStorage.getItem(LEGACY_THEME_KEY)).toBeNull();
  });

  test("adopts a stored dark pick the same way", () => {
    localStorage.setItem(LEGACY_THEME_KEY, "caret-dark");
    migrateLegacyTheme();
    expect(readThemeMode()).toBe("dark");
    expect(readSlotTheme("dark")).toBe("caret-dark");
  });

  test("leaves an already-migrated user alone", () => {
    writeThemeMode("system");
    localStorage.setItem(LEGACY_THEME_KEY, "caret-light");
    migrateLegacyTheme();
    expect(readThemeMode()).toBe("system");
  });

  test("a brand-new user with no legacy key keeps the system default", () => {
    migrateLegacyTheme();
    expect(localStorage.getItem(MODE_KEY)).toBeNull();
    expect(readThemeMode()).toBe("system");
  });

  test("drops an unrecognized legacy value instead of adopting it", () => {
    localStorage.setItem(LEGACY_THEME_KEY, "midnight");
    migrateLegacyTheme();
    expect(readThemeMode()).toBe("system");
    expect(localStorage.getItem(LEGACY_THEME_KEY)).toBeNull();
  });

  test("swallows a storage failure rather than breaking boot", () => {
    withBlockedStorage(() => {
      expect(() => migrateLegacyTheme()).not.toThrow();
    });
  });
});

describe("every mode is a valid ThemeMode", () => {
  test("THEME_MODES is assignable to the ThemeMode union", () => {
    const modes: readonly ThemeMode[] = THEME_MODES;
    expect(modes.length).toBe(3);
  });
});

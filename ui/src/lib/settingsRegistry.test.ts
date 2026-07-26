import "@ui/test-setup.ts";
import { afterEach, describe, expect, test } from "bun:test";

import { THEME_MODES } from "$lib/appearance.ts";
import { knownPrefKeys } from "$lib/definePref.ts";
import {
  filterSettings,
  isStagedField,
  SETTINGS_CATEGORIES,
  SETTINGS_REGISTRY,
  type SearchOnlyEntry,
  type StagedField,
  stagedField,
  THEME_FIELD,
  THEME_SECTION,
} from "$lib/settingsRegistry.ts";
import { THEME_IDS, THEMES, type ThemeId } from "$lib/theme.ts";

afterEach(() => localStorage.clear());

/** Every localStorage key currently set (happy-dom's Storage is not a plain object). */
function storedKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k) keys.push(k);
  }
  return keys;
}

/** A representative non-default value for a field, derived from its control. */
function sampleValue(field: StagedField): unknown {
  if (field.control.kind === "select" || field.control.kind === "segmented") {
    const opts = field.control.options;
    return opts[opts.length - 1]?.value;
  }
  return true;
}

const staged = SETTINGS_REGISTRY.filter(isStagedField);

describe("SETTINGS_REGISTRY", () => {
  test("every entry carries a non-empty key, category, label, and description", () => {
    for (const entry of SETTINGS_REGISTRY) {
      expect(entry.key).toBeTruthy();
      expect(entry.category).toBeTruthy();
      expect(entry.label).toBeTruthy();
      expect(entry.description).toBeTruthy();
    }
  });

  test("keys are unique across the registry", () => {
    const keys = SETTINGS_REGISTRY.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("covers the appearance trio, shortcut hints, and both diff prefs as staged fields", () => {
    const keys = staged.map((f) => f.key);
    expect(keys).toContain(THEME_FIELD.mode);
    expect(keys).toContain(THEME_FIELD.light);
    expect(keys).toContain(THEME_FIELD.dark);
    expect(keys).toContain("shortcutHints");
    expect(keys).toContain("diffStyle");
    expect(keys).toContain("diffIndicators");
  });
});

describe("SETTINGS_CATEGORIES (the two-pane sidebar taxonomy)", () => {
  test("Appearance groups every staged field (Diff view folded in as a section)", () => {
    const appearance = staged.filter((f) => f.category === "Appearance").map((f) => f.key);
    expect(appearance).toContain(THEME_FIELD.mode);
    expect(appearance).toContain(THEME_FIELD.light);
    expect(appearance).toContain(THEME_FIELD.dark);
    expect(appearance).toContain("shortcutHints");
    expect(appearance).toContain("diffStyle");
    expect(appearance).toContain("diffIndicators");
  });

  test("the diff prefs share the 'Diff view' section; the general fields carry none", () => {
    const byKey = (k: string) => staged.find((f) => f.key === k);
    expect(byKey("diffStyle")?.section).toBe("Diff view");
    expect(byKey("diffIndicators")?.section).toBe("Diff view");
    expect(byKey("shortcutHints")?.section).toBeUndefined();
  });

  // The three appearance fields render as one composite block, so they must share
  // the section the shell branches on — and lead the pane, since the mock puts the
  // theme controls directly under the Appearance header.
  test("the appearance trio shares the Theme section and leads the registry", () => {
    const themeKeys: string[] = [THEME_FIELD.mode, THEME_FIELD.light, THEME_FIELD.dark];
    for (const key of themeKeys) {
      expect(staged.find((f) => f.key === key)?.section, key).toBe(THEME_SECTION);
    }
    expect(staged.slice(0, 3).map((f) => f.key)).toEqual(themeKeys);
  });

  test("every registry category is a SETTINGS_CATEGORIES entry with a blurb", () => {
    const ids = new Set(SETTINGS_CATEGORIES.map((c) => c.id));
    for (const entry of SETTINGS_REGISTRY) {
      expect(ids).toContain(entry.category);
    }
    for (const cat of SETTINGS_CATEGORIES) {
      expect(cat.blurb).toBeTruthy();
    }
  });

  test("leads with Appearance", () => {
    expect(SETTINGS_CATEGORIES[0]?.id).toBe("Appearance");
  });
});

describe("Notifications (search-only live pane, EXC-847)", () => {
  test("Notifications is a sidebar category with a blurb", () => {
    const cat = SETTINGS_CATEGORIES.find((c) => c.id === "Notifications");
    expect(cat).toBeDefined();
    expect(cat?.blurb).toBeTruthy();
  });

  test("contributes a search-only entry (findable by /-search, never staged)", () => {
    const entry = SETTINGS_REGISTRY.find((e) => e.category === "Notifications");
    expect(entry).toBeDefined();
    // Live, browser-owned state — searchable but never an editable field.
    expect(entry ? isStagedField(entry) : true).toBe(false);
    expect(entry?.label).toBeTruthy();
    expect(entry?.description).toBeTruthy();
  });
});

describe("Advanced (search-only diagnostics pane, EXC-848)", () => {
  test("Advanced is a sidebar category with a blurb, ordered last", () => {
    const cat = SETTINGS_CATEGORIES.find((c) => c.id === "Advanced");
    expect(cat).toBeDefined();
    expect(cat?.blurb).toBeTruthy();
    expect(SETTINGS_CATEGORIES[SETTINGS_CATEGORIES.length - 1]?.id).toBe("Advanced");
  });

  test("contributes only search-only entries — read-only diagnostics, never a field", () => {
    const entries = SETTINGS_REGISTRY.filter((e) => e.category === "Advanced");
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) expect(isStagedField(e)).toBe(false);
  });

  test("surfaces the four diagnostics blocks by label (findable in /-search)", () => {
    const labels = SETTINGS_REGISTRY.filter((e) => e.category === "Advanced").map((e) => e.label);
    expect(labels).toEqual(
      expect.arrayContaining(["Version", "Daemon status", "System", "Config"]),
    );
  });
});

describe("staged fields wrap existing pref modules", () => {
  test("write persists and read reflects it (round-trips through the pref module)", () => {
    for (const field of staged) {
      const value = sampleValue(field);
      field.write(value);
      expect(field.read()).toEqual(value);
    }
  });

  test("write only ever touches a key already registered in knownPrefKeys() — no new keys", () => {
    for (const field of staged) {
      localStorage.clear();
      field.write(sampleValue(field));
      for (const key of storedKeys()) {
        expect(knownPrefKeys()).toContain(key);
      }
    }
  });
});

/** A theme slot's options, narrowed to the select control the shell renders. */
function slotOptionsOf(key: string) {
  const field = staged.find((f) => f.key === key);
  expect(field?.control.kind, key).toBe("select");
  return field?.control.kind === "select" ? field.control.options : [];
}

describe("each theme slot offers only its own scheme's palettes (EXC-773)", () => {
  test("the light slot lists light themes, the dark slot dark ones", () => {
    for (const opt of slotOptionsOf(THEME_FIELD.light)) {
      expect(THEMES[opt.value as keyof typeof THEMES].scheme, opt.value).toBe("light");
    }
    for (const opt of slotOptionsOf(THEME_FIELD.dark)) {
      expect(THEMES[opt.value as keyof typeof THEMES].scheme, opt.value).toBe("dark");
    }
  });

  test("neither slot is empty — an empty picker would be a dead control", () => {
    expect(slotOptionsOf(THEME_FIELD.light).length).toBeGreaterThan(0);
    expect(slotOptionsOf(THEME_FIELD.dark).length).toBeGreaterThan(0);
  });
});

describe("the mode control is segmented over the three modes, each with a glyph", () => {
  test("its options mirror THEME_MODES and every one carries an icon", () => {
    const mode = staged.find((f) => f.key === THEME_FIELD.mode);
    expect(mode?.control.kind).toBe("segmented");
    if (mode?.control.kind !== "segmented") return;
    expect(mode.control.options.map((o) => o.value)).toEqual([...THEME_MODES]);
    for (const opt of mode.control.options) {
      expect(opt.icon, opt.value).toBeTruthy();
      expect(opt.label, opt.value).toBeTruthy();
    }
  });

  test("the mode options carry no palette chrome — they pick WHEN, not WHICH", () => {
    const mode = staged.find((f) => f.key === THEME_FIELD.mode);
    if (mode?.control.kind !== "segmented") return;
    for (const opt of mode.control.options) {
      expect(opt.swatch).toBeUndefined();
      expect(opt.preview).toBeUndefined();
    }
  });
});

describe("theme options carry palette swatches", () => {
  test("each theme option has a 5-color swatch; other selects carry none", () => {
    for (const key of [THEME_FIELD.light, THEME_FIELD.dark]) {
      for (const opt of slotOptionsOf(key)) {
        expect(opt.swatch?.length).toBe(5);
        for (const color of opt.swatch ?? []) expect(color).toMatch(/^#[0-9a-fA-F]{3,8}$/);
      }
    }
    const layout = staged.find((f) => f.key === "diffStyle");
    if (layout?.control.kind === "select") {
      for (const opt of layout.control.options) expect(opt.swatch).toBeUndefined();
    }
  });
});

describe("theme options carry a palette preview (EXC-753)", () => {
  test("each theme option previews its own theme; other selects carry none", () => {
    for (const key of [THEME_FIELD.light, THEME_FIELD.dark]) {
      for (const opt of slotOptionsOf(key)) {
        // The preview is the option's own theme id — the card paints from the registry
        // (EXC-884), so the option carries the key, not a copy of the palette.
        expect(opt.preview).toBe(opt.value as ThemeId);
        expect(THEME_IDS).toContain(opt.preview!);
      }
    }
    const layout = staged.find((f) => f.key === "diffStyle");
    if (layout?.control.kind === "select") {
      for (const opt of layout.control.options) expect(opt.preview).toBeUndefined();
    }
  });
});

describe("isStagedField / search-only entries", () => {
  test("isStagedField is true for staged fields and false for a search-only entry", () => {
    const search: SearchOnlyEntry = {
      kind: "search",
      key: "daemon-version",
      category: "Advanced",
      label: "Version",
      description: "The running daemon version.",
    };
    expect(isStagedField(search)).toBe(false);
    for (const field of staged) {
      expect(isStagedField(field)).toBe(true);
    }
  });

  test("a search-only entry is filtered out of the staged set", () => {
    const search: SearchOnlyEntry = {
      kind: "search",
      key: "daemon-version",
      category: "Advanced",
      label: "Version",
      description: "The running daemon version.",
    };
    expect([...SETTINGS_REGISTRY, search].filter(isStagedField)).not.toContain(search);
  });
});

describe("stagedField", () => {
  test("stamps kind 'staged' onto the definition", () => {
    const field = stagedField<boolean>({
      key: "x",
      category: "Test",
      label: "X",
      description: "d",
      control: { kind: "toggle" },
      read: () => false,
      write: () => {},
    });
    expect(field.kind).toBe("staged");
    expect(isStagedField(field)).toBe(true);
  });
});

describe("filterSettings (EXC-845 settings search)", () => {
  const keysOf = (entries: readonly { key: string }[]) => entries.map((e) => e.key);

  test("an empty query returns every entry", () => {
    expect(filterSettings(SETTINGS_REGISTRY, "")).toHaveLength(SETTINGS_REGISTRY.length);
  });

  test("a whitespace-only query returns every entry", () => {
    expect(filterSettings(SETTINGS_REGISTRY, "   ")).toHaveLength(SETTINGS_REGISTRY.length);
  });

  // Searching "theme" must keep the whole appearance block together — the mode
  // control is meaningless next to a lone slot row — which is why every one of the
  // three carries the word in its label or description.
  test("matches over an entry's label, keeping the appearance block whole", () => {
    expect(keysOf(filterSettings(SETTINGS_REGISTRY, "theme"))).toEqual([
      THEME_FIELD.mode,
      THEME_FIELD.light,
      THEME_FIELD.dark,
    ]);
  });

  test("matches over an entry's description", () => {
    // "palette" appears only in the two slot descriptions ("Color palette used …"),
    // never in their labels — so this matches on description alone.
    expect(keysOf(filterSettings(SETTINGS_REGISTRY, "palette"))).toEqual([
      THEME_FIELD.light,
      THEME_FIELD.dark,
    ]);
  });

  test("is case-insensitive", () => {
    expect(keysOf(filterSettings(SETTINGS_REGISTRY, "THEME"))).toEqual([
      THEME_FIELD.mode,
      THEME_FIELD.light,
      THEME_FIELD.dark,
    ]);
  });

  test("includes a search-only entry (live pane) the same as a staged field", () => {
    // "daemon" only matches the Advanced 'Daemon status' search-only entry.
    const matched = filterSettings(SETTINGS_REGISTRY, "daemon");
    expect(keysOf(matched)).toEqual(["advancedDaemon"]);
    expect(matched.every((e) => !isStagedField(e))).toBe(true);
  });

  test("a query that matches nothing returns an empty list", () => {
    expect(filterSettings(SETTINGS_REGISTRY, "zzz-no-such-setting")).toEqual([]);
  });
});

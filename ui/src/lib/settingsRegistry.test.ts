import "../../test-setup.ts";
import { afterEach, describe, expect, test } from "bun:test";

import { KNOWN_PREF_KEYS } from "$lib/prefs.ts";
import {
  isStagedField,
  SETTINGS_CATEGORIES,
  SETTINGS_REGISTRY,
  type SearchOnlyEntry,
  type StagedField,
  stagedField,
} from "$lib/settingsRegistry.ts";

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
  if (field.control.kind === "select") {
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

  test("covers theme, shortcut hints, and both diff prefs as staged fields", () => {
    const keys = staged.map((f) => f.key);
    expect(keys).toContain("theme");
    expect(keys).toContain("shortcutHints");
    expect(keys).toContain("diffStyle");
    expect(keys).toContain("diffIndicators");
  });
});

describe("SETTINGS_CATEGORIES (the two-pane sidebar taxonomy)", () => {
  test("Appearance groups every staged field (Diff view folded in as a section)", () => {
    const appearance = staged.filter((f) => f.category === "Appearance").map((f) => f.key);
    expect(appearance).toContain("theme");
    expect(appearance).toContain("shortcutHints");
    expect(appearance).toContain("diffStyle");
    expect(appearance).toContain("diffIndicators");
  });

  test("the diff prefs share the 'Diff view' section; the general fields carry none", () => {
    const byKey = (k: string) => staged.find((f) => f.key === k);
    expect(byKey("diffStyle")?.section).toBe("Diff view");
    expect(byKey("diffIndicators")?.section).toBe("Diff view");
    expect(byKey("theme")?.section).toBeUndefined();
    expect(byKey("shortcutHints")?.section).toBeUndefined();
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

  test("write only ever touches a key already in KNOWN_PREF_KEYS — no new keys", () => {
    for (const field of staged) {
      localStorage.clear();
      field.write(sampleValue(field));
      for (const key of storedKeys()) {
        expect(KNOWN_PREF_KEYS).toContain(key);
      }
    }
  });
});

describe("theme options carry palette swatches", () => {
  test("each theme option has a 5-color swatch; other selects carry none", () => {
    const theme = staged.find((f) => f.key === "theme");
    expect(theme?.control.kind).toBe("select");
    if (theme?.control.kind === "select") {
      for (const opt of theme.control.options) {
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

describe("theme options carry a full-palette preview (EXC-753)", () => {
  test("each theme option exposes a preview token map; other selects carry none", () => {
    const theme = staged.find((f) => f.key === "theme");
    expect(theme?.control.kind).toBe("select");
    if (theme?.control.kind === "select") {
      for (const opt of theme.control.options) {
        expect(opt.preview).toBeDefined();
        // The preview is the theme's full token map — at least the surfaces, ink, and
        // the accent the ThemePreviewCard paints from, as hex values.
        for (const token of ["--paper", "--paper-raised", "--ink", "--accent"]) {
          expect(opt.preview?.[token]).toMatch(/^#[0-9a-fA-F]{3,8}$/);
        }
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

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

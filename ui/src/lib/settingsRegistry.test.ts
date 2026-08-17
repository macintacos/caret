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
  settingLabelTarget,
  stagedField,
  THEME_FIELD,
  THEME_SECTION,
} from "$lib/settingsRegistry.ts";
import {
  DEFAULT_SOUND_VOLUME,
  readSoundVolume,
  SOUND_ENABLED_KEY,
  SOUND_VOLUME_KEY,
  writeSoundVolume,
} from "$lib/soundPref.ts";
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
  // A slider's value is a whole percent, not a flag. `true` would be REJECTED by the
  // volume pref's own guard rather than throwing — so the round-trip test below would
  // fail loudly, but the "touches no unregistered key" one would find nothing stored and
  // pass vacuously. 60 is off every default and on the control's own 5% ladder.
  if (field.control.kind === "slider") return 60;
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
  test("Appearance groups the appearance fields (Diff view folded in as a section)", () => {
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

describe("Sound (EXC-1100)", () => {
  test("Sound is a sidebar category with a blurb, sitting beside Notifications", () => {
    const ids = SETTINGS_CATEGORIES.map((c) => c.id);
    expect(SETTINGS_CATEGORIES.find((c) => c.id === "Sound")?.blurb).toBeTruthy();
    expect(ids.indexOf("Sound")).toBe(ids.indexOf("Notifications") - 1);
  });

  test("contributes the on/off toggle then the volume slider, in that order", () => {
    const fields = staged.filter((f) => f.category === "Sound");
    expect(fields.map((f) => f.control.kind)).toEqual(["toggle", "slider"]);
    // The off-switch reads first: there is no point setting a level for sound you
    // have turned off.
    expect(fields[0]?.read()).toBe(true);
  });

  test("the toggle writes through the sound preference's own key", () => {
    const field = staged.find((f) => f.category === "Sound");
    field?.write(false);
    expect(storedKeys()).toContain(SOUND_ENABLED_KEY);
    expect(field?.read()).toBe(false);
  });
});

// EXC-1101. The registry field speaks WHOLE PERCENTS and the pref module speaks a
// 0–1 multiplier; the field owns that conversion so the control can stay a dumb
// 0–100 slider and its ARIA can announce a number a listener can act on.
describe("Sound volume (EXC-1101)", () => {
  const volume = () => staged.find((f) => f.key === "soundVolume");

  test("is a slider whose resting value is the pref's default, as a percent", () => {
    expect(volume()?.control.kind).toBe("slider");
    expect(volume()?.read()).toBe(Math.round(DEFAULT_SOUND_VOLUME * 100));
  });

  test("reads the persisted multiplier as a percent", () => {
    writeSoundVolume(0.4);
    expect(volume()?.read()).toBe(40);
  });

  test("writes a percent back as a multiplier, through the volume key", () => {
    volume()?.write(60);
    expect(storedKeys()).toContain(SOUND_VOLUME_KEY);
    expect(readSoundVolume()).toBeCloseTo(0.6, 10);
    expect(volume()?.read()).toBe(60);
  });

  test("silence round-trips as silence, not as the default", () => {
    // 0 is falsy, so a `||` anywhere on this path would resurrect the default and
    // make the slider's left end unreachable.
    volume()?.write(0);
    expect(readSoundVolume()).toBe(0);
    expect(volume()?.read()).toBe(0);
  });

  test("reads back onto the control's 5% ladder, never between its steps", () => {
    // bits-ui rewrites an off-step slider value to the nearest step and sends it back
    // out through the binding as if the reviewer had moved it — so a value between
    // steps would write, toast and chime just from opening the pane. Snapping on read
    // means there is never an off-step value for it to correct.
    writeSoundVolume(0.37);
    expect(volume()?.read()).toBe(35);
    writeSoundVolume(0.58);
    expect(volume()?.read()).toBe(60);
    for (const stored of [0, 0.13, 0.25, 0.55, 0.99, 1]) {
      writeSoundVolume(stored);
      // The registry erases each field's value type, so read() is `unknown` here.
      expect(Number(volume()?.read() ?? -1) % 5, `stored ${stored}`).toBe(0);
    }
  });

  test("its row names the control through aria-labelledby, not <label for>", () => {
    // bits-ui's Slider root is a <span>, and `for` binds only to a labelable
    // element — the same reason the segmented control opts out.
    const field = volume();
    expect(field && settingLabelTarget(field)).toBeUndefined();
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

import "@ui/support/mount.ts";

import { afterEach, describe, expect, test } from "bun:test";

import { flushUntil, render } from "@ui/support/mount.ts";
import { closeSelect, openSelect, pointer } from "@ui/support/select.ts";
import { CUSTOM_ACCENT, CUSTOM_KEYWORD, customThemeFile } from "@ui/support/theme-file.ts";
import SettingControl from "@/components/SettingControl.svelte";
import SettingSelect from "@/components/SettingSelect.svelte";
import { appearance } from "@/state/appearance.svelte.ts";
import { DARK_SLOT_KEY, MODE_KEY } from "$lib/appearance.ts";
import { highlightExcerpt } from "$lib/diffview/highlight.ts";
import { caretDiffTheme } from "$lib/diffview/theme.ts";
import { registerTheme } from "$lib/registerTheme.ts";
import {
  SETTINGS_REGISTRY,
  type SettingOption,
  SWATCH_TOKENS,
  THEME_FIELD,
} from "$lib/settingsRegistry.ts";
import { THEMES, themeFor, themesForScheme } from "$lib/theme.ts";

afterEach(() => {
  localStorage.clear();
  appearance.boot();
  document.documentElement.removeAttribute("style");
  document.documentElement.removeAttribute("data-theme");
});

let seq = 0;
/** The runtime registry is module-global and refuses a repeat id. */
const uniqueId = () => `runtime-${++seq}`;

function slotOptionsOf(key: string): readonly SettingOption[] {
  const field = SETTINGS_REGISTRY.find((entry) => entry.key === key);
  if (field === undefined || !("control" in field) || field.control.kind !== "select") {
    throw new Error(`no select field ${key}`);
  }
  return field.control.options;
}

const rootToken = (name: string) => document.documentElement.style.getPropertyValue(name);

describe("a registered theme is selectable in its scheme's slot", () => {
  test("the dark slot offers it after the built-ins, with its swatch and preview", async () => {
    const file = await customThemeFile(uniqueId(), "dark");
    const builtins = slotOptionsOf(THEME_FIELD.dark).length;
    const lightBefore = slotOptionsOf(THEME_FIELD.light).map((o) => o.value);

    const id = registerTheme(file);

    const options = slotOptionsOf(THEME_FIELD.dark);
    expect(options.length).toBe(builtins + 1);
    expect(options[builtins]).toEqual({
      value: id,
      label: file.label,
      swatch: SWATCH_TOKENS.map((token) => file.tokens[token]),
      preview: id,
    });
    expect(slotOptionsOf(THEME_FIELD.light).map((o) => o.value)).toEqual(lightBefore);
  });

  test("the slot picker shows its row with five dots and previews it in its tokens", async () => {
    const id = uniqueId();
    const file = await customThemeFile(id, "dark");
    registerTheme(file);

    const card = () => document.body.querySelector<HTMLElement>("[data-slot='theme-preview']");

    const { flush } = render(SettingSelect, {
      value: "caret-dark",
      options: slotOptionsOf(THEME_FIELD.dark),
      onSelect: () => {},
      id: "setting-theme-dark",
    });
    flush();
    await openSelect(flush);

    const row = document.body.querySelector(`[data-setting-option='${id}']`);
    expect(row?.textContent?.trim()).toBe(file.label);
    expect(row?.querySelectorAll(".chip-dot").length).toBe(5);

    pointer(row, "pointermove");
    await flushUntil(flush, () => card()?.style.getPropertyValue("--accent") === CUSTOM_ACCENT);
    for (const [name, value] of Object.entries(file.tokens)) {
      expect(card()?.style.getPropertyValue(name), name).toBe(value);
    }

    await closeSelect(flush);
  });

  test("an open picker gains the row of a theme registered while it is open", async () => {
    const id = uniqueId();
    const file = await customThemeFile(id, "dark");
    const field = SETTINGS_REGISTRY.find((entry) => entry.key === THEME_FIELD.dark);
    if (field === undefined || !("control" in field)) throw new Error("no dark slot field");
    const rows = () => document.body.querySelectorAll("[data-setting-option]").length;

    const { flush } = render(SettingControl, { field, value: "caret-dark", onApply: () => {} });
    flush();
    await openSelect(flush);
    const before = rows();

    registerTheme(file);
    await flushUntil(flush, () => rows() === before + 1);

    expect(rows()).toBe(before + 1);
    expect(document.body.querySelector(`[data-setting-option='${id}']`) !== null).toBe(true);
    await closeSelect(flush);
  });
});

describe("a registered theme selected in its slot", () => {
  test("paints the root, names the diff theme, and highlights in its colors", async () => {
    const id = registerTheme(await customThemeFile(uniqueId(), "dark"));

    appearance.setMode("dark");
    appearance.setSlot("dark", id);

    expect(appearance.themeId).toBe(id);
    expect(rootToken("--accent")).toBe(CUSTOM_ACCENT);
    expect(caretDiffTheme(appearance.themeId)).toEqual({
      theme: { light: id, dark: id },
      themeType: "dark",
    });
    const html = await highlightExcerpt("const x = 1;", "ts", appearance.themeId);
    expect(html.toLowerCase()).toContain(CUSTOM_KEYWORD);
  });
});

describe("a slot saved before its theme registers", () => {
  test("shows the default until the theme arrives, then switches to it", async () => {
    const id = uniqueId();
    localStorage.setItem(MODE_KEY, "dark");
    localStorage.setItem(DARK_SLOT_KEY, id);

    appearance.boot();
    expect(appearance.themeId).toBe("caret-dark");
    expect(rootToken("--accent")).toBe(THEMES["caret-dark"].tokens["--accent"]);
    expect(localStorage.getItem(DARK_SLOT_KEY)).toBe(id);

    const registered = registerTheme(await customThemeFile(id, "dark"));

    expect(appearance.themeId).toBe(registered);
    expect(rootToken("--accent")).toBe(CUSTOM_ACCENT);
    expect(localStorage.getItem(DARK_SLOT_KEY)).toBe(id);
  });
});

describe("registering over a built-in id", () => {
  for (const taken of ["caret-dark", "dracula"] as const) {
    test(`${taken} is refused and the built-in stays in place`, async () => {
      localStorage.setItem(MODE_KEY, "dark");
      appearance.boot();
      const before = {
        theme: themeFor(taken),
        dark: themesForScheme("dark"),
        light: themesForScheme("light"),
        accent: rootToken("--accent"),
      };

      const file = await customThemeFile(taken, "dark");
      expect(() => registerTheme(file)).toThrow();

      expect(themeFor(taken)).toBe(before.theme);
      expect(themesForScheme("dark")).toEqual(before.dark);
      expect(themesForScheme("light")).toEqual(before.light);
      expect(rootToken("--accent")).toBe(before.accent);
    });
  }
});

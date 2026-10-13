import { describe, expect, test } from "bun:test";

import { customThemeFile } from "@ui/support/theme-file.ts";
import { caretDiffTheme, registerCaretDiffThemes, registerDiffTheme } from "$lib/diffview/theme.ts";
import { addTheme, type CustomThemeId, replaceTheme, THEME_IDS } from "$lib/theme.ts";

// The bridge selects caret's own Shiki themes for the diff view so its
// highlighting matches caret's code blocks exactly, and registers them into
// the library's highlighter exactly once.

describe("caretDiffTheme", () => {
  test("selects the live theme for both slots, at that theme's scheme", () => {
    // Both sides name the live palette on purpose: caret always forces the scheme
    // explicitly, and the library also emits dual-theme CSS variables, so naming
    // it twice makes the resolved palette independent of how the library resolves.
    expect(caretDiffTheme("dracula")).toEqual({
      theme: { light: "dracula", dark: "dracula" },
      themeType: "dark",
    });
    expect(caretDiffTheme("catppuccin-latte")).toEqual({
      theme: { light: "catppuccin-latte", dark: "catppuccin-latte" },
      themeType: "light",
    });
  });

  test("falls back to caret's pair following the system scheme when no theme is named", () => {
    expect(caretDiffTheme()).toEqual({
      theme: { light: "caret-light", dark: "caret-dark" },
      themeType: "system",
    });
  });
});

describe("registerCaretDiffThemes", () => {
  test("registers every caret theme under its own name", () => {
    const registered: string[] = [];
    registerCaretDiffThemes((name) => {
      registered.push(name);
    });

    expect(registered).toEqual(THEME_IDS);
  });

  test("registers each theme with a loader resolving to the named theme object", async () => {
    const loaders = new Map<string, () => Promise<unknown>>();
    registerCaretDiffThemes((name, load) => {
      loaders.set(name, load);
    });

    for (const id of THEME_IDS) {
      const loaded = (await loaders.get(id)?.()) as { name: string };
      // The library resolves a theme by the name it was registered under, so the
      // loaded object must carry that exact name.
      expect(loaded.name, id).toBe(id);
    }
  });

  // Pinned on Dracula's pink keyword, a hue neither caret theme file carries (EXC-896).
  test("loads a vendor palette's own theme, not caret's", async () => {
    const loaders = new Map<string, () => Promise<unknown>>();
    registerCaretDiffThemes((name, load) => {
      loaders.set(name, load);
    });

    const loaded = (await loaders.get("dracula")?.()) as {
      settings?: Array<{ settings?: { foreground?: string } }>;
    };
    const colors = (loaded.settings ?? []).map((rule) => rule.settings?.foreground?.toLowerCase());
    expect(colors).toContain("#ff79c6");
  });
});

describe("registerDiffTheme", () => {
  function captured(id: CustomThemeId): [string, () => Promise<unknown>][] {
    const calls: [string, () => Promise<unknown>][] = [];
    registerDiffTheme(id, (name, load) => {
      calls.push([name, load]);
    });
    return calls;
  }

  test("registers one runtime theme under its id, ending in caret's markdown rules", async () => {
    const id = addTheme(await customThemeFile("diff-runtime", "light"));
    const calls = captured(id);

    expect(calls.map(([name]) => name)).toEqual([id]);
    const loaded = (await calls[0]?.[1]()) as {
      name: string;
      settings: Array<{ scope?: string | string[] }>;
    };
    expect(loaded.name).toBe(id);
    expect(String(loaded.settings.at(-1)?.scope)).toContain("markdown");
    expect(caretDiffTheme(id)).toEqual({ theme: { light: id, dark: id }, themeType: "light" });
  });

  test("a replaced theme is selected and registered under its fresh name", async () => {
    const file = await customThemeFile("diff-replaced", "dark");
    const id = addTheme(file);
    replaceTheme(file);
    const { light, dark } = caretDiffTheme(id).theme;
    expect(light).not.toBe(id);
    expect(dark).toBe(light);

    const calls = captured(id);
    expect(calls.map(([name]) => name)).toEqual([light]);
    const loaded = (await calls[0]?.[1]()) as { name: string } | undefined;
    expect(loaded?.name).toBe(light);
  });
});

import { describe, expect, test } from "bun:test";

import { caretDiffTheme, registerCaretDiffThemes } from "$lib/diffview/theme.ts";
import { THEME_IDS } from "$lib/theme.ts";

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
});

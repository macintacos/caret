import "../../test-setup.ts";
import { afterEach, describe, expect, test } from "bun:test";
import {
  applyTheme,
  DEFAULT_THEME_ID,
  readThemeId,
  THEME_IDS,
  THEME_KEY,
  THEMES,
  type ThemeId,
} from "./theme.ts";

afterEach(() => {
  localStorage.clear();
  // Strip any inline vars/attrs a prior applyTheme wrote onto the root.
  document.documentElement.removeAttribute("style");
  document.documentElement.removeAttribute("data-theme");
});

// The color custom properties app.css declares in :root — the exhaustive set a
// theme must supply. Parsed from the first :root block so a token added to
// app.css without a matching THEMES entry (or vice versa) fails here.
const APP_CSS = new URL("../app.css", import.meta.url).pathname;

function readFirstRootTokens(css: string): Record<string, string> {
  const body = css.match(/:root\s*\{([^}]*)\}/)?.[1];
  if (body === undefined) throw new Error("app.css :root block not found");
  // Strip comments first so prose inside them can't be mistaken for a
  // declaration, then capture every `prop: value;` — custom properties and the
  // bare `color-scheme` alike (the :root block declares nothing else).
  const tokens: Record<string, string> = {};
  for (const decl of body.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([\w-]+)\s*:\s*([^;]+);/g)) {
    tokens[decl[1]!] = decl[2]!.trim();
  }
  return tokens;
}

describe("THEMES", () => {
  test("caret-dark is the default", () => {
    expect(DEFAULT_THEME_ID).toBe("caret-dark");
    expect(THEMES[DEFAULT_THEME_ID]).toBeDefined();
  });

  test("THEME_IDS lists caret-dark first (the default) then caret-light", () => {
    expect(THEME_IDS).toEqual(["caret-dark", "caret-light"]);
  });

  test("every theme carries a human label and a scheme matching its id", () => {
    expect(THEMES["caret-dark"].label).toBe("caret dark");
    expect(THEMES["caret-dark"].scheme).toBe("dark");
    expect(THEMES["caret-light"].label).toBe("caret light");
    expect(THEMES["caret-light"].scheme).toBe("light");
  });

  test("both themes define an identical token key set", () => {
    const dark = Object.keys(THEMES["caret-dark"].tokens).sort();
    const light = Object.keys(THEMES["caret-light"].tokens).sort();
    expect(light).toEqual(dark);
  });

  test("light and dark do not collapse to the same values", () => {
    expect(THEMES["caret-light"].tokens["--paper"]).not.toBe(
      THEMES["caret-dark"].tokens["--paper"],
    );
  });

  test("caret-dark mirrors the app.css :root fallback exactly", async () => {
    const root = readFirstRootTokens(await Bun.file(APP_CSS).text());
    for (const [name, value] of Object.entries(THEMES["caret-dark"].tokens)) {
      expect(root[name], `app.css :root ${name}`).toBe(value);
    }
    expect(root["color-scheme"]).toBe("dark");
  });
});

describe("readThemeId", () => {
  test("defaults to caret-dark when nothing is stored", () => {
    expect(readThemeId()).toBe("caret-dark");
  });

  test("returns a stored valid id", () => {
    localStorage.setItem(THEME_KEY, "caret-light");
    expect(readThemeId()).toBe("caret-light");
  });

  test("falls back to caret-dark on an unrecognized stored value", () => {
    localStorage.setItem(THEME_KEY, "midnight");
    expect(readThemeId()).toBe("caret-dark");
  });
});

describe("applyTheme", () => {
  test("writes every token as an inline custom property on the root", () => {
    applyTheme("caret-light");
    const style = document.documentElement.style;
    for (const [name, value] of Object.entries(THEMES["caret-light"].tokens)) {
      expect(style.getPropertyValue(name), name).toBe(value);
    }
  });

  test("sets color-scheme and data-theme to the theme's scheme", () => {
    applyTheme("caret-light");
    expect(document.documentElement.style.getPropertyValue("color-scheme")).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");

    applyTheme("caret-dark");
    expect(document.documentElement.style.getPropertyValue("color-scheme")).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  test("persists the applied id so the next readThemeId returns it", () => {
    applyTheme("caret-light");
    expect(readThemeId()).toBe("caret-light");
  });

  test("returns the applied theme object", () => {
    const applied: ThemeId = applyTheme("caret-light").id;
    expect(applied).toBe("caret-light");
  });
});

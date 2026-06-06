import { describe, expect, test } from "bun:test";
import { caretDark, caretLight } from "./caret-theme.ts";

// caret-theme.ts hand-duplicates the app.css paper/ink hex palette because shiki
// resolves token colors at highlight time and can't read CSS custom properties
// (EXC-370). That duplication is deliberate but unguarded, so this test parses
// the tokens straight out of app.css and asserts every color the theme emits
// matches its app.css source — a hand-edit to either copy that drifts the two
// fails here.

const APP_CSS = new URL("../app.css", import.meta.url).pathname;

// Each Palette field maps to one app.css custom property (the mapping the
// caret-theme.ts field comments document).
const FIELD_TO_TOKEN: Record<string, string> = {
  bg: "--paper-sunk",
  fg: "--ink",
  comment: "--ink-faint",
  punctuation: "--ink-soft",
  keyword: "--accent",
  entity: "--accent-bright",
  string: "--ok",
};

/**
 * Reads the custom-property declarations from a single `:root { ... }` block of
 * app.css: the first block is the light theme, the second (inside the
 * prefers-color-scheme: dark media query) is the dark theme.
 */
function readRootTokens(css: string, which: 0 | 1): Record<string, string> {
  const blocks = [...css.matchAll(/:root\s*\{([^}]*)\}/g)];
  const body = blocks[which]?.[1];
  if (body === undefined) throw new Error(`app.css :root block #${which} not found`);
  const tokens: Record<string, string> = {};
  for (const decl of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    tokens[decl[1]!] = decl[2]!.trim();
  }
  return tokens;
}

/** The expected color for each Palette field, sourced from app.css tokens. */
function expectedPalette(tokens: Record<string, string>): Record<string, string> {
  const palette: Record<string, string> = {};
  for (const [field, token] of Object.entries(FIELD_TO_TOKEN)) {
    const value = tokens[token];
    if (value === undefined) throw new Error(`app.css token ${token} (for ${field}) not found`);
    palette[field] = value;
  }
  return palette;
}

interface ThemeLike {
  colors?: Record<string, string | undefined>;
  settings?: Array<{ settings?: { foreground?: string } }>;
}

/** Every distinct foreground color the theme actually emits. */
function themeColors(theme: ThemeLike): Set<string> {
  const colors = new Set<string>();
  for (const v of Object.values(theme.colors ?? {})) if (v) colors.add(v);
  for (const rule of theme.settings ?? []) {
    const fg = rule.settings?.foreground;
    if (fg) colors.add(fg);
  }
  return colors;
}

describe("caret-theme ↔ app.css palette sync", () => {
  const css = Bun.file(APP_CSS).text();

  for (const [label, theme, blockIndex] of [
    ["caretLight", caretLight, 0],
    ["caretDark", caretDark, 1],
  ] as const) {
    describe(label, () => {
      test("editor background/foreground match the app.css tokens", async () => {
        const expected = expectedPalette(readRootTokens(await css, blockIndex));
        expect(theme.colors?.["editor.background"]).toBe(expected.bg);
        expect(theme.colors?.["editor.foreground"]).toBe(expected.fg);
      });

      test("every emitted foreground is an app.css palette value", async () => {
        const expected = expectedPalette(readRootTokens(await css, blockIndex));
        const allowed = new Set(Object.values(expected));
        for (const color of themeColors(theme)) {
          // A color the theme emits that is not one of the seven mapped tokens
          // signals the palette drifted from app.css (or a new color leaked in).
          expect(allowed).toContain(color);
        }
      });

      test("each mapped token appears in the emitted theme", async () => {
        const expected = expectedPalette(readRootTokens(await css, blockIndex));
        const emitted = themeColors(theme);
        for (const [field, color] of Object.entries(expected)) {
          // Guards the reverse direction: a token the palette claims to mirror
          // must actually be used, so renaming/dropping a token is caught too.
          expect(emitted, `${label}.${field} (${color}) is used by the theme`).toContain(color);
        }
      });
    });
  }

  test("the two themes use distinct palettes (light vs dark do not collapse)", () => {
    expect(caretLight.colors?.["editor.background"]).not.toBe(
      caretDark.colors?.["editor.background"],
    );
  });
});

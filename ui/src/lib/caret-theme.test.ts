import { describe, expect, test } from "bun:test";
import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
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

// EXC-692: the plan view renders the plan as a markdown document, so a fenced
// code block's opening line (```lang) is markdown-tokenized — the ``` / ~~~ fence
// markers carry punctuation.definition.markdown and the language info-string
// carries fenced_code.block.language. The theme subdues the markers to --ink-faint
// and makes the language prominent (--accent, bold) while leaving the code body's
// color untouched. Tokenizing a real fence with caret-light pins those outcomes;
// the markers and language only render as separate spans once their colors differ.
describe("caret-theme fenced-code fence line", () => {
  const css = Bun.file(APP_CSS).text();

  // The app.css palette values are lowercase hex; shiki emits some token colors
  // uppercased, so normalize the received color (only) before comparing.
  async function tokenizeFence() {
    const hl = await createHighlighterCore({
      themes: [caretLight],
      langs: [import("shiki/langs/markdown.mjs")],
      engine: createJavaScriptRegexEngine(),
    });
    const md = ["```ts", "code", "```"].join("\n");
    return hl.codeToTokensBase(md, { lang: "markdown", theme: "caret-light" });
  }

  test("subdues the fence backticks to --ink-faint", async () => {
    const expected = expectedPalette(readRootTokens(await css, 0));
    const [line1] = await tokenizeFence();
    const backticks = line1?.find((t) => t.content === "```");
    expect(backticks?.color?.toLowerCase()).toBe(expected.comment);
  });

  test("renders the language tag in bold --accent", async () => {
    const expected = expectedPalette(readRootTokens(await css, 0));
    const [line1] = await tokenizeFence();
    const lang = line1?.find((t) => t.content === "ts");
    expect(lang?.color?.toLowerCase()).toBe(expected.keyword);
    // shiki FontStyle bitmask: bit value 2 is bold.
    expect((lang?.fontStyle ?? 0) & 2).toBe(2);
  });

  test("leaves the code body color unchanged (--accent-bright)", async () => {
    const expected = expectedPalette(readRootTokens(await css, 0));
    const code = (await tokenizeFence())[1]?.find((t) => t.content === "code");
    expect(code?.color?.toLowerCase()).toBe(expected.entity);
  });
});

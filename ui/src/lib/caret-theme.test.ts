import { describe, expect, test } from "bun:test";
import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { caretDark, caretLight } from "./caret-theme.ts";
import { type ColorToken, type ThemeId, THEMES } from "./theme.ts";

// caret-theme.ts derives its two shiki palettes from the THEMES color tokens in
// theme.ts (EXC-730) — the single source of truth for every color the UI paints.
// shiki resolves token colors at highlight time and can't read CSS custom
// properties, so it reads the hex out of THEMES at module load. These tests pin
// that derivation: every color a theme emits must be one of the seven mapped
// tokens, and each mapped token must actually be used — so renaming or dropping a
// token, or leaking a stray color in, fails here.

// Each Palette field maps to one THEMES custom property (the mapping
// caret-theme.ts's paletteFromTheme performs).
const FIELD_TO_TOKEN: Record<string, ColorToken> = {
  bg: "--paper-sunk",
  fg: "--ink",
  comment: "--ink-faint",
  punctuation: "--ink-soft",
  keyword: "--accent",
  entity: "--accent-bright",
  string: "--ok",
};

/** The expected color for each Palette field, sourced from a theme's tokens. The
 * ColorToken-keyed tokens map guarantees each lookup resolves. */
function expectedPalette(id: ThemeId): Record<string, string> {
  const tokens = THEMES[id].tokens;
  const palette: Record<string, string> = {};
  for (const [field, token] of Object.entries(FIELD_TO_TOKEN)) {
    palette[field] = tokens[token];
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

describe("caret-theme ↔ THEMES palette sync", () => {
  for (const [label, theme, id] of [
    ["caretLight", caretLight, "caret-light"],
    ["caretDark", caretDark, "caret-dark"],
  ] as const) {
    describe(label, () => {
      test("editor background/foreground match the THEMES tokens", () => {
        const expected = expectedPalette(id);
        expect(theme.colors?.["editor.background"]).toBe(expected.bg);
        expect(theme.colors?.["editor.foreground"]).toBe(expected.fg);
      });

      test("every emitted foreground is a mapped THEMES value", () => {
        const expected = expectedPalette(id);
        const allowed = new Set(Object.values(expected));
        for (const color of themeColors(theme)) {
          // A color the theme emits that is not one of the seven mapped tokens
          // signals the palette drifted from theme.ts (or a new color leaked in).
          expect(allowed).toContain(color);
        }
      });

      test("each mapped token appears in the emitted theme", () => {
        const expected = expectedPalette(id);
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
  // The THEMES palette values are lowercase hex; shiki emits some token colors
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
    const expected = expectedPalette("caret-light");
    const [line1] = await tokenizeFence();
    const backticks = line1?.find((t) => t.content === "```");
    expect(backticks?.color?.toLowerCase()).toBe(expected.comment);
  });

  test("renders the language tag in bold --accent", async () => {
    const expected = expectedPalette("caret-light");
    const [line1] = await tokenizeFence();
    const lang = line1?.find((t) => t.content === "ts");
    expect(lang?.color?.toLowerCase()).toBe(expected.keyword);
    // shiki FontStyle bitmask: bit value 2 is bold.
    expect((lang?.fontStyle ?? 0) & 2).toBe(2);
  });

  test("leaves the code body color unchanged (--accent-bright)", async () => {
    const expected = expectedPalette("caret-light");
    const code = (await tokenizeFence())[1]?.find((t) => t.content === "code");
    expect(code?.color?.toLowerCase()).toBe(expected.entity);
  });
});

import { beforeAll, describe, expect, test } from "bun:test";

import { readThemeFile } from "@ui/support/theme-file.ts";
import { shikiThemeFor } from "$lib/caret-theme.ts";
import { CARET_TOKENIZE_OPTIONS, createHighlighter } from "$lib/diffview/shiki-bundle.ts";
import { addTheme, type CustomThemeId, THEME_IDS, THEMES } from "$lib/theme.ts";
import { buildFileTheme } from "$lib/theme-file.ts";

describe("buildFileTheme", () => {
  for (const id of THEME_IDS) {
    test(`${id}.json builds the bundled ${id} theme`, async () => {
      expect(buildFileTheme(await readThemeFile(`${id}.json`))).toEqual(THEMES[id]);
    });
  }

  test("every palette hue override reaches its derived token", async () => {
    const file = await readThemeFile("caret-dark.json");
    const hues = {
      ruleHue: "#000001",
      washHue: "#000002",
      markHue: "#000003",
      chipBoldHue: "#000004",
      chipItalicHue: "#000005",
      chipCodeHue: "#000006",
      chipLinkHue: "#000007",
      chipRefHue: "#000008",
      chipSkillHue: "#000009",
    };
    const { tokens } = buildFileTheme({ ...file, palette: { ...file.palette, ...hues } });
    const expected = {
      "--rule": hues.ruleHue,
      "--rule-strong": hues.ruleHue,
      "--accent-wash": hues.washHue,
      "--mark": hues.markHue,
      "--mark-active": hues.markHue,
      "--chip-bold": hues.chipBoldHue,
      "--chip-italic": hues.chipItalicHue,
      "--chip-code": hues.chipCodeHue,
      "--chip-link": hues.chipLinkHue,
      "--chip-ref": hues.chipRefHue,
      "--chip-skill": hues.chipSkillHue,
    } as const;
    for (const [token, hue] of Object.entries(expected)) {
      expect(`${token} ${tokens[token as keyof typeof expected].slice(0, 7)}`).toBe(
        `${token} ${hue}`,
      );
    }
  });
});

describe("a syntax role without a font style", () => {
  type Lang = "json" | "javascript" | "typescript" | "markdown";
  const ITALIC = 1;
  const BOLD = 2;
  let probe: CustomThemeId;
  let highlighter: Awaited<ReturnType<typeof createHighlighter>>;

  beforeAll(async () => {
    const file = await readThemeFile("caret-dark.json");
    const withoutFontStyle = (role: keyof typeof file.syntax) => ({
      color: file.syntax[role].color,
    });
    probe = addTheme(
      buildFileTheme({
        ...file,
        id: "italic-probe",
        syntax: {
          ...file.syntax,
          type: { ...file.syntax.type, fontStyle: ["italic"] },
          function: { ...file.syntax.function, fontStyle: ["italic"] },
          property: withoutFontStyle("property"),
          variable: withoutFontStyle("variable"),
          punctuation: withoutFontStyle("punctuation"),
        },
      }),
    );
    highlighter = await createHighlighter({
      themes: [shikiThemeFor(probe), shikiThemeFor("caret-dark")],
      langs: ["json", "javascript", "typescript", "markdown"],
    });
  });

  const fontStyleOf = (theme: string, lang: Lang, code: string, content: string) => {
    const token = highlighter
      .codeToTokensBase(code, { lang, theme, ...CARET_TOKENIZE_OPTIONS })
      .flat()
      .find((t) => t.content === content);
    if (!token) throw new Error(`no "${content}" token in ${code}`);
    return token.fontStyle ?? 0;
  };
  const isItalic = (lang: Lang, code: string, content: string) =>
    (fontStyleOf(probe, lang, code, content) & ITALIC) !== 0;

  test("does not take a broader role's italic through the theme's scopes", () => {
    expect(isItalic("json", '{"a": 1}', "a")).toBe(false);
  });

  test("does not take an enclosing scope's italic", () => {
    expect(isItalic("javascript", "console.log(1)", "console")).toBe(false);
  });

  test("keeps the emphasis it sits inside", () => {
    expect(isItalic("markdown", "*em*", "*")).toBe(true);
  });

  for (const [label, theme] of [
    ["a styled-role theme", () => probe],
    ["caret-dark", () => "caret-dark"],
  ] as const) {
    test(`${label}: a doc comment's tag keeps the comment's italic`, () => {
      expect(
        fontStyleOf(theme(), "typescript", "/** @param {string} name */", "param") & ITALIC,
      ).toBe(ITALIC);
    });

    test(`${label}: a link inside bold keeps the bold`, () => {
      expect(
        fontStyleOf(theme(), "markdown", "**see [docs](https://x.dev) now**", "docs") & BOLD,
      ).toBe(BOLD);
    });
  }
});

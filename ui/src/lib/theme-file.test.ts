import { describe, expect, test } from "bun:test";

import { readThemeFile } from "@ui/support/theme-file.ts";
import { CARET_SHIKI_THEMES } from "$lib/caret-shiki.ts";
import { shikiThemeFor } from "$lib/caret-theme.ts";
import { CARET_TOKENIZE_OPTIONS, createHighlighter } from "$lib/diffview/shiki-bundle.ts";
import { addTheme, THEMES } from "$lib/theme.ts";
import { buildFileTheme } from "$lib/theme-file.ts";

describe("buildFileTheme", () => {
  for (const id of ["caret-dark", "caret-light"] as const) {
    test(`${id}.json builds the bundled ${id} tokens and shiki theme`, async () => {
      const built = buildFileTheme(await readThemeFile(`${id}.json`));
      const bundled = THEMES[id];
      expect({
        id: built.id,
        label: built.label,
        scheme: built.scheme,
        tokens: built.tokens,
      }).toEqual({
        id: bundled.id,
        label: bundled.label,
        scheme: bundled.scheme,
        tokens: bundled.tokens,
      });
      expect(built.shikiTheme).toEqual(CARET_SHIKI_THEMES[id]);
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

describe("a syntax role without a font style", async () => {
  const file = await readThemeFile("caret-dark.json");
  const plain = (role: keyof typeof file.syntax) => ({ color: file.syntax[role].color });
  const theme = shikiThemeFor(
    addTheme(
      buildFileTheme({
        ...file,
        id: "italic-probe",
        syntax: {
          ...file.syntax,
          type: { ...file.syntax.type, fontStyle: ["italic"] },
          function: { ...file.syntax.function, fontStyle: ["italic"] },
          property: plain("property"),
          variable: plain("variable"),
          punctuation: plain("punctuation"),
        },
      }),
    ),
  );
  const highlighter = await createHighlighter({
    themes: [theme],
    langs: ["json", "javascript", "markdown"],
  });
  const ITALIC = 1;
  const isItalic = (lang: "json" | "javascript" | "markdown", code: string, content: string) =>
    ((highlighter
      .codeToTokensBase(code, { lang, theme: theme.name ?? "", ...CARET_TOKENIZE_OPTIONS })
      .flat()
      .find((t) => t.content === content)?.fontStyle ?? 0) &
      ITALIC) !==
    0;

  test("does not take a broader role's italic through the theme's scopes", () => {
    expect(isItalic("json", '{"a": 1}', "a")).toBe(false);
  });

  test("does not take an enclosing scope's italic", () => {
    expect(isItalic("javascript", "console.log(1)", "console")).toBe(false);
  });

  test("punctuation keeps the emphasis it sits inside", () => {
    expect(isItalic("markdown", "*em*", "*")).toBe(true);
  });
});

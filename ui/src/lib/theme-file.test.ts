import { describe, expect, test } from "bun:test";

import { readThemeFile } from "@ui/support/theme-file.ts";
import { CARET_SHIKI_THEMES } from "$lib/caret-shiki.ts";
import { THEMES } from "$lib/theme.ts";
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

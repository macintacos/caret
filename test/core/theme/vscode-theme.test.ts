import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import catppuccinFrappe from "shiki/themes/catppuccin-frappe.mjs";
import catppuccinLatte from "shiki/themes/catppuccin-latte.mjs";
import catppuccinMacchiato from "shiki/themes/catppuccin-macchiato.mjs";
import catppuccinMocha from "shiki/themes/catppuccin-mocha.mjs";
import dracula from "shiki/themes/dracula.mjs";
import githubDarkDefault from "shiki/themes/github-dark-default.mjs";
import githubLightDefault from "shiki/themes/github-light-default.mjs";

import { SYNTAX_ROLES } from "@/theme/schema.ts";
import { syntaxFromVsCodeTheme, type VsCodeTheme } from "@/theme/vscode-theme.ts";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const BASE = { colors: { "editor.foreground": "#000000" } };

function convert(tokenColors: VsCodeTheme["tokenColors"], colors = BASE.colors) {
  return syntaxFromVsCodeTheme({ colors, tokenColors });
}

describe("syntaxFromVsCodeTheme selector matching", () => {
  test("a rule on the role's own scope beats a more specific one it does not cover", () => {
    const syntax = convert([
      { scope: "keyword.control", settings: { foreground: "#111111" } },
      { scope: "keyword", settings: { foreground: "#222222" } },
    ]);
    expect(syntax.keyword.color).toBe("#222222");
  });

  test("the most specific prefix selector wins", () => {
    const syntax = convert([
      { scope: "entity.name.function", settings: { foreground: "#333333" } },
      { scope: "entity.name", settings: { foreground: "#222222" } },
      { scope: "entity", settings: { foreground: "#111111" } },
    ]);
    expect(syntax.function.color).toBe("#333333");
  });

  test("a parent selector reaches a child scope", () => {
    const syntax = convert([{ scope: "entity.name", settings: { foreground: "#222222" } }]);
    expect(syntax.function.color).toBe("#222222");
  });

  test("a later rule wins a specificity tie", () => {
    const syntax = convert([
      { scope: "string", settings: { foreground: "#111111" } },
      { scope: "string", settings: { foreground: "#222222" } },
    ]);
    expect(syntax.string.color).toBe("#222222");
  });

  test("comma-joined string scopes and scope arrays both match", () => {
    const syntax = convert([
      { scope: "comment, string", settings: { foreground: "#111111" } },
      { scope: ["keyword", "constant.numeric"], settings: { foreground: "#222222" } },
    ]);
    expect([syntax.comment.color, syntax.string.color]).toEqual(["#111111", "#111111"]);
    expect([syntax.keyword.color, syntax.number.color]).toEqual(["#222222", "#222222"]);
  });

  test("descendant and exclusion selectors never match a bare scope", () => {
    const syntax = convert([
      { scope: "meta.tag keyword", settings: { foreground: "#111111" } },
      { scope: "keyword - keyword.control", settings: { foreground: "#222222" } },
    ]);
    expect(syntax.keyword.color).toBe("#000000");
  });

  test.each(["str", "string.quoted"])("selector %p does not reach the string scope", (scope) => {
    expect(convert([{ scope, settings: { foreground: "#111111" } }]).string.color).toBe("#000000");
  });
});

describe("syntaxFromVsCodeTheme resolution", () => {
  test("foreground and fontStyle resolve independently", () => {
    const syntax = convert([
      { scope: "comment", settings: { foreground: "#111111" } },
      { scope: "comment", settings: { fontStyle: "italic" } },
      { settings: { fontStyle: "bold" } },
    ]);
    expect(syntax.comment).toEqual({ color: "#111111", fontStyle: ["italic"] });
  });

  test("a scopeless rule is the theme-wide default", () => {
    const syntax = convert([{ settings: { foreground: "#123456" } }]);
    expect(syntax.variable.color).toBe("#123456");
  });

  test("with no matching rule the color falls back to editor.foreground", () => {
    expect(convert([]).type.color).toBe("#000000");
  });

  test("a theme with no foreground at all throws naming the role", () => {
    expect(() => syntaxFromVsCodeTheme({ tokenColors: [] })).toThrow(/comment/);
  });

  test("settings is read when tokenColors is absent", () => {
    const syntax = syntaxFromVsCodeTheme({
      settings: [{ scope: "string", settings: { foreground: "#222222" } }],
      colors: BASE.colors,
    });
    expect(syntax.string.color).toBe("#222222");
  });
});

describe("syntaxFromVsCodeTheme colors and font styles", () => {
  test.each([
    ["#ABC", "#aabbcc"],
    ["#abcd", "#aabbcc"],
    ["#AABBCCDD", "#aabbcc"],
    ["#A1B2C3", "#a1b2c3"],
  ])("%s normalises to %s", (input, expected) => {
    expect(convert([{ scope: "string", settings: { foreground: input } }]).string.color).toBe(
      expected,
    );
  });

  test("a non-hex color throws", () => {
    expect(() => convert([{ scope: "string", settings: { foreground: "red" } }])).toThrow(/red/);
  });

  test("a multi-word fontStyle keeps each known style", () => {
    const syntax = convert([{ scope: "keyword", settings: { fontStyle: "italic bold" } }]);
    expect(syntax.keyword.fontStyle).toEqual(["italic", "bold"]);
  });

  test.each(["", "regular", "normal"])("fontStyle %p omits fontStyle", (fontStyle) => {
    const syntax = convert([
      { scope: "keyword", settings: { fontStyle: "italic" } },
      { scope: "keyword", settings: { fontStyle } },
    ]);
    expect(syntax.keyword).toEqual({ color: "#000000" });
  });
});

describe("syntaxFromVsCodeTheme on vendor themes", () => {
  test("Dracula converts to its published comment, keyword and string colors", () => {
    const syntax = syntaxFromVsCodeTheme(dracula);
    expect(syntax.comment.color).toBe("#6272a4");
    expect(syntax.keyword.color).toBe("#ff79c6");
    expect(syntax.string.color).toBe("#f1fa8c");
  });

  const nightfox = (name: string): VsCodeTheme =>
    JSON.parse(
      readFileSync(join(REPO_ROOT, "ui/src/code-themes/nightfox", `${name}.json`), "utf8"),
    );

  test.each([
    ["catppuccin-latte", catppuccinLatte],
    ["catppuccin-frappe", catppuccinFrappe],
    ["catppuccin-macchiato", catppuccinMacchiato],
    ["catppuccin-mocha", catppuccinMocha],
    ["dracula", dracula],
    ["github-light-default", githubLightDefault],
    ["github-dark-default", githubDarkDefault],
    ["dawnfox", nightfox("dawnfox")],
    ["duskfox", nightfox("duskfox")],
  ] as const)("%s converts every role to a #rrggbb color", (_, theme) => {
    const syntax = syntaxFromVsCodeTheme(theme);
    expect(Object.keys(syntax).sort()).toEqual([...SYNTAX_ROLES].sort());
    for (const style of Object.values(syntax)) expect(style.color).toMatch(/^#[0-9a-f]{6}$/);
  });
});

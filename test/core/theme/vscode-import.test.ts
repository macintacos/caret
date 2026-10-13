import { describe, expect, test } from "bun:test";

import dracula from "shiki/themes/dracula.mjs";
import githubLightDefault from "shiki/themes/github-light-default.mjs";

import caretDark from "@ui/src/lib/themes/caret-dark.json" with { type: "json" };
import { BUILTIN_THEME_IDS } from "@/theme/builtin-ids.ts";
import { ROLE_SCOPES } from "@/theme/role-scopes.ts";
import { parseThemeFile } from "@/theme/schema.ts";
import { themeFileFromVsCode } from "@/theme/vscode-import.ts";
import { syntaxFromVsCodeTheme, type VsCodeTheme } from "@/theme/vscode-theme.ts";

const RULES = [{ scope: "keyword", settings: { foreground: "#112233" } }];

function convert(theme: unknown, fileName = "my-theme") {
  return themeFileFromVsCode(JSON.stringify(theme), fileName, BUILTIN_THEME_IDS);
}

function ok(theme: unknown, fileName?: string) {
  const result = convert(theme, fileName);
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return { ...result, file: JSON.parse(result.text) };
}

function errors(text: string, fileName = "my-theme"): string[] {
  const result = themeFileFromVsCode(text, fileName, BUILTIN_THEME_IDS);
  if (result.ok) throw new Error("expected the conversion to fail");
  return result.errors;
}

function minimal(extra: Record<string, unknown> = {}) {
  return {
    name: "Mine",
    type: "dark",
    colors: { "editor.foreground": "#eeeeee" },
    tokenColors: RULES,
    ...extra,
  };
}

describe("themeFileFromVsCode end to end", () => {
  test("converts Dracula into a theme file caret accepts", () => {
    const result = convert(dracula, "dracula");
    if (!result.ok) throw new Error(result.errors.join("\n"));
    expect(parseThemeFile(result.text).ok).toBe(true);
    const file = JSON.parse(result.text);
    expect(file.scheme).toBe("dark");
    expect(file.$schema).toContain("theme.schema.json");
    expect(file.syntax).toEqual(syntaxFromVsCodeTheme(dracula as VsCodeTheme));
    expect(Object.keys(file.syntax).sort()).toEqual(Object.keys(ROLE_SCOPES).sort());
    expect(file.id).toBe("dracula-custom");
    expect(result.notes.some((note) => note.includes('"dracula"'))).toBe(true);
  });

  test("a light theme gets the light scheme", () => {
    expect(ok(githubLightDefault).file.scheme).toBe("light");
  });
});

describe("themeFileFromVsCode input parsing", () => {
  test("accepts JSONC comments and trailing commas", () => {
    const text = `{
      // a line comment
      "type": "dark", /* a block comment */
      "colors": { "editor.foreground": "#eeeeee", },
      "tokenColors": [],
    }`;
    expect(themeFileFromVsCode(text, "x", BUILTIN_THEME_IDS).ok).toBe(true);
  });

  test("invalid JSON names the line", () => {
    const [error] = errors('{\n  "type": "dark",\n  "colors": {\n}}}');
    expect(error).toContain("line 4");
  });

  test("a top-level array is refused", () => {
    expect(errors("[]")).toEqual(["theme: must be a JSON object"]);
  });

  test("malformed rules are skipped", () => {
    const junk = [{ scope: "string" }, { scope: null, settings: {} }, { scope: 5, settings: {} }];
    const clean = ok(minimal()).file.syntax;
    expect(ok(minimal({ tokenColors: [...junk, ...RULES] })).file.syntax).toEqual(clean);
  });

  test("a non-hex rule color is skipped for the next matching rule", () => {
    const { file } = ok(
      minimal({
        tokenColors: [
          { settings: { foreground: "#aaaaaa" } },
          { scope: "entity", settings: { foreground: "#123456" } },
          { scope: "entity.name.function", settings: { foreground: "red" } },
        ],
      }),
    );
    expect(file.syntax.function.color).toBe("#123456");
  });

  test("a non-hex editor.foreground is ignored, not reported", () => {
    const [error] = errors(JSON.stringify(minimal({ colors: { "editor.foreground": "tomato" } })));
    expect(error).toStartWith("syntax:");
    expect(error).not.toContain("tomato");
  });

  test("uppercase hex colors are kept and lowercased", () => {
    const { file } = ok(
      minimal({
        colors: { "editor.foreground": "#EEEEEE", "editor.background": "#ABCDEF" },
        tokenColors: [{ scope: "keyword", settings: { foreground: "#BD93F9" } }],
      }),
    );
    expect(file.syntax.keyword.color).toBe("#bd93f9");
    expect(file.syntax.string.color).toBe("#eeeeee");
    expect(file.palette.sunk).toBe("#abcdef");
  });
});

describe("themeFileFromVsCode scheme", () => {
  test("high-contrast types map to their scheme", () => {
    expect(ok(minimal({ type: "hcDark" })).file.scheme).toBe("dark");
    expect(ok(minimal({ type: "hcLight" })).file.scheme).toBe("light");
  });

  test("a missing or unknown type is an error", () => {
    expect(errors(JSON.stringify(minimal({ type: undefined })))[0]).toStartWith("type:");
    expect(errors(JSON.stringify(minimal({ type: "sepia" })))[0]).toStartWith("type:");
  });
});

describe("themeFileFromVsCode refusals", () => {
  test("an include is refused by name", () => {
    const [error] = errors(JSON.stringify(minimal({ include: "./dark_vs.json" })));
    expect(error).toStartWith("include:");
    expect(error).toContain("./dark_vs.json");
  });

  test("a tokenColors path is refused by name", () => {
    const [error] = errors(JSON.stringify(minimal({ tokenColors: "./x.tmTheme" })));
    expect(error).toStartWith("tokenColors:");
    expect(error).toContain("./x.tmTheme");
  });

  test("reports every refusal in one pass", () => {
    const list = errors(JSON.stringify(minimal({ type: undefined, include: "./a.json" })));
    expect(list).toHaveLength(2);
  });
});

describe("themeFileFromVsCode chrome", () => {
  test("picks palette keys in candidate order, skipping translucent colors", () => {
    const { file, notes } = ok(
      minimal({
        colors: {
          "editor.foreground": "#eeeeee",
          "sideBar.background": "#00000080",
          "panel.background": "#123456ff",
          "editorWidget.background": "#222222",
          "dropdown.background": "#333333",
        },
      }),
    );
    expect(file.palette.paper).toBe("#123456");
    expect(file.palette.raised).toBe("#222222");
    expect(notes.filter((note) => note.startsWith("palette.paper:"))).toHaveLength(0);
    expect(notes.filter((note) => note.startsWith("palette.raised:"))).toHaveLength(0);
  });

  test("a key with no source takes caret's default and one note", () => {
    const { file, notes } = ok(minimal());
    expect(file.palette.accent).toBe(caretDark.palette.accent);
    expect(notes.filter((note) => note.startsWith("palette.accent:"))).toHaveLength(1);
    expect(notes.filter((note) => note.startsWith("palette.ink:"))).toHaveLength(0);
  });
});

describe("themeFileFromVsCode id and label", () => {
  test("come from the theme's name", () => {
    const { file } = ok(minimal({ name: "  Café Noir! " }));
    expect(file.label).toBe("Café Noir!");
    expect(file.id).toBe("cafe-noir");
  });

  test("fall back to the file name", () => {
    const { file } = ok(minimal({ name: undefined }), "Night Owl");
    expect(file.label).toBe("Night Owl");
    expect(file.id).toBe("night-owl");
  });

  test("an id nothing slugs to is an error", () => {
    expect(errors(JSON.stringify(minimal({ name: "!!!" })), "???")[0]).toStartWith("id:");
  });
});

describe("themeFileFromVsCode syntax", () => {
  test("a role with no color is an error", () => {
    const theme = { type: "dark", colors: {}, tokenColors: [] };
    expect(errors(JSON.stringify(theme))[0]).toStartWith("syntax:");
  });
});

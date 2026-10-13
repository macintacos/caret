import { describe, expect, test } from "bun:test";

import type { HighlighterCore, ThemeRegistrationRaw } from "shiki/core";

import { ROLE_SCOPES } from "@core/theme/role-scopes.ts";
import { CARET_TOKENIZE_OPTIONS, createHighlighter } from "$lib/diffview/shiki-bundle.ts";

import { renderDriftReport, themeDrift } from "./compare-themes.ts";
import { THEME_SAMPLES } from "./theme-sample.ts";

function fixtureTheme(keyword: { foreground: string; fontStyle?: string }): ThemeRegistrationRaw {
  return {
    name: "fixture",
    type: "dark",
    settings: [{ settings: { foreground: "#cccccc" } }, { scope: ["storage"], settings: keyword }],
  };
}

const SAMPLE = [{ lang: "typescript", code: "const x = 1;" }];
const highlighter = await createHighlighter({ themes: [], langs: ["typescript"] });

describe("themeDrift", () => {
  test("identical themes give no drift", async () => {
    const result = await themeDrift(
      highlighter,
      {
        original: fixtureTheme({ foreground: "#ff0000" }),
        converted: fixtureTheme({ foreground: "#ff0000" }),
      },
      SAMPLE,
    );
    expect(result.drift).toEqual([]);
    expect(result.tokens).toBeGreaterThan(0);
  });

  test("a differing keyword color is reported with its place and both colors", async () => {
    const result = await themeDrift(
      highlighter,
      {
        original: fixtureTheme({ foreground: "#ff0000" }),
        converted: fixtureTheme({ foreground: "#00ff00" }),
      },
      SAMPLE,
    );
    expect(result.drift).toEqual([
      {
        lang: "typescript",
        line: 1,
        text: "const",
        original: { color: "#ff0000", fontStyle: [] },
        converted: { color: "#00ff00", fontStyle: [] },
      },
    ]);
  });

  test("a font-style-only difference is reported", async () => {
    const result = await themeDrift(
      highlighter,
      {
        original: fixtureTheme({ foreground: "#ff0000", fontStyle: "italic" }),
        converted: fixtureTheme({ foreground: "#ff0000" }),
      },
      SAMPLE,
    );
    expect(result.drift.map((d) => [d.text, d.original.fontStyle, d.converted.fontStyle])).toEqual([
      ["const", ["italic"], []],
    ]);
  });

  test("whitespace-only tokens are never reported", async () => {
    const whitespace = (fg: string): ThemeRegistrationRaw => ({
      name: "fixture",
      type: "dark",
      settings: [{ settings: { foreground: fg } }],
    });
    const result = await themeDrift(
      highlighter,
      { original: whitespace("#111111"), converted: whitespace("#222222") },
      [{ lang: "typescript", code: "x\n   \ny" }],
    );
    expect(result.drift.map((d) => d.line)).toEqual([1, 3]);
  });
});

test("the sample reaches every role's canonical scope", async () => {
  const roles = Object.entries(ROLE_SCOPES);
  const color = (i: number) => `#0000${i.toString(16).padStart(2, "0")}`;
  const probe: ThemeRegistrationRaw = {
    name: "role-probe",
    type: "dark",
    settings: [
      { settings: { foreground: "#ffffff" } },
      ...roles.map(([, [canonical]], i) => ({
        scope: canonical,
        settings: { foreground: color(i) },
      })),
    ],
  };
  const sampleHighlighter: HighlighterCore = await createHighlighter({
    themes: [probe],
    langs: THEME_SAMPLES.map((s) => s.lang),
  });
  const paintedColors = new Set(
    THEME_SAMPLES.flatMap(({ lang, code }) =>
      sampleHighlighter
        .codeToTokensBase(code, { lang, theme: "role-probe", ...CARET_TOKENIZE_OPTIONS })
        .flat()
        .map((t) => t.color?.toLowerCase()),
    ),
  );
  expect(roles.filter((_, i) => !paintedColors.has(color(i))).map(([role]) => role)).toEqual([]);
});

describe("renderDriftReport", () => {
  const style = (color: string, fontStyle: string[] = []) => ({ color, fontStyle });
  const report = renderDriftReport([
    {
      id: "dracula",
      tokens: 40,
      drift: [
        {
          lang: "typescript",
          line: 3,
          text: "a|b",
          original: style("#111111", ["italic"]),
          converted: style("#222222"),
        },
        {
          lang: "markdown",
          line: 1,
          text: "`x`",
          original: style("#111111"),
          converted: style("#222222"),
        },
        {
          lang: "typescript",
          line: 4,
          text: " = ",
          original: style("#111111"),
          converted: style("#222222"),
        },
      ],
    },
    { id: "dawnfox", tokens: 30, drift: [] },
  ]);

  test("summarises each theme's differing and total tokens", () => {
    expect(report).toContain("| dracula | 3 | 40 |");
    expect(report).toContain("| dawnfox | 0 | 30 |");
  });

  test("tabulates each theme's differing tokens under its own heading", () => {
    expect(report).toContain("## dracula\n\n| Language | Line | Token | Original | Converted |");
    expect(report).toContain("| typescript | 3 | `a\\|b` | #111111 italic | #222222 |");
  });

  test("wraps a token holding a backtick in double-backtick delimiters", () => {
    expect(report).toContain("| markdown | 1 | `` `x` `` |");
  });

  test("renders a padded token trimmed", () => {
    expect(report).toContain("| typescript | 4 | `=` |");
  });

  test("says a theme with no differences has none in one line", () => {
    expect(report).toMatch(/## dawnfox\n\nNo differing tokens\.\n/);
  });
});

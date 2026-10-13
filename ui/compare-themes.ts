#!/usr/bin/env bun
// Highlights THEME_SAMPLES with each bundled vendor theme and with its conversion onto
// syntax roles, and writes every token whose style differs to ui/theme-drift.md.
//
// It lives at the ui/ root rather than under scripts/ because its module graph resolves
// $lib, an alias only ui/tsconfig.json carries. Its output is committed: a re-run's
// `git diff` is how drift is reviewed. Regenerate with
// `bun ui/compare-themes.ts && mise run format`.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { HighlighterCore, ThemeRegistrationRaw } from "shiki/core";

import { syntaxFromVsCodeTheme } from "@core/theme/vscode-theme.ts";
import { syntaxShikiTheme } from "$lib/caret-shiki.ts";
import { withStructuralOverrides } from "$lib/caret-theme.ts";
import { CARET_TOKENIZE_OPTIONS, createHighlighter } from "$lib/diffview/shiki-bundle.ts";
import { THEME_IDS, THEMES } from "$lib/theme.ts";
import { UPSTREAM_SHIKI_THEMES } from "$lib/upstream-shiki.ts";

import { THEME_SAMPLES, type ThemeSample } from "./theme-sample.ts";

const REPORT = fileURLToPath(new URL("./theme-drift.md", import.meta.url));

export interface TokenStyle {
  color: string;
  fontStyle: string[];
}

export interface TokenDrift {
  lang: string;
  line: number;
  text: string;
  original: TokenStyle;
  converted: TokenStyle;
}

export interface ThemeDrift {
  tokens: number;
  drift: TokenDrift[];
}

// vscode-textmate's FontStyle bits; shiki re-exports that enum as a type only, and its
// home package is a transitive dependency.
const FONT_STYLE_NAMES = [
  [1, "italic"],
  [2, "bold"],
  [4, "underline"],
  [8, "strikethrough"],
] as const;

function tokenStyle(variant: { color?: string; fontStyle?: number } | undefined): TokenStyle {
  const bits = variant?.fontStyle ?? 0;
  return {
    color: (variant?.color ?? "").toLowerCase(),
    fontStyle: FONT_STYLE_NAMES.filter(([bit]) => bits & bit).map(([, name]) => name),
  };
}

const sameStyle = (a: TokenStyle, b: TokenStyle) =>
  a.color === b.color && a.fontStyle.join(" ") === b.fontStyle.join(" ");

/** Tokenize every sample once under both themes and list the non-whitespace tokens whose
 * color or font style differs. Loads both themes into `highlighter`. */
export async function themeDrift(
  highlighter: HighlighterCore,
  original: ThemeRegistrationRaw,
  converted: ThemeRegistrationRaw,
  samples: readonly ThemeSample[],
): Promise<ThemeDrift> {
  await highlighter.loadTheme(original, converted);
  const result: ThemeDrift = { tokens: 0, drift: [] };
  for (const { lang, code } of samples) {
    const lines = highlighter.codeToTokensWithThemes(code, {
      lang,
      themes: { original: original.name ?? "", converted: converted.name ?? "" },
      ...CARET_TOKENIZE_OPTIONS,
    });
    lines.forEach((tokens, index) => {
      for (const token of tokens) {
        if (token.content.trim() === "") continue;
        result.tokens++;
        const before = tokenStyle(token.variants.original);
        const after = tokenStyle(token.variants.converted);
        if (!sameStyle(before, after)) {
          result.drift.push({
            lang,
            line: index + 1,
            text: token.content,
            original: before,
            converted: after,
          });
        }
      }
    });
  }
  return result;
}

function codeSpan(text: string): string {
  const trimmed = text.trim().replaceAll("|", "\\|");
  return trimmed.includes("`") ? `\`\` ${trimmed} \`\`` : `\`${trimmed}\``;
}

const styleCell = (s: TokenStyle) => [s.color, ...s.fontStyle].join(" ");

function themeSection({ id, drift }: ThemeDrift & { id: string }): string {
  if (drift.length === 0) return `## ${id}\n\nNo differing tokens.\n`;
  const rows = drift.map(
    (d) =>
      `| ${d.lang} | ${d.line} | ${codeSpan(d.text)} | ${styleCell(d.original)} | ${styleCell(d.converted)} |`,
  );
  return [
    `## ${id}`,
    "",
    "| Language | Line | Token | Original | Converted |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

/** Render the drift report. Pure, and nothing in it varies between runs, so an unchanged
 * tree regenerates it byte for byte. */
export function renderDriftReport(results: readonly (ThemeDrift & { id: string })[]): string {
  const summary = results.map((r) => `| ${r.id} | ${r.drift.length} | ${r.tokens} |`);
  return [
    "# Theme conversion drift",
    "",
    "Each bundled vendor theme against its conversion onto caret's syntax roles, over the " +
      "sample in `ui/theme-sample.ts`. Regenerate with `bun ui/compare-themes.ts && mise run format`. " +
      "On the converted side, Markdown structure (headings, inline code, fences) and diff lines " +
      "take `syntaxShikiTheme`'s fixed chrome rules rather than roles, so those rows show drift " +
      "no role change removes.",
    "",
    "| Theme | Differing tokens | Tokens |",
    "| --- | --- | --- |",
    ...summary,
    "",
    ...results.map(themeSection),
  ].join("\n");
}

function vendorPair(id: keyof typeof UPSTREAM_SHIKI_THEMES) {
  const theme = THEME_IDS.map((t) => THEMES[t]).find((t) => t.shikiTheme === id);
  if (!theme) throw new Error(`no palette names the shiki theme ${id}`);
  const source = UPSTREAM_SHIKI_THEMES[id];
  const t = theme.tokens;
  const chrome = {
    sunk: t["--paper-sunk"],
    ink: t["--ink"],
    accent: t["--accent"],
    accentBright: t["--accent-bright"],
    ok: t["--ok"],
    danger: t["--danger"],
  };
  const roles = syntaxFromVsCodeTheme(source);
  return {
    original: withStructuralOverrides(theme, source),
    converted: {
      ...withStructuralOverrides(theme, syntaxShikiTheme(theme.id, theme.scheme, chrome, roles)),
      // shiki keys loaded themes by name
      name: `${theme.id}-converted`,
    },
  };
}

async function main(): Promise<void> {
  const highlighter = await createHighlighter({
    themes: [],
    langs: THEME_SAMPLES.map((s) => s.lang),
  });
  const ids = Object.keys(UPSTREAM_SHIKI_THEMES) as (keyof typeof UPSTREAM_SHIKI_THEMES)[];
  const results = [];
  for (const id of ids) {
    const { original, converted } = vendorPair(id);
    results.push({ id, ...(await themeDrift(highlighter, original, converted, THEME_SAMPLES)) });
  }
  writeFileSync(REPORT, renderDriftReport(results));
}

if (import.meta.main) await main();

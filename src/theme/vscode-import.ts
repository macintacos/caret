// Converts a VS Code color theme's text into caret theme file text.
// CLI-only: never import it from ui/, it pulls zod, jsonc-parser, and caret's palette JSON.
import { type ParseError, parse as parseJsonc, printParseErrorCode } from "jsonc-parser";
import { z } from "zod";

import { errorMessage } from "@/lib/types.ts";
import { parseThemeFile, REQUIRED_COLORS } from "@/theme/schema.ts";
import {
  HEX_COLOR,
  normalizeColor,
  syntaxFromVsCodeTheme,
  type VsCodeTheme,
} from "@/theme/vscode-theme.ts";

import caretDark from "../../ui/src/lib/themes/caret-dark.json" with { type: "json" };
import caretLight from "../../ui/src/lib/themes/caret-light.json" with { type: "json" };

const SCHEMA_URL = "https://raw.githubusercontent.com/macintacos/caret/trunk/doc/theme.schema.json";
const MAX_LENGTH = 64;

type RequiredColor = (typeof REQUIRED_COLORS)[number];
type Scheme = "dark" | "light";
type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const CHROME_SOURCES = {
  paper: ["sideBar.background", "panel.background"],
  raised: ["editorWidget.background", "dropdown.background", "quickInput.background"],
  sunk: ["editor.background"],
  ink: ["editor.foreground", "foreground"],
  inkSoft: ["descriptionForeground", "tab.inactiveForeground"],
  inkFaint: ["disabledForeground", "editorLineNumber.foreground"],
  accent: ["button.background", "focusBorder"],
  accentBright: ["textLink.foreground", "button.hoverBackground"],
  accentInk: ["button.foreground"],
  neutral: ["editorLineNumber.foreground", "badge.background"],
  ok: [
    "gitDecoration.addedResourceForeground",
    "editorGutter.addedBackground",
    "terminal.ansiGreen",
  ],
  danger: [
    "errorForeground",
    "editorError.foreground",
    "gitDecoration.deletedResourceForeground",
    "terminal.ansiRed",
  ],
  attention: [
    "activityBarBadge.background",
    "notificationsInfoIcon.foreground",
    "editorInfo.foreground",
  ],
} as const satisfies Record<RequiredColor, readonly string[]>;

const CARET_THEMES = { dark: caretDark, light: caretLight } as const;

const SCHEMES: Record<string, Scheme> = {
  dark: "dark",
  hcDark: "dark",
  light: "light",
  hcLight: "light",
};

// VS Code skips a malformed rule, or a color it can't parse, rather than rejecting the theme.
const RuleSchema = z.object({
  scope: z.union([z.string(), z.array(z.string())]).optional(),
  settings: z.object({
    foreground: z.string().regex(HEX_COLOR).optional().catch(undefined),
    fontStyle: z.string().optional().catch(undefined),
  }),
});
const rules = z.array(z.unknown()).transform((items) =>
  items.flatMap((item) => {
    const rule = RuleSchema.safeParse(item);
    return rule.success ? [rule.data] : [];
  }),
);
const VsCodeThemeFileSchema = z.object({
  name: z.string().optional().catch(undefined),
  type: z.string().optional().catch(undefined),
  include: z.string().optional().catch(undefined),
  colors: z
    .record(z.string(), z.unknown())
    .catch({})
    .transform((colors) =>
      Object.fromEntries(
        Object.entries(colors).filter(
          (entry): entry is [string, string] =>
            typeof entry[1] === "string" && HEX_COLOR.test(entry[1]),
        ),
      ),
    ),
  tokenColors: z.union([z.string(), rules]).optional().catch(undefined),
  settings: rules.optional().catch(undefined),
});
type VsCodeThemeFile = z.output<typeof VsCodeThemeFileSchema>;

function lineOf(text: string, offset: number): number {
  return text.slice(0, offset).split("\n").length;
}

function parseInput(text: string): Result<VsCodeThemeFile> {
  const parseErrors: ParseError[] = [];
  const json: unknown = parseJsonc(text, parseErrors, { allowTrailingComma: true });
  const [first] = parseErrors;
  if (first) {
    const reason = printParseErrorCode(first.error);
    return {
      ok: false,
      errors: [`theme: is not valid JSON (${reason} at line ${lineOf(text, first.offset)})`],
    };
  }
  const theme = VsCodeThemeFileSchema.safeParse(json);
  return theme.success
    ? { ok: true, value: theme.data }
    : { ok: false, errors: ["theme: must be a JSON object"] };
}

function refusals(theme: VsCodeThemeFile): string[] {
  const errors: string[] = [];
  if (theme.include !== undefined) {
    errors.push(
      `include: caret can't follow an included theme ("${theme.include}"); merge its colors and tokenColors into this file`,
    );
  }
  if (typeof theme.tokenColors === "string") {
    errors.push(
      `tokenColors: caret can't read a .tmTheme file ("${theme.tokenColors}"); inline its rules as an array`,
    );
  }
  return errors;
}

function schemeOf(type: string | undefined): Result<Scheme> {
  const scheme = type === undefined ? undefined : SCHEMES[type];
  return scheme
    ? { ok: true, value: scheme }
    : {
        ok: false,
        errors: [`type: must be "dark" or "light" (VS Code's theme type); add it to the theme`],
      };
}

const isOpaque = (color: string) =>
  [3, 6].includes(color.length - 1) || /^#(.{3}f|.{6}ff)$/i.test(color);

function pickChrome(
  colors: Readonly<Record<string, string>>,
  scheme: Scheme,
): { palette: Record<RequiredColor, string>; notes: string[] } {
  const notes: string[] = [];
  const fallback = CARET_THEMES[scheme];
  const palette = Object.fromEntries(
    REQUIRED_COLORS.map((key) => {
      const candidates: readonly string[] = CHROME_SOURCES[key];
      const source = candidates.map((name) => colors[name]).find((c) => c && isOpaque(c));
      if (source) return [key, normalizeColor(source)];
      const value = fallback.palette[key];
      notes.push(
        `palette.${key}: no clear source in colors (tried ${candidates.join(", ")}); used ${fallback.label}'s ${value}`,
      );
      return [key, value];
    }),
  ) as Record<RequiredColor, string>;
  return { palette, notes };
}

function slug(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_LENGTH)
    .replace(/-+$/, "");
}

function identity(
  name: string | undefined,
  fileName: string,
  builtinIds: readonly string[],
): Result<{ id: string; label: string; notes: string[] }> {
  const trimmed = name?.trim() || undefined;
  const label = (trimmed ?? fileName).slice(0, MAX_LENGTH);
  const base = (trimmed && slug(trimmed)) || slug(fileName);
  if (!base) {
    return {
      ok: false,
      errors: ["id: can't derive one from the theme's name or file name; rename the file"],
    };
  }
  if (!builtinIds.includes(base)) return { ok: true, value: { id: base, label, notes: [] } };
  const id = `${base}-custom`;
  return {
    ok: true,
    value: { id, label, notes: [`id: "${base}" is a built-in theme, so this one is "${id}"`] },
  };
}

function syntaxOf(theme: VsCodeTheme): Result<ReturnType<typeof syntaxFromVsCodeTheme>> {
  try {
    return { ok: true, value: syntaxFromVsCodeTheme(theme) };
  } catch (error) {
    return { ok: false, errors: [`syntax: ${errorMessage(error)}`] };
  }
}

/** Converts a VS Code theme's JSONC text into theme file text caret accepts, with a note
 * per guess it made, or one error line per problem. `fileName` is the input's base name
 * without its extension, used when the theme has no `name`. */
export function themeFileFromVsCode(
  text: string,
  fileName: string,
  builtinIds: readonly string[],
): { ok: true; text: string; notes: string[] } | { ok: false; errors: string[] } {
  const parsed = parseInput(text);
  if (!parsed.ok) return parsed;
  const input = parsed.value;
  const scheme = schemeOf(input.type);
  const errors = [...(scheme.ok ? [] : scheme.errors), ...refusals(input)];
  if (!scheme.ok || errors.length > 0) return { ok: false, errors };

  const ident = identity(input.name, fileName, builtinIds);
  if (!ident.ok) return ident;
  const tokenColors = typeof input.tokenColors === "string" ? undefined : input.tokenColors;
  const theme: VsCodeTheme = { colors: input.colors, tokenColors, settings: input.settings };
  const syntax = syntaxOf(theme);
  if (!syntax.ok) return syntax;

  const { id, label } = ident.value;
  const chrome = pickChrome(input.colors, scheme.value);
  const file = { $schema: SCHEMA_URL, id, label, scheme: scheme.value, palette: chrome.palette };
  const output = `${JSON.stringify({ ...file, syntax: syntax.value }, null, 2)}\n`;
  const valid = parseThemeFile(output);
  if (!valid.ok) return valid;
  return { ok: true, text: output, notes: [...ident.value.notes, ...chrome.notes] };
}

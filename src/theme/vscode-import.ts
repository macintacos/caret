// Converts a VS Code color theme's text into caret theme file text.
// CLI-only: never import it from ui/; zod and jsonc-parser must stay out of the UI bundle.
import { type ParseError, parse as parseJsonc, printParseErrorCode } from "jsonc-parser";
import { z } from "zod";

import { MAX_LENGTH, parseThemeFile, REQUIRED_COLORS } from "@/theme/schema.ts";
import {
  HEX_COLOR,
  normalizeColor,
  syntaxFromVsCodeTheme,
  type VsCodeTheme,
} from "@/theme/vscode-theme.ts";

import caretDark from "../../ui/src/lib/themes/caret-dark.json" with { type: "json" };
import caretLight from "../../ui/src/lib/themes/caret-light.json" with { type: "json" };

const SCHEMA_URL = "https://raw.githubusercontent.com/macintacos/caret/trunk/doc/theme.schema.json";

const VS_CODE_TYPES = ["dark", "hcDark", "light", "hcLight"] as const;

type RequiredColor = (typeof REQUIRED_COLORS)[number];
type Scheme = "dark" | "light";
type VsCodeType = (typeof VS_CODE_TYPES)[number];
type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };

// First opaque candidate wins: a translucent wash is no source for an opaque surface.
// `sunk` is the plan document, which caret-shiki paints as `editor.background`;
// `accent`/`accentInk` take the button pair so text on the accent keeps its contrast.
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

const SCHEMES = {
  dark: "dark",
  hcDark: "dark",
  light: "light",
  hcLight: "light",
} as const satisfies Record<VsCodeType, Scheme>;

// VS Code's registered `editor.foreground` defaults; hcLight's is the theme's `foreground`.
const EDITOR_FOREGROUNDS = {
  dark: "#bbbbbb",
  hcDark: "#ffffff",
  light: "#333333",
  hcLight: "#292929",
} as const satisfies Record<VsCodeType, string>;

// VS Code skips a malformed rule, or a color it can't parse, rather than rejecting the theme.
const rule = z.object({
  scope: z.union([z.string(), z.array(z.string())]).optional(),
  settings: z.object({
    foreground: z.string().regex(HEX_COLOR).optional().catch(undefined),
    fontStyle: z.string().optional().catch(undefined),
  }),
});
const rules = z.array(z.unknown()).transform((items) =>
  items.flatMap((item) => {
    const parsed = rule.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  }),
);
const vsCodeThemeFile = z.object({
  name: z.string().optional().catch(undefined),
  type: z.enum(VS_CODE_TYPES).optional().catch(undefined),
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
type VsCodeThemeFile = z.output<typeof vsCodeThemeFile>;

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
  const theme = vsCodeThemeFile.safeParse(json);
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

function schemeOf(type: VsCodeType | undefined): Result<Scheme> {
  return type
    ? { ok: true, value: SCHEMES[type] }
    : {
        ok: false,
        errors: [`type: must be "dark" or "light" (VS Code's theme type); add it to the theme`],
      };
}

const OPAQUE_HEX = /^#([0-9a-f]{3}f?|[0-9a-f]{6}(ff)?)$/i;

function pickChrome(
  colors: Readonly<Record<string, string>>,
  scheme: Scheme,
): { palette: Record<RequiredColor, string>; notes: string[] } {
  const notes: string[] = [];
  const fallbackTheme = CARET_THEMES[scheme];
  const palette: Partial<Record<RequiredColor, string>> = {};
  for (const key of REQUIRED_COLORS) {
    const candidates: readonly string[] = CHROME_SOURCES[key];
    const source = candidates
      .map((name) => colors[name])
      .find((color) => color && OPAQUE_HEX.test(color));
    if (source) {
      palette[key] = normalizeColor(source);
      continue;
    }
    palette[key] = fallbackTheme.palette[key];
    notes.push(
      `palette.${key}: no clear source in colors (tried ${candidates.join(", ")}); used ${fallbackTheme.label}'s ${palette[key]}`,
    );
  }
  return { palette: palette as Record<RequiredColor, string>, notes };
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

function idAndLabel(
  name: string | undefined,
  fileName: string,
  builtinIds: readonly string[],
): Result<{ id: string; label: string; notes: string[] }> {
  const trimmed = name?.trim() || undefined;
  const label = (trimmed ?? fileName).slice(0, MAX_LENGTH).replace(/[\uD800-\uDBFF]$/, "");
  const slugId = (trimmed && slug(trimmed)) || slug(fileName);
  if (!slugId) {
    return {
      ok: false,
      errors: ["id: can't derive one from the theme's name or file name; rename the file"],
    };
  }
  if (!builtinIds.includes(slugId)) return { ok: true, value: { id: slugId, label, notes: [] } };
  const id = `${slugId}-custom`;
  return {
    ok: true,
    value: { id, label, notes: [`id: "${slugId}" is a built-in theme, so this one is "${id}"`] },
  };
}

function withEditorForeground(
  colors: Readonly<Record<string, string>>,
  type: VsCodeType,
): { colors: Record<string, string>; notes: string[] } {
  if (colors["editor.foreground"]) return { colors: { ...colors }, notes: [] };
  const defaultForeground =
    type === "hcLight"
      ? (colors.foreground ?? EDITOR_FOREGROUNDS.hcLight)
      : EDITOR_FOREGROUNDS[type];
  return {
    colors: { ...colors, "editor.foreground": defaultForeground },
    notes: [
      `syntax: colors has no editor.foreground; tokens no rule colors use VS Code's default for a ${type} theme, ${defaultForeground}`,
    ],
  };
}

/** Converts a VS Code theme's JSONC text into theme file text caret accepts, with a note
 * per guess it made, or the error lines that stopped it: every `type` and refusal problem
 * at once, else the first later failure. `fileName` is the input's base name without its
 * extension, used when the theme has no `name`. An id in `builtinIds` takes a "-custom"
 * suffix. */
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
  if (!scheme.ok || input.type === undefined || errors.length > 0) return { ok: false, errors };

  const ident = idAndLabel(input.name, fileName, builtinIds);
  if (!ident.ok) return ident;
  // VS Code ignores a scope-less tokenColors rule; only the legacy `settings` array's is the default.
  const tokenColors =
    typeof input.tokenColors === "string" ? undefined : input.tokenColors?.filter((r) => r.scope);
  const editor = withEditorForeground(input.colors, input.type);
  const theme: VsCodeTheme = { colors: editor.colors, tokenColors, settings: input.settings };
  const syntax = syntaxFromVsCodeTheme(theme);

  const { id, label } = ident.value;
  const chrome = pickChrome(input.colors, scheme.value);
  const file = { $schema: SCHEMA_URL, id, label, scheme: scheme.value, palette: chrome.palette };
  const fileText = `${JSON.stringify({ ...file, syntax }, null, 2)}\n`;
  const valid = parseThemeFile(fileText);
  if (!valid.ok) return valid;
  return {
    ok: true,
    text: fileText,
    notes: [...ident.value.notes, ...editor.notes, ...chrome.notes],
  };
}

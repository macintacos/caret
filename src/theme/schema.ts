// The theme file format: its schema, user-worded errors, and JSON Schema. Strict at every
// level, unlike the daemon's lenient body schemas, so a typo like `pallete` fails rather
// than vanishes. The UI imports it type-only to keep zod out of the bundle.
import { z } from "zod";

// Relative, not @/: the UI's svelte-check reaches this file via @core, where @/ is ui/src.
import { errorMessage } from "../lib/types.ts";

/** The syntax roles every theme file must define. */
export const SYNTAX_ROLES = [
  "comment",
  "punctuation",
  "variable",
  "property",
  "attribute",
  "keyword",
  "function",
  "type",
  "string",
  "escape",
  "number",
] as const;

type BaseSyntaxRole = (typeof SYNTAX_ROLES)[number];

/** Each optional syntax role, mapped to the required role whose style it takes when a file omits it. */
export const SYNTAX_ROLE_FALLBACKS = {} as const satisfies Readonly<Record<string, BaseSyntaxRole>>;

export const FONT_STYLES = ["italic", "bold", "underline", "strikethrough"] as const;

type FontStyle = (typeof FONT_STYLES)[number];
export type SyntaxRole = BaseSyntaxRole | keyof typeof SYNTAX_ROLE_FALLBACKS;
export type RoleStyle = { color: string; fontStyle?: FontStyle[] };
export type ThemeSyntax = Record<SyntaxRole, RoleStyle>;

/** Fills each optional role the file omitted with its fallback role's style. */
export function fillFallbackRoles<Base extends string, Optional extends string>(
  syntax: NoInfer<Record<Base, RoleStyle> & Partial<Record<Optional, RoleStyle>>>,
  fallbacks: Readonly<Record<Optional, Base>>,
): Record<Base | Optional, RoleStyle> {
  const filled: Partial<Record<Base | Optional, RoleStyle>> = { ...syntax };
  for (const [role, base] of Object.entries(fallbacks) as [Optional, Base][]) {
    filled[role] ??= syntax[base];
  }
  return filled as Record<Base | Optional, RoleStyle>;
}

const MAX_LENGTH = 64;
const TOO_LONG = `must be at most ${MAX_LENGTH} characters`;

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "must be a hex color like #1a2b3c");

const roleStyle = z.strictObject({
  color,
  fontStyle: z.array(z.enum(FONT_STYLES, `must be one of ${FONT_STYLES.join(", ")}`)).optional(),
});

const REQUIRED_COLORS = [
  "paper",
  "raised",
  "sunk",
  "ink",
  "inkSoft",
  "inkFaint",
  "accent",
  "accentBright",
  "accentInk",
  "neutral",
  "ok",
  "danger",
  "attention",
] as const;

const OPTIONAL_HUES = [
  "ruleHue",
  "washHue",
  "markHue",
  "chipBoldHue",
  "chipItalicHue",
  "chipCodeHue",
  "chipLinkHue",
  "chipRefHue",
  "chipSkillHue",
] as const;

const palette = z.strictObject({
  ...(Object.fromEntries(REQUIRED_COLORS.map((key) => [key, color])) as Record<
    (typeof REQUIRED_COLORS)[number],
    typeof color
  >),
  ...(Object.fromEntries(OPTIONAL_HUES.map((key) => [key, color.optional()])) as Record<
    (typeof OPTIONAL_HUES)[number],
    z.ZodOptional<typeof color>
  >),
});

const syntax = z
  .strictObject({
    ...(Object.fromEntries(SYNTAX_ROLES.map((role) => [role, roleStyle])) as Record<
      BaseSyntaxRole,
      typeof roleStyle
    >),
    ...(Object.fromEntries(
      Object.keys(SYNTAX_ROLE_FALLBACKS).map((role) => [role, roleStyle.optional()]),
    ) as Record<keyof typeof SYNTAX_ROLE_FALLBACKS, z.ZodOptional<typeof roleStyle>>),
  })
  .transform(
    (roles): ThemeSyntax =>
      fillFallbackRoles<BaseSyntaxRole, keyof typeof SYNTAX_ROLE_FALLBACKS>(
        roles,
        SYNTAX_ROLE_FALLBACKS,
      ),
  );

export const ThemeFileSchema = z.strictObject({
  $schema: z.string().optional(),
  id: z
    .string()
    .max(MAX_LENGTH, TOO_LONG)
    .regex(
      /^[a-z0-9]+(-[a-z0-9]+)*$/,
      "must be a lowercase slug of letters, digits, and single dashes, like my-theme",
    ),
  label: z.string().min(1, "must not be empty").max(MAX_LENGTH, TOO_LONG),
  scheme: z.enum(["light", "dark"], {
    error: (issue) => (issue.input === undefined ? "is required" : 'must be "light" or "dark"'),
  }),
  palette,
  syntax,
});

/** A validated theme file; every optional syntax role is already filled from its fallback. */
export type ThemeFile = z.output<typeof ThemeFileSchema>;

const TYPE_WITH_ARTICLE: Record<string, string> = { array: "an array", object: "an object" };

function userMessage(issue: z.core.$ZodRawIssue): string | undefined {
  if (issue.code !== "invalid_type") return undefined;
  if (issue.input === undefined) return "is required";
  return `must be ${TYPE_WITH_ARTICLE[issue.expected] ?? `a ${issue.expected}`}`;
}

function issueLines(issue: z.core.$ZodIssue): string[] {
  const at = (path: PropertyKey[]) => z.core.toDotPath(path) || "theme file";
  if (issue.code === "unrecognized_keys") {
    return issue.keys.map((key) => `${at([...issue.path, key])}: is not a theme file field`);
  }
  return [`${at(issue.path)}: ${issue.message}`];
}

/** Validates a theme file's text, returning the parsed file or one `<path>: <message>` line per failure. */
export function parseThemeFile(
  text: string,
): { ok: true; file: ThemeFile } | { ok: false; errors: string[] } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return { ok: false, errors: [`theme file: is not valid JSON (${errorMessage(error)})`] };
  }
  const result = ThemeFileSchema.safeParse(json, { error: userMessage });
  if (result.success) return { ok: true, file: result.data };
  return { ok: false, errors: result.error.issues.flatMap(issueLines) };
}

/** The JSON Schema editors check a theme file with: the input side, so optional roles stay optional, at draft-7 for the widest editor support. */
export function themeFileJsonSchema(): z.core.JSONSchema.BaseSchema {
  return z.toJSONSchema(ThemeFileSchema, { target: "draft-7", io: "input" });
}

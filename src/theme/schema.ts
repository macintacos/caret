import { z } from "zod";

/** The required syntax roles, in caret-shiki's rule order. */
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

/** Gives every optional role a file omitted the style of the required role it falls back to. */
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

const LONGEST = 64;
const TOO_LONG = `must be at most ${LONGEST} characters`;

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
    .max(LONGEST, TOO_LONG)
    .regex(
      /^[a-z0-9]+(-[a-z0-9]+)*$/,
      "must be a lowercase slug of letters, digits, and single dashes, like my-theme",
    ),
  label: z.string().min(1, "must not be empty").max(LONGEST, TOO_LONG),
  scheme: z.enum(["light", "dark"], 'must be "light" or "dark"'),
  palette,
  syntax,
});

export type ThemeFile = z.output<typeof ThemeFileSchema>;

const ARTICLE: Record<string, string> = { array: "an array", object: "an object" };

function userMessage(issue: z.core.$ZodRawIssue): string | undefined {
  if (issue.code !== "invalid_type") return undefined;
  if (issue.input === undefined) return "is required";
  return `must be ${ARTICLE[issue.expected] ?? `a ${issue.expected}`}`;
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
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, errors: [`theme file: is not valid JSON (${reason})`] };
  }
  const result = ThemeFileSchema.safeParse(json, { error: userMessage });
  if (result.success) return { ok: true, file: result.data };
  return { ok: false, errors: result.error.issues.flatMap(issueLines) };
}

export function themeFileJsonSchema(): z.core.JSONSchema.BaseSchema {
  return z.toJSONSchema(ThemeFileSchema, { target: "draft-7", io: "input" });
}

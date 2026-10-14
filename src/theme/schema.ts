// The theme file format: its schema, user-worded errors, and JSON Schema. Strict at every
// level, unlike the daemon's lenient body schemas, so a typo like `pallete` fails rather
// than vanishes. The UI imports it type-only to keep zod out of the bundle.
import { z } from "zod";

// Relative, not @/: the UI's svelte-check reaches this file via @core, where @/ is ui/src.
import { errorMessage } from "../lib/types.ts";
import { fillFallbackRoles, SYNTAX_ROLE_FALLBACKS } from "./role-scopes.ts";

/** The syntax roles every theme file must define. */
export const REQUIRED_SYNTAX_ROLES = [
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

export type RequiredSyntaxRole = (typeof REQUIRED_SYNTAX_ROLES)[number];

export const FONT_STYLES = ["italic", "bold", "underline", "strikethrough"] as const;

export type FontStyle = (typeof FONT_STYLES)[number];

export type OptionalSyntaxRole = keyof typeof SYNTAX_ROLE_FALLBACKS;
export type SyntaxRole = RequiredSyntaxRole | OptionalSyntaxRole;

export const MAX_LENGTH = 64;
const TOO_LONG = `must be at most ${MAX_LENGTH} characters`;

const ColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "must be a hex color like #1a2b3c");

const RoleStyleSchema = z.strictObject({
  color: ColorSchema,
  fontStyle: z.array(z.enum(FONT_STYLES, `must be one of ${FONT_STYLES.join(", ")}`)).optional(),
});

export type RoleStyle = z.output<typeof RoleStyleSchema>;
export type ThemeSyntax = Record<SyntaxRole, RoleStyle>;

/** The markdown elements a theme file may style in the plan view. */
export const MARKDOWN_ELEMENTS = [
  "heading",
  "heading1",
  "heading2",
  "heading3",
  "heading4",
  "heading5",
  "heading6",
  "code",
  "link",
  "bold",
  "italic",
  "listMarker",
  "quote",
] as const;

export type MarkdownElement = (typeof MARKDOWN_ELEMENTS)[number];
export type ThemeMarkdown = Partial<Record<MarkdownElement, RoleStyle>>;

/** The palette colors every theme file must define. */
export const REQUIRED_COLORS = [
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

/** A zod shape that gives each of `keys` the same schema. */
function fieldsFor<K extends string, S>(keys: readonly K[], schema: S): Record<K, S> {
  return Object.fromEntries(keys.map((key) => [key, schema])) as Record<K, S>;
}

const PaletteSchema = z.strictObject({
  ...fieldsFor(REQUIRED_COLORS, ColorSchema),
  ...fieldsFor(OPTIONAL_HUES, ColorSchema.optional()),
});

const SyntaxSchema = z
  .strictObject({
    ...fieldsFor(REQUIRED_SYNTAX_ROLES, RoleStyleSchema),
    ...fieldsFor(
      Object.keys(SYNTAX_ROLE_FALLBACKS) as OptionalSyntaxRole[],
      RoleStyleSchema.optional(),
    ),
  })
  .transform((roles) => fillFallbackRoles(roles));

const MarkdownSchema = z.strictObject(fieldsFor(MARKDOWN_ELEMENTS, RoleStyleSchema.optional()));

export const ThemeFileSchema = z.strictObject({
  $schema: z.string().optional(),
  id: z
    .string()
    .max(MAX_LENGTH, TOO_LONG)
    .regex(
      /^[a-z0-9]+(-[a-z0-9]+)*$/,
      "must be a lowercase slug of letters, digits, and single dashes, like my-theme",
    ),
  label: z
    .string()
    .min(1, { error: "must not be empty", abort: true })
    .regex(/\S/, "must not be only whitespace")
    .max(MAX_LENGTH, TOO_LONG),
  scheme: z.enum(["light", "dark"], {
    error: (issue) => (issue.input === undefined ? "is required" : 'must be "light" or "dark"'),
  }),
  palette: PaletteSchema,
  syntax: SyntaxSchema,
  markdown: MarkdownSchema.optional(),
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

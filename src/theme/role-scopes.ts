// Each syntax role's TextMate scopes and each optional role's fallback.
import type { BaseSyntaxRole, RoleStyle, SyntaxRole } from "./schema.ts";

/** Each optional syntax role, mapped to the required role whose style it takes when a file omits it. */
export const SYNTAX_ROLE_FALLBACKS = {} as const satisfies Readonly<Record<string, BaseSyntaxRole>>;

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

/** The TextMate scopes each syntax role paints, its canonical scope first — the one
 * `syntaxFromVsCodeTheme` reads a theme's style from. */
// TextMate resolves the longest matching selector, so specificity does the ordering
// work and the groups below read top-down by role rather than by precedence:
// `keyword.operator` lands with the punctuation it looks like, `variable.other.property`
// takes the key hue over the identifier one, and `punctuation.definition.string` stays
// with its string.
export const ROLE_SCOPES: Record<SyntaxRole, readonly [canonical: string, ...more: string[]]> = {
  comment: ["comment", "punctuation.definition.comment", "string.comment"],
  punctuation: [
    "punctuation",
    "punctuation.separator",
    "punctuation.terminator",
    "punctuation.accessor",
    "meta.brace",
    // Operators read as the structure they are, not as the keywords they are
    // scoped under — `keyword.operator.new` below takes them back where the
    // operator IS the statement's spine.
    "keyword.operator",
  ],
  variable: [
    "variable",
    "variable.other",
    "variable.parameter",
    "variable.other.constant",
    "meta.definition.variable",
    "support.variable",
  ],
  property: [
    "variable.other.property",
    "variable.other.object.property",
    "meta.object-literal.key",
    "support.type.property-name",
  ],
  attribute: ["entity.other.attribute-name", "meta.attribute"],
  keyword: [
    "keyword",
    "keyword.control",
    "keyword.operator.new",
    "keyword.operator.expression",
    "storage",
    "storage.type",
    "storage.modifier",
    "variable.language",
    "entity.name.tag",
    "punctuation.definition.tag",
  ],
  function: ["entity.name.function", "support.function", "meta.function-call", "variable.function"],
  type: [
    "entity.name.type",
    "entity.name.class",
    "entity.other.inherited-class",
    "entity.name.namespace",
    "support.type",
    "support.class",
  ],
  string: [
    "string",
    "string.quoted",
    "string.template",
    "punctuation.definition.string",
    "constant.other.symbol",
  ],
  // An escape has to break its string, so these take the one hue in the set that
  // is a near-complement of it: the template-expression delimiters included, since
  // an interpolation is the same interruption spelled longer.
  escape: [
    "constant.character.escape",
    "string.regexp",
    "punctuation.definition.template-expression",
  ],
  number: ["constant.numeric", "constant.language", "support.constant"],
};

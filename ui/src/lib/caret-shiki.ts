// caret's own two shiki themes (EXC-903). The eleven shiki-only hues of the named color
// set in ./themes/caret.ts (EXC-902) are spent here, across a TextMate scope set wide
// enough to tell a type from a function, a number from a string escape, and an attribute
// from a property — the three pairs that set holds apart by hue.
// `syntaxShikiTheme` maps any theme's syntax roles onto the scope table below; caret's
// pair reaches it by mapping its record onto those roles (`caretRoles`).
//
// A theme is a plain `ThemeRegistrationRaw` object (shiki's load-theme guide), the same
// shape ./upstream-shiki.ts's vendor themes carry, so caret-theme.ts resolves the whole
// registry through one lookup rather than a fork.
//
// The colors come from the `CaretPalette` record rather than from `Theme.tokens`. The
// syntax half never becomes a `ColorToken`, so the tokens map has nowhere to put it; the
// record is where both halves live, and its `sunk` / `ink` are the same values
// `--paper-sunk` / `--ink` carry.
//
// caret's appended markdown rules — the structural markers and EXC-867's emphasis set —
// are deliberately ABSENT. caret-theme.ts appends them to every theme it resolves, and
// appended-last is what makes them win; a copy here would sit among the rules it exists
// to beat.

import type { ThemeRegistrationRaw } from "shiki/core";

import type { SyntaxRole, ThemeSyntax } from "@core/theme/schema.ts";
// Both imports are type-only in one direction: theme.ts takes `CaretShikiThemeId`
// from here and this module takes its two types from there. `verbatimModuleSyntax`
// erases both, so the cycle is a source-graph artifact rather than a load order — keep
// it that way, and never reach for a runtime value across it.
import type { BuiltinThemeId, Scheme } from "$lib/theme.ts";
import { CARET_DARK, CARET_LIGHT, type CaretPalette } from "$lib/themes/caret.ts";

// TextMate resolves the longest matching selector, so specificity does the ordering
// work and the groups below read top-down by role rather than by precedence:
// `keyword.operator` lands with the punctuation it looks like, `variable.other.property`
// takes the key hue over the identifier one, and `punctuation.definition.string` stays
// with its string.
const ROLE_SCOPES: Record<SyntaxRole, readonly string[]> = {
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

/** Build a shiki theme from a scheme's syntax roles, plus caret's fixed markdown and diff
 * rules, which paint from the six chrome colors and the comment role. */
export function syntaxShikiTheme(
  name: string,
  scheme: Scheme,
  chrome: Pick<CaretPalette, "sunk" | "ink" | "accent" | "accentBright" | "ok" | "danger">,
  roles: ThemeSyntax,
): ThemeRegistrationRaw {
  return {
    name,
    type: scheme,
    colors: {
      "editor.background": chrome.sunk,
      "editor.foreground": chrome.ink,
    },
    settings: [
      ...Object.entries(ROLE_SCOPES).map(([role, scopes]) => {
        const { color, fontStyle } = roles[role as SyntaxRole];
        return {
          scope: [...scopes],
          settings: fontStyle
            ? { foreground: color, fontStyle: fontStyle.join(" ") }
            : { foreground: color },
        };
      }),
      // Markdown. The plan view renders the plan as a markdown document, so these are
      // the rules a reviewer reads most.
      {
        scope: ["markup.heading", "markup.heading entity.name", "punctuation.definition.heading"],
        settings: { foreground: chrome.accent, fontStyle: "bold" },
      },
      { scope: ["markup.bold"], settings: { fontStyle: "bold" } },
      { scope: ["markup.italic"], settings: { fontStyle: "italic" } },
      // Inline code and a fence's body ride the accent's lighter sibling: the set names
      // no hue of their own, and giving them one is EXC-858's.
      {
        scope: ["markup.inline.raw", "markup.fenced_code"],
        settings: { foreground: chrome.accentBright },
      },
      // Diff. The semantic pair, so a rendered patch agrees with the diff view's own
      // addition and deletion tints rather than reading them as two more syntax hues.
      {
        scope: ["markup.inserted", "meta.diff.header.to-file", "punctuation.definition.inserted"],
        settings: { foreground: chrome.ok },
      },
      {
        scope: ["markup.deleted", "meta.diff.header.from-file", "punctuation.definition.deleted"],
        settings: { foreground: chrome.danger },
      },
      {
        scope: ["meta.diff.range", "punctuation.definition.range.diff", "meta.diff.header"],
        settings: { foreground: roles.comment.color, fontStyle: "italic" },
      },
      { scope: ["invalid", "invalid.illegal"], settings: { foreground: chrome.danger } },
    ],
  };
}

function caretRoles(p: CaretPalette): ThemeSyntax {
  return {
    comment: { color: p.comment, fontStyle: ["italic"] },
    punctuation: { color: p.punctuation },
    variable: { color: p.variable },
    property: { color: p.property },
    attribute: { color: p.attribute },
    keyword: { color: p.keyword },
    function: { color: p.func },
    type: { color: p.type },
    string: { color: p.string },
    escape: { color: p.escape },
    number: { color: p.number },
  };
}

/** Build one scheme's theme from its record.
 *
 * @param id - The theme's shiki name, which is also its palette id — a highlighter
 * resolves it by the same handle appearance.ts paints with. Typing it `BuiltinThemeId` keeps a
 * theme from naming a palette that does not exist; that its key and its `name` agree is
 * pinned by caret-theme.test.ts, and `caretTheme`'s `BuiltinThemeId & CaretShikiThemeId`
 * parameter closes the loop from the palette side. */
function caretShikiTheme(
  id: BuiltinThemeId,
  scheme: Scheme,
  p: CaretPalette,
): ThemeRegistrationRaw {
  return syntaxShikiTheme(id, scheme, p, caretRoles(p));
}

/** caret's own shiki themes, keyed by the palette id each belongs to. In THEMES order,
 * so this registry and upstream-shiki.ts's read alike. */
export const CARET_SHIKI_THEMES = {
  "caret-dark": caretShikiTheme("caret-dark", "dark", CARET_DARK),
  "caret-light": caretShikiTheme("caret-light", "light", CARET_LIGHT),
} as const;

/** The theme ids caret's own palettes point at — caret's own pair, and the half of
 * `ShikiThemeId` that is not a vendor's. */
export type CaretShikiThemeId = keyof typeof CARET_SHIKI_THEMES;

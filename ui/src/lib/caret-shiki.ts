// caret's own two shiki themes (EXC-903). The eleven shiki-only hues of the named color
// set in ./themes/caret.ts (EXC-902) are spent here, across a TextMate scope set wide
// enough to tell a type from a function, a number from a string escape, and an attribute
// from a property — the three pairs that set holds apart by hue.
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
// The three structural marker rules are deliberately ABSENT. caret-theme.ts appends them
// to every theme it resolves, and appended-last is what makes them win; a copy here would
// sit among the rules it exists to beat.
//
// This is a shiki-side asset map rather than a palette, so it lives beside theme.ts
// rather than in ./themes/ — every module in that directory is built through
// `paletteTheme`, which theme.test.ts pins. Same placement, and the same reason, as
// upstream-shiki.ts.

import type { ThemeRegistrationRaw } from "shiki/core";

// Both imports are type-only in one direction: theme.ts takes `CaretShikiThemeId`
// from here and this module takes its two types from there. `verbatimModuleSyntax`
// erases both, so the cycle is a source-graph artifact rather than a load order — keep
// it that way, and never reach for a runtime value across it.
import type { Scheme, ThemeId } from "$lib/theme.ts";
import { CARET_DARK, CARET_LIGHT, type CaretPalette } from "$lib/themes/caret.ts";

/** Build one scheme's theme from its record.
 *
 * TextMate resolves the longest matching selector, so specificity does the ordering
 * work and the groups below read top-down by role rather than by precedence:
 * `keyword.operator` lands with the punctuation it looks like, `variable.other.property`
 * takes the key hue over the identifier one, and `punctuation.definition.string` stays
 * with its string.
 *
 * @param id - The theme's shiki name, which is also its palette id — a highlighter
 * resolves it by the same handle appearance.ts paints with. Typing it `ThemeId` keeps a
 * theme from naming a palette that does not exist; that its key and its `name` agree is
 * pinned by caret-theme.test.ts, and `caretTheme`'s `ThemeId & CaretShikiThemeId`
 * parameter closes the loop from the palette side. */
function caretShikiTheme(id: ThemeId, scheme: Scheme, p: CaretPalette): ThemeRegistrationRaw {
  return {
    name: id,
    type: scheme,
    colors: {
      "editor.background": p.sunk,
      "editor.foreground": p.ink,
    },
    settings: [
      {
        scope: ["comment", "punctuation.definition.comment", "string.comment"],
        settings: { foreground: p.comment, fontStyle: "italic" },
      },
      {
        scope: [
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
        settings: { foreground: p.punctuation },
      },
      {
        scope: [
          "variable",
          "variable.other",
          "variable.parameter",
          "variable.other.constant",
          "meta.definition.variable",
          "support.variable",
        ],
        settings: { foreground: p.variable },
      },
      {
        scope: [
          "variable.other.property",
          "variable.other.object.property",
          "meta.object-literal.key",
          "support.type.property-name",
        ],
        settings: { foreground: p.property },
      },
      {
        scope: ["entity.other.attribute-name", "meta.attribute"],
        settings: { foreground: p.attribute },
      },
      {
        scope: [
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
        settings: { foreground: p.keyword },
      },
      {
        scope: [
          "entity.name.function",
          "support.function",
          "meta.function-call",
          "variable.function",
        ],
        settings: { foreground: p.func },
      },
      {
        scope: [
          "entity.name.type",
          "entity.name.class",
          "entity.other.inherited-class",
          "entity.name.namespace",
          "support.type",
          "support.class",
        ],
        settings: { foreground: p.type },
      },
      {
        scope: [
          "string",
          "string.quoted",
          "string.template",
          "punctuation.definition.string",
          "constant.other.symbol",
        ],
        settings: { foreground: p.string },
      },
      {
        // An escape has to break its string, so these take the one hue in the set that
        // is a near-complement of it: the template-expression delimiters included, since
        // an interpolation is the same interruption spelled longer.
        scope: [
          "constant.character.escape",
          "string.regexp",
          "punctuation.definition.template-expression",
        ],
        settings: { foreground: p.escape },
      },
      {
        scope: ["constant.numeric", "constant.language", "support.constant"],
        settings: { foreground: p.number },
      },
      // Markdown. The plan view renders the plan as a markdown document, so these are
      // the rules a reviewer reads most.
      {
        scope: ["markup.heading", "markup.heading entity.name", "punctuation.definition.heading"],
        settings: { foreground: p.accent, fontStyle: "bold" },
      },
      { scope: ["markup.bold"], settings: { fontStyle: "bold" } },
      { scope: ["markup.italic"], settings: { fontStyle: "italic" } },
      // Inline code and a fence's body ride the accent's lighter sibling: the set names
      // no hue of their own, and giving them one is EXC-858's.
      {
        scope: ["markup.inline.raw", "markup.fenced_code"],
        settings: { foreground: p.accentBright },
      },
      // Diff. The semantic pair, so a rendered patch agrees with the diff view's own
      // addition and deletion tints rather than reading them as two more syntax hues.
      {
        scope: ["markup.inserted", "meta.diff.header.to-file", "punctuation.definition.inserted"],
        settings: { foreground: p.ok },
      },
      {
        scope: ["markup.deleted", "meta.diff.header.from-file", "punctuation.definition.deleted"],
        settings: { foreground: p.danger },
      },
      {
        scope: ["meta.diff.range", "punctuation.definition.range.diff", "meta.diff.header"],
        settings: { foreground: p.comment, fontStyle: "italic" },
      },
      { scope: ["invalid", "invalid.illegal"], settings: { foreground: p.danger } },
    ],
  };
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

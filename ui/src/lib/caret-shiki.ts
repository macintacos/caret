// caret's own two shiki themes (EXC-903). The eleven shiki-only hues of the named color
// set in ./themes/caret.ts (EXC-902) are spent here, across a TextMate scope set wide
// enough to tell a type from a function, a number from a string escape, and an attribute
// from a property — the three pairs that set holds apart by hue.
// `syntaxShikiTheme` maps any theme's syntax roles onto core's role-scopes.ts table; caret's
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

import { fillFallbackRoles, ROLE_SCOPES } from "@core/theme/role-scopes.ts";
import type { SyntaxRole, ThemeSyntax } from "@core/theme/schema.ts";
// Both imports are type-only in one direction: theme.ts takes `CaretShikiThemeId`
// from here and this module takes its two types from there. `verbatimModuleSyntax`
// erases both, so the cycle is a source-graph artifact rather than a load order — keep
// it that way, and never reach for a runtime value across it.
import type { BuiltinThemeId, Scheme } from "$lib/theme.ts";
import { CARET_DARK, CARET_LIGHT, type CaretPalette } from "$lib/themes/caret.ts";

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
      ...fontStyleResets(roles),
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

/** Resets a style-less role's font style wherever a styled role's would leak into it. A
 * comment's style is exempt, so the doc tags inside one keep it. */
function fontStyleResets(roles: ThemeSyntax): NonNullable<ThemeRegistrationRaw["settings"]> {
  const entries = Object.entries(ROLE_SCOPES) as [SyntaxRole, readonly string[]][];
  const styled = entries.flatMap(([role, scopes]) =>
    role !== "comment" && roles[role].fontStyle?.length ? scopes : [],
  );
  if (styled.length === 0) return [];
  const unset = entries.flatMap(([role, scopes]) => (roles[role].fontStyle ? [] : scopes));
  // An unset font style is filled from a broader scope in the theme...
  const nested = unset.filter((scope) => styled.some((outer) => scope.startsWith(`${outer}.`)));
  return [
    ...(nested.length > 0 ? [{ scope: nested, settings: { fontStyle: "" } }] : []),
    // ...or from the enclosing token. Every role is restated, not only the style-less ones:
    // a parent-scoped rule is copied down to the longer scopes beneath it, color included.
    ...entries.map(([role, scopes]) => ({
      scope: styled.flatMap((outer) => scopes.map((scope) => `${outer} ${scope}`)),
      settings: {
        foreground: roles[role].color,
        fontStyle: roles[role].fontStyle?.join(" ") ?? "",
      },
    })),
  ];
}

function caretRoles(p: CaretPalette): ThemeSyntax {
  return fillFallbackRoles({
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
  });
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

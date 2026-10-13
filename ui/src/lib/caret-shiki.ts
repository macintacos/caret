// The shiki theme every theme file builds — built-in and runtime alike. `syntaxShikiTheme`
// maps a file's syntax roles onto core's role-scopes.ts table, a TextMate scope set wide
// enough to tell a type from a function, a number from a string escape, and an attribute
// from a property.
//
// The colors come from the file's palette, syntax and markdown styles rather than from
// `Theme.tokens`. The syntax half never becomes a `ColorToken`, so the tokens map has
// nowhere to put it; the palette's `sunk` / `ink` are the same values `--paper-sunk` /
// `--ink` carry.
//
// caret's appended markdown rules — the structural markers and EXC-867's emphasis set —
// are deliberately ABSENT. caret-theme.ts appends them to every theme it resolves, and
// appended-last is what makes them win; a copy here would sit among the rules it exists
// to beat.

import type { ThemeRegistrationRaw } from "shiki/core";

import { ROLE_SCOPES } from "@core/theme/role-scopes.ts";
import type { RoleStyle, SyntaxRole, ThemeFile, ThemeSyntax } from "@core/theme/schema.ts";

/** Build a shiki theme from a file's syntax roles, plus caret's markdown and diff rules,
 * which paint from six of its palette colors, its comment role, and the markdown styles
 * it names. */
export function syntaxShikiTheme(
  file: Pick<ThemeFile, "id" | "scheme" | "palette" | "syntax" | "markdown">,
): ThemeRegistrationRaw {
  const { palette: chrome, syntax: roles, markdown = {} } = file;
  return {
    name: file.id,
    type: file.scheme,
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
      // the rules a reviewer reads most. An element the file styles takes its style; the
      // rest paint from the chrome.
      {
        scope: ["markup.heading", "markup.heading entity.name", "punctuation.definition.heading"],
        // A heading style replaces caret's bold rather than adding to it.
        settings: markdown.heading
          ? { foreground: markdown.heading.color, fontStyle: fontStyle(markdown.heading) ?? "" }
          : { foreground: chrome.accent, fontStyle: "bold" },
      },
      // Whatever a bold or italic style adds to the font rides caret-theme.ts's emphasis rules.
      { scope: ["markup.bold"], settings: { fontStyle: "bold", ...foreground(markdown.bold) } },
      {
        scope: ["markup.italic"],
        settings: { fontStyle: "italic", ...foreground(markdown.italic) },
      },
      // A fence's body shares inline code's color, but not its font style.
      {
        scope: ["markup.inline.raw", "markup.fenced_code"],
        settings: { foreground: markdown.code?.color ?? chrome.accentBright },
      },
      ...(markdown.code?.fontStyle
        ? [{ scope: ["markup.inline.raw"], settings: { fontStyle: fontStyle(markdown.code) } }]
        : []),
      ...styledScope(["string.other.link.title.markdown"], markdown.link),
      ...styledScope(["punctuation.definition.list.begin.markdown"], markdown.listMarker),
      ...styledScope(["markup.quote"], markdown.quote),
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

function fontStyle(style: RoleStyle | undefined): string | undefined {
  return style?.fontStyle?.join(" ");
}

function foreground(style: RoleStyle | undefined): { foreground?: string } {
  return style ? { foreground: style.color } : {};
}

/** One rule painting `scopes` with a markdown style, or none for an element the file
 * leaves to caret. With no font style the rule sets none, so the element keeps the weight
 * and slant of what it sits in. */
function styledScope(
  scopes: string[],
  style: RoleStyle | undefined,
): NonNullable<ThemeRegistrationRaw["settings"]> {
  if (style === undefined) return [];
  const font = fontStyle(style);
  return [{ scope: scopes, settings: { ...foreground(style), ...(font && { fontStyle: font }) } }];
}

/** Resets a style-less role's font style wherever a styled role's would leak into it. A
 * comment's style is exempt, so the doc tags inside one keep it. */
function fontStyleResets(roles: ThemeSyntax): NonNullable<ThemeRegistrationRaw["settings"]> {
  const entries = Object.entries(ROLE_SCOPES) as [SyntaxRole, readonly string[]][];
  const styledScopes = entries.flatMap(([role, scopes]) =>
    role !== "comment" && roles[role].fontStyle?.length ? scopes : [],
  );
  if (styledScopes.length === 0) return [];
  const unset = entries.flatMap(([role, scopes]) => (roles[role].fontStyle ? [] : scopes));
  // An unset font style is filled from a broader scope in the theme...
  const nested = unset.filter((scope) =>
    styledScopes.some((outer) => scope.startsWith(`${outer}.`)),
  );
  return [
    ...(nested.length > 0 ? [{ scope: nested, settings: { fontStyle: "" } }] : []),
    // ...or from the enclosing token. Every role is restated, not only the style-less ones:
    // a parent-scoped rule is copied down to the longer scopes beneath it, color included.
    ...entries.map(([role, scopes]) => ({
      scope: styledScopes.flatMap((outer) => scopes.map((scope) => `${outer} ${scope}`)),
      settings: {
        foreground: roles[role].color,
        fontStyle: roles[role].fontStyle?.join(" ") ?? "",
      },
    })),
  ];
}

// Converts a VS Code color theme onto caret's syntax roles: the inverse of the UI's
// `syntaxShikiTheme`. It matches each role's canonical scope with the subset of
// TextMate theme matching a bare scope needs, rather than depending on vscode-textmate.
import { ROLE_SCOPES } from "./role-scopes.ts";
import { FONT_STYLES, type RoleStyle, type SyntaxRole, type ThemeSyntax } from "./schema.ts";

interface VsCodeTokenRule {
  scope?: string | readonly string[];
  settings: { foreground?: string; fontStyle?: string };
}

/** The parts of a VS Code theme (or shiki's raw registration) the converter reads. */
export interface VsCodeTheme {
  colors?: Readonly<Record<string, string>>;
  tokenColors?: readonly VsCodeTokenRule[];
  /** tmTheme-derived themes (the vendored Nightfox pair) carry their rules here. */
  settings?: readonly VsCodeTokenRule[];
}

type Setting = keyof VsCodeTokenRule["settings"];

/** One selector of one rule; a scopeless rule's selector is `""`. */
type FlatRule = { selector: string; settings: VsCodeTokenRule["settings"] };

function flattenRules(rules: readonly VsCodeTokenRule[]): FlatRule[] {
  return rules.flatMap(({ scope, settings }) => {
    if (scope === undefined) return [{ selector: "", settings }];
    const selectors = typeof scope === "string" ? scope.replace(/^,+|,+$/g, "").split(",") : scope;
    return selectors.map((selector) => ({ selector: selector.trim(), settings }));
  });
}

/** The selector's specificity against a bare scope, or -1 when it does not match. A
 * descendant or exclusion selector needs ancestors a bare scope lacks, so never matches. */
function specificity(selector: string, scope: string): number {
  if (selector === "") return 0;
  if (selector.includes(" ")) return -1;
  if (scope !== selector && !scope.startsWith(`${selector}.`)) return -1;
  return selector.split(".").length;
}

function resolveSetting(
  rules: readonly FlatRule[],
  scope: string,
  key: Setting,
): string | undefined {
  let best: string | undefined;
  let bestRank = -1;
  for (const { selector, settings } of rules) {
    const value = settings[key];
    const rank = specificity(selector, scope);
    // An equal rank falls through, so a later rule wins a tie, as TextMate's does.
    if (value === undefined || rank < 0 || rank < bestRank) continue;
    best = value;
    bestRank = rank;
  }
  return best;
}

function normalizeColor(color: string): string {
  const hex = color.toLowerCase().match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/)?.[1];
  if (hex === undefined) throw new Error(`"${color}" is not a hex color`);
  const full = hex.length <= 4 ? [...hex].map((digit) => digit + digit).join("") : hex;
  // ponytail: alpha is dropped, not blended over the background; blend if a theme relies
  // on translucent token colors.
  return `#${full.slice(0, 6)}`;
}

function parseFontStyle(fontStyle: string | undefined): RoleStyle["fontStyle"] {
  const styles = (fontStyle ?? "")
    .split(/\s+/)
    .filter((word): word is (typeof FONT_STYLES)[number] =>
      (FONT_STYLES as readonly string[]).includes(word),
    );
  return styles.length > 0 ? styles : undefined;
}

function roleStyle(
  rules: readonly FlatRule[],
  role: SyntaxRole,
  scope: string,
  defaultColor: string | undefined,
): RoleStyle {
  const color = resolveSetting(rules, scope, "foreground") ?? defaultColor;
  if (color === undefined) throw new Error(`the theme sets no color for the ${role} role`);
  const fontStyle = parseFontStyle(resolveSetting(rules, scope, "fontStyle"));
  return fontStyle ? { color: normalizeColor(color), fontStyle } : { color: normalizeColor(color) };
}

/** Maps a VS Code theme's token rules onto caret's syntax roles. Throws when a role
 * resolves to no color, or to one that is not hex. */
export function syntaxFromVsCodeTheme(theme: VsCodeTheme): ThemeSyntax {
  const rules = flattenRules(theme.settings ?? theme.tokenColors ?? []);
  const defaultColor = theme.colors?.["editor.foreground"];
  return Object.fromEntries(
    Object.entries(ROLE_SCOPES).map(([role, [scope]]) => [
      role,
      roleStyle(rules, role as SyntaxRole, scope, defaultColor),
    ]),
  ) as ThemeSyntax;
}

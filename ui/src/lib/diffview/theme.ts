// The theme/font bridge's Shiki half: it teaches the @pierre/diffs highlighter
// caret's own themes so the diff view highlights identically to caret's code
// blocks, and exposes the option fragment that selects them. The CSS half of
// the bridge (the --diffs-* custom properties) lives in ui/src/app.css; this
// module owns only the Shiki theme selection, which the library accepts as an
// option rather than a CSS variable.
//
// The library cannot accept caret's existing shiki highlighter instance — it
// keeps its own private singleton — so theme parity is reached by registering
// caret's theme objects into the library's highlighter instead. Both
// highlighters use the same pure-JS regex engine, so this duplicates a theme
// registration, never the WASM engine.
import { registerCustomTheme } from "@pierre/diffs";

import { CARET_SHIKI_THEMES } from "$lib/caret-theme.ts";
import { THEMES, type ThemeId } from "$lib/theme.ts";

/** Registers a named theme into the library's shared highlighter. Derived from
 * the library's own signature so the loader's resolved theme type stays in
 * lockstep with what registerCustomTheme accepts. */
type RegisterTheme = typeof registerCustomTheme;
type ThemeLoader = Parameters<RegisterTheme>[1];

/** The diff-view theme selection for the caret theme in effect. Both slots name
 * that one theme on purpose: caret always forces the scheme explicitly, and the
 * library also emits dual-theme CSS variables, so naming the live palette on both
 * sides makes the resolved colors independent of how the library resolves them —
 * the code retints with the chrome rather than with the scheme alone (EXC-752).
 *
 * With no theme named, the selection is caret's own pair following the system
 * preference, which is what a caller that doesn't track the appearance gets. */
export function caretDiffTheme(id?: ThemeId): {
  theme: Record<"light" | "dark", string>;
  themeType: "light" | "dark" | "system";
} {
  if (id === undefined) {
    return { theme: { light: "caret-light", dark: "caret-dark" }, themeType: "system" };
  }
  return { theme: { light: id, dark: id }, themeType: THEMES[id].scheme };
}

// caret's themes as the library expects them: a name plus an async loader
// returning the theme object. The name is duplicated onto the object because
// the library resolves a theme by the name it was registered under.
const caretThemeLoaders: { name: string; load: ThemeLoader }[] = CARET_SHIKI_THEMES.map((theme) => {
  const name = String(theme.name);
  return { name, load: async () => ({ ...theme, name }) };
});

let registered = false;

/**
 * Register caret's Shiki themes into the @pierre/diffs highlighter — every
 * palette, so whichever theme the reviewer picks can be selected by name. The
 * register function is injected so the mapping is unit-testable without the
 * library's module-global highlighter; production uses registerCustomTheme.
 *
 * Each call registers the whole set through the supplied register function. The
 * shared production highlighter is a process singleton, so a module-level guard
 * skips repeat production registrations (the wrapper calls this on every mount).
 * Passing a register function bypasses the guard, which is what lets a test
 * observe the registration directly.
 */
export function registerCaretDiffThemes(register?: RegisterTheme): void {
  if (register) {
    for (const { name, load } of caretThemeLoaders) register(name, load);
    return;
  }
  if (registered) return;
  registered = true;
  for (const { name, load } of caretThemeLoaders) registerCustomTheme(name, load);
}

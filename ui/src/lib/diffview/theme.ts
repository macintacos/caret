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
import { caretDark, caretLight } from "../caret-theme.ts";

/** Registers a named theme into the library's shared highlighter. Derived from
 * the library's own signature so the loader's resolved theme type stays in
 * lockstep with what registerCustomTheme accepts. */
type RegisterTheme = typeof registerCustomTheme;
type ThemeLoader = Parameters<RegisterTheme>[1];

/** The diff-view theme selection. caret's themes follow the system color
 * scheme, mirroring how app.css switches paper/ink tokens via
 * prefers-color-scheme. */
export const caretDiffTheme = {
  theme: { light: "caret-light", dark: "caret-dark" },
  themeType: "system",
} as const;

// caret's themes as the library expects them: a name plus an async loader
// returning the theme object. The name is duplicated onto the object because
// the library resolves a theme by the name it was registered under.
const caretThemeLoaders: { name: string; load: ThemeLoader }[] = [
  { name: "caret-light", load: async () => ({ ...caretLight, name: "caret-light" }) },
  { name: "caret-dark", load: async () => ({ ...caretDark, name: "caret-dark" }) },
];

let registered = false;

/**
 * Register caret's light/dark Shiki themes into the @pierre/diffs highlighter.
 * The register function is injected so the mapping is unit-testable without the
 * library's module-global highlighter; production uses registerCustomTheme.
 *
 * Each call registers both themes once through the supplied register function.
 * The shared production highlighter is a process singleton, so a module-level
 * guard skips repeat production registrations (the wrapper calls this on every
 * mount). Passing a register function bypasses the guard, which is what lets a
 * test observe the registration directly.
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

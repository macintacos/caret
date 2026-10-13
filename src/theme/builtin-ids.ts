/** Every theme id the UI ships, which no custom theme file may reuse. A copy, not an import:
 * ui/src/lib/theme.ts pulls in shiki. Keep in sync with its THEMES (ui/src/lib/theme.test.ts
 * fails on drift) and with doc/CONFIGURING.md § Where caret finds theme files. */
export const BUILTIN_THEME_IDS: readonly string[] = Object.freeze([
  "caret-dark",
  "caret-light",
  "catppuccin-latte",
  "catppuccin-frappe",
  "catppuccin-macchiato",
  "catppuccin-mocha",
  "dracula",
  "github-light",
  "github-dark",
  "dawnfox",
  "duskfox",
]);

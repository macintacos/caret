// The upstream shiki themes caret's vendor palettes point at (EXC-896): a palette
// named after a vendor highlights code with that vendor's own published theme, so
// picking Dracula gets Dracula — including the colors caret's seven-role derivation
// cannot produce at all. caret's own pair names nothing here and keeps the
// derivation; the resolution lives in caret-theme.ts.
//
// The imports are static so the map stays a synchronous module constant, which is
// what lets both highlighters — the excerpt popover's (diffview/highlight.ts) and
// the @pierre/diffs one (diffview/theme.ts) — keep sharing a single loaded copy
// through CARET_SHIKI_THEMES. The seven themes are ~264 KB raw, against the full
// shiki grammar bundle the UI already ships.
//
// GitHub's `-default` suffix is load-bearing — the unsuffixed pair is legacy Primer.
// caret-theme.test.ts pins the pairing by value, since the key union below catches an
// id that doesn't exist but not one that exists and is wrong.
//
// Hand these objects to caret-theme.ts, never straight to a highlighter: shiki's
// normalizeTheme mutates the rule array it is given in place, and the resolver's copy
// is what absorbs that rather than the entry here.
//
// This is a shiki-side asset map rather than a palette, so it lives beside
// theme.ts rather than in ./themes/ — every module in that directory is a palette
// built through `paletteTheme`, which theme.test.ts pins. Its analog is
// diffview/shiki-bundle.ts, whose whole job is likewise owning a shiki asset map.

import catppuccinFrappe from "shiki/themes/catppuccin-frappe.mjs";
import catppuccinLatte from "shiki/themes/catppuccin-latte.mjs";
import catppuccinMacchiato from "shiki/themes/catppuccin-macchiato.mjs";
import catppuccinMocha from "shiki/themes/catppuccin-mocha.mjs";
import dracula from "shiki/themes/dracula.mjs";
import githubDarkDefault from "shiki/themes/github-dark-default.mjs";
import githubLightDefault from "shiki/themes/github-light-default.mjs";

/** Every upstream theme a caret palette may name, keyed by the theme's own shiki
 * `name`. In THEMES order, so the two registries read alike. */
export const UPSTREAM_SHIKI_THEMES = {
  "catppuccin-latte": catppuccinLatte,
  "catppuccin-frappe": catppuccinFrappe,
  "catppuccin-macchiato": catppuccinMacchiato,
  "catppuccin-mocha": catppuccinMocha,
  dracula,
  "github-light-default": githubLightDefault,
  "github-dark-default": githubDarkDefault,
} as const;

/** The upstream theme ids a palette can point at. Typing a palette's `shikiTheme`
 * as this union rather than `string` makes an unregistered id a compile error. */
export type UpstreamShikiThemeId = keyof typeof UPSTREAM_SHIKI_THEMES;

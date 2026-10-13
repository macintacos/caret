// The upstream shiki themes each vendor theme file's syntax was converted from, keyed by
// palette id: the reference side of ui/compare-themes.ts. Dev-only — the app never
// imports it, so none of these themes reach the bundle.
//
// Nightfox's pair is vendored as shiki JSON from upstream's tmThemes because shiki
// doesn't ship it; THIRD_PARTY_LICENSES.md records the pinned source and the command
// that regenerates them.
//
// GitHub's `-default` suffix is load-bearing — the unsuffixed pair is legacy Primer.

import type { ThemeRegistrationRaw } from "shiki/core";
import catppuccinFrappe from "shiki/themes/catppuccin-frappe.mjs";
import catppuccinLatte from "shiki/themes/catppuccin-latte.mjs";
import catppuccinMacchiato from "shiki/themes/catppuccin-macchiato.mjs";
import catppuccinMocha from "shiki/themes/catppuccin-mocha.mjs";
import dracula from "shiki/themes/dracula.mjs";
import githubDarkDefault from "shiki/themes/github-dark-default.mjs";
import githubLightDefault from "shiki/themes/github-light-default.mjs";

import type { BuiltinThemeId } from "$lib/theme.ts";

import dawnfox from "../src/code-themes/nightfox/dawnfox.json";
import duskfox from "../src/code-themes/nightfox/duskfox.json";

/** Every vendor palette's upstream theme, in THEMES order. */
export const UPSTREAM_SHIKI_THEMES: Record<
  Exclude<BuiltinThemeId, "caret-dark" | "caret-light">,
  ThemeRegistrationRaw
> = {
  "catppuccin-latte": catppuccinLatte,
  "catppuccin-frappe": catppuccinFrappe,
  "catppuccin-macchiato": catppuccinMacchiato,
  "catppuccin-mocha": catppuccinMocha,
  dracula,
  "github-light": githubLightDefault,
  "github-dark": githubDarkDefault,
  // A JSON import widens `type` to string.
  dawnfox: dawnfox as ThemeRegistrationRaw,
  duskfox: duskfox as ThemeRegistrationRaw,
};

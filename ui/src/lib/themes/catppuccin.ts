// Catppuccin, all four flavors — https://catppuccin.com/palette/. Hex values are
// the published palette verbatim; only the mapping onto caret's tokens is ours.
//
// The mapping follows Catppuccin's own editor convention, which happens to line up
// with caret's surfaces exactly: chrome on `mantle`, the code body on `base` (the
// flavor's editor background), panels on `surface0`. In a light flavor there is
// nothing above `base`, so the trio shifts down a step (base / mantle / crust) and
// keeps caret's ordering rather than inventing an off-palette white.
//
// The ink ramp takes subtext1 / overlay2 rather than the shallower subtext0 /
// overlay1: caret paints secondary copy and metadata on the RAISED surface too
// (dialogs, dropdowns, cards), where a flavor's own surface tone eats the contrast
// the deeper pair keeps. `blue` is the attention hue — Catppuccin's own notice
// color, and the analog of caret's violet against an amber accent, leaving `mauve`
// alone as the selection mark.
//
// One place the palette is followed rather than corrected: Latte's `green` and
// `lavender` are low-contrast on a light surface, and they color string literals and
// entities in the diff view as well as filling gutter bars. They stay as published —
// reading Latte's own colors is the point of picking Latte, and overriding them would
// ship caret's opinion of the flavor instead of the flavor.

import type { Theme, ThemeId } from "$lib/theme.ts";
import { type PaletteInput, paletteTheme } from "$lib/themes/recipe.ts";
import type { UpstreamShikiThemeId } from "$lib/upstream-shiki.ts";

/** The subset of a Catppuccin flavor caret's tokens draw from. */
interface Flavor {
  crust: string;
  mantle: string;
  base: string;
  surface0: string;
  overlay0: string;
  overlay2: string;
  subtext1: string;
  text: string;
  mauve: string;
  lavender: string;
  blue: string;
  green: string;
  red: string;
}

const LATTE: Flavor = {
  crust: "#dce0e8",
  mantle: "#e6e9ef",
  base: "#eff1f5",
  surface0: "#ccd0da",
  overlay0: "#9ca0b0",
  overlay2: "#7c7f93",
  subtext1: "#5c5f77",
  text: "#4c4f69",
  mauve: "#8839ef",
  lavender: "#7287fd",
  blue: "#1e66f5",
  green: "#40a02b",
  red: "#d20f39",
};

const FRAPPE: Flavor = {
  crust: "#232634",
  mantle: "#292c3c",
  base: "#303446",
  surface0: "#414559",
  overlay0: "#737994",
  overlay2: "#949cbb",
  subtext1: "#b5bfe2",
  text: "#c6d0f5",
  mauve: "#ca9ee6",
  lavender: "#babbf1",
  blue: "#8caaee",
  green: "#a6d189",
  red: "#e78284",
};

const MACCHIATO: Flavor = {
  crust: "#181926",
  mantle: "#1e2030",
  base: "#24273a",
  surface0: "#363a4f",
  overlay0: "#6e738d",
  overlay2: "#939ab7",
  subtext1: "#b8c0e0",
  text: "#cad3f5",
  mauve: "#c6a0f6",
  lavender: "#b7bdf8",
  blue: "#8aadf4",
  green: "#a6da95",
  red: "#ed8796",
};

const MOCHA: Flavor = {
  crust: "#11111b",
  mantle: "#181825",
  base: "#1e1e2e",
  surface0: "#313244",
  overlay0: "#6c7086",
  overlay2: "#9399b2",
  subtext1: "#bac2de",
  text: "#cdd6f4",
  mauve: "#cba6f7",
  lavender: "#b4befe",
  blue: "#89b4fa",
  green: "#a6e3a1",
  red: "#f38ba8",
};

/** Map one flavor onto caret's tokens. Latte is the only light flavor, and the
 * scheme carries the one thing that differs: which surfaces the trio draws from.
 *
 * @param id - caret and shiki spell the flavor ids identically, so the one string
 * names both the palette and its upstream theme. The intersection makes that
 * identity a compile error to break rather than a coincidence to rely on. */
function flavor(
  id: ThemeId & UpstreamShikiThemeId,
  label: string,
  f: Flavor,
  dark: boolean,
): Theme {
  const surfaces: Pick<PaletteInput, "paper" | "raised" | "sunk"> = dark
    ? { paper: f.mantle, raised: f.surface0, sunk: f.base }
    : { paper: f.mantle, raised: f.base, sunk: f.crust };
  return paletteTheme({
    id,
    label,
    scheme: dark ? "dark" : "light",
    ...surfaces,
    ink: f.text,
    inkSoft: f.subtext1,
    inkFaint: f.overlay2,
    accent: f.mauve,
    accentBright: f.lavender,
    accentInk: dark ? f.crust : f.base,
    neutral: f.overlay0,
    ok: f.green,
    danger: f.red,
    attention: f.blue,
    shikiTheme: id,
  });
}

export const catppuccinLatte = flavor("catppuccin-latte", "Catppuccin Latte", LATTE, false);
export const catppuccinFrappe = flavor("catppuccin-frappe", "Catppuccin Frappé", FRAPPE, true);
export const catppuccinMacchiato = flavor(
  "catppuccin-macchiato",
  "Catppuccin Macchiato",
  MACCHIATO,
  true,
);
export const catppuccinMocha = flavor("catppuccin-mocha", "Catppuccin Mocha", MOCHA, true);

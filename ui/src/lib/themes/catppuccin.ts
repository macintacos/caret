// Catppuccin, all four flavors — https://catppuccin.com/palette/. Hex values are
// the published palette verbatim; only the mapping onto caret's tokens is ours.
//
// The mapping follows Catppuccin's own editor convention, which happens to line up
// with caret's surfaces exactly: chrome on `mantle`, the code body on `base` (the
// flavor's editor background), panels on `surface0`. In a light flavor there is
// nothing above `base`, so the trio shifts down a step (base / mantle / crust) and
// keeps caret's ordering rather than inventing an off-palette white.
//
// The ink ramp likewise shifts by scheme: the dark flavors read well on
// subtext0 / overlay1, but Latte's bright surface compresses contrast, so it takes
// the next deeper pair (subtext1 / overlay2) to clear caret's legibility floors.
// `blue` is the attention hue — Catppuccin's own notice color, and the analog of
// caret's violet against an amber accent, leaving `mauve` alone as the selection mark.
//
// One place the palette is followed rather than corrected: Latte's `green` is a low
// contrast success color on a light surface. It stays as published — it is what
// Catppuccin Latte's additions look like everywhere else — and caret only paints it
// as a fill and a gutter bar, never as body copy.

import type { Theme, ThemeId } from "$lib/theme.ts";
import { type PaletteInput, paletteTheme } from "$lib/themes/recipe.ts";

/** The subset of a Catppuccin flavor caret's tokens draw from. */
interface Flavor {
  crust: string;
  mantle: string;
  base: string;
  surface0: string;
  overlay0: string;
  overlay1: string;
  overlay2: string;
  subtext0: string;
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
  overlay1: "#8c8fa1",
  overlay2: "#7c7f93",
  subtext0: "#6c6f85",
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
  overlay1: "#838ba7",
  overlay2: "#949cbb",
  subtext0: "#a5adce",
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
  overlay1: "#8087a2",
  overlay2: "#939ab7",
  subtext0: "#a5adcb",
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
  overlay1: "#7f849c",
  overlay2: "#9399b2",
  subtext0: "#a6adc8",
  subtext1: "#bac2de",
  text: "#cdd6f4",
  mauve: "#cba6f7",
  lavender: "#b4befe",
  blue: "#89b4fa",
  green: "#a6e3a1",
  red: "#f38ba8",
};

/** Map one flavor onto caret's tokens. Latte is the only light flavor, so the
 * scheme carries both the surface shift and the deeper ink ramp it needs. */
function flavor(id: ThemeId, label: string, f: Flavor, dark: boolean): Theme {
  const surfaces: Pick<PaletteInput, "paper" | "raised" | "sunk"> = dark
    ? { paper: f.mantle, raised: f.surface0, sunk: f.base }
    : { paper: f.mantle, raised: f.base, sunk: f.crust };
  return paletteTheme({
    id,
    label,
    scheme: dark ? "dark" : "light",
    ...surfaces,
    ink: f.text,
    inkSoft: dark ? f.subtext0 : f.subtext1,
    inkFaint: dark ? f.overlay1 : f.overlay2,
    accent: f.mauve,
    accentBright: f.lavender,
    accentInk: dark ? f.crust : f.base,
    neutral: f.overlay0,
    ok: f.green,
    danger: f.red,
    attention: f.blue,
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

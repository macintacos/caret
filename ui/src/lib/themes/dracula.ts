// Dracula — https://draculatheme.com/. The eleven published colors plus the UI
// shades the official VS Code theme defines alongside them (BGLight / BGDark), which
// is where its sidebar, editor, and panel surfaces come from.
//
// One color is not Dracula's: `inkSoft`. The palette has exactly two neutrals for
// text — Foreground and Comment — and Comment sits at 3.0:1 on the page surface,
// which is a syntax color doing syntax work, not a secondary UI copy color. caret
// needs a rung between the two for settings descriptions and metadata rows, so this
// one is mixed from Foreground and Comment and stays inside Dracula's own hue.

import { paletteTheme } from "$lib/themes/recipe.ts";

export const dracula = paletteTheme({
  id: "dracula",
  label: "Dracula",
  scheme: "dark",
  paper: "#21222c", // BGDark — the sidebar shade
  raised: "#343746", // BGLight — dropdowns and panels
  sunk: "#282a36", // Background — the editor surface
  ink: "#f8f8f2", // Foreground
  inkSoft: "#b5bccf", // mixed from Foreground and Comment
  inkFaint: "#6272a4", // Comment — Dracula's own line-number and breadcrumb color
  accent: "#bd93f9", // Purple
  accentBright: "#d6acff", // the bright purple of Dracula's ANSI set
  accentInk: "#21222c", // BGDark
  neutral: "#6272a4", // Comment
  ok: "#50fa7b", // Green
  danger: "#ff5555", // Red
  attention: "#ffb86c", // Orange
});

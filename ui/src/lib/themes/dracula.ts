// Dracula — https://draculatheme.com/. The eleven published colors plus the UI
// shades the official VS Code theme defines alongside them (BGLight / BGDark), which
// is where its sidebar, editor, and panel surfaces come from.
//
// Two colors are not Dracula's: `inkSoft` and `inkFaint`. The palette publishes
// exactly two neutrals for text — Foreground and Comment — and Comment is a syntax
// color doing syntax work: Dracula paints it on its darkest surfaces, never on the
// lifted ones caret puts dialogs and dropdowns on. caret's ink ramp needs three
// rungs that hold up on all of them, so the middle two are mixed along Dracula's own
// Foreground↔Comment ramp, staying inside its hue. Comment itself remains the
// orphaned-mark neutral.

import { paletteTheme } from "$lib/themes/recipe.ts";

export const dracula = paletteTheme({
  id: "dracula",
  label: "Dracula",
  scheme: "dark",
  paper: "#21222c", // BGDark — the sidebar shade
  raised: "#343746", // BGLight — dropdowns and panels
  sunk: "#282a36", // Background — the editor surface
  ink: "#f8f8f2", // Foreground
  inkSoft: "#b5bccf", // mixed along the Foreground↔Comment ramp
  inkFaint: "#808db4", // mixed, a step up from Comment
  accent: "#bd93f9", // Purple
  accentBright: "#d6acff", // the light purple in Dracula's bright-ANSI set
  accentInk: "#21222c", // BGDark
  neutral: "#6272a4", // Comment
  ok: "#50fa7b", // Green
  danger: "#ff5555", // Red
  attention: "#ffb86c", // Orange
  shikiTheme: "dracula",
});

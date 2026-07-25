// The shared shape every vendor palette is mapped through (EXC-752). caret's own
// two palettes (./caret.ts) are written out token by token — they are the reference
// app.css mirrors — and this module is that reference generalized: name the thirteen
// colors a palette actually decides, and the seven that are always derived (the two
// rules, the accent wash, the two marks, the orphan mark, the shadow) come out
// consistent for every theme instead of being re-typed seven times.
//
// The alpha suffixes and the two shadows are caret-dark's and caret-light's own
// values, so a vendor theme's hairlines and highlight marks sit at exactly the
// weight caret's chrome was designed around — only the hue changes.

import type { ColorToken, Scheme, Theme, ThemeId } from "$lib/theme.ts";

/** The colors a palette decides for itself. Everything else in a `Theme` is
 * derived from these by `paletteTheme`. */
export interface PaletteInput {
  id: ThemeId;
  /** Human label shown in the Settings dropdown. */
  label: string;
  scheme: Scheme;
  /** The page surface. In dark it is the darkest of the three; in light it sits
   * between the raised and sunk surfaces. */
  paper: string;
  /** The lightest surface in either scheme — cards, dialogs, the plan pane. */
  raised: string;
  /** Code blocks and the diff body: lifted off `paper` in dark, recessed in light. */
  sunk: string;
  /** Body copy, then secondary copy, then metadata. */
  ink: string;
  inkSoft: string;
  inkFaint: string;
  /** The scarce mark caret spends on the current selection. */
  accent: string;
  /** The accent's lighter sibling — hovers, and shiki's entity/constant role. */
  accentBright: string;
  /** Text painted on top of `accent`. */
  accentInk: string;
  /** A mid-tone neutral from the palette, used for the orphaned-comment mark. */
  neutral: string;
  ok: string;
  danger: string;
  /** The separate "look here" hue: the notification dot, the version-count badge.
   * Distinct from `accent`, which marks selection rather than novelty. */
  attention: string;
}

// caret-dark's and caret-light's shadows. Black alphas, so they carry no hue and
// transfer to any palette of the same scheme unchanged.
const SHADOW: Record<Scheme, string> = {
  dark: "0 1px 2px #00000066, 0 10px 30px #00000080",
  light: "0 1px 2px #0000000f, 0 8px 24px #00000014",
};

// How hard the derived washes sit. A light palette takes the softer set — the same
// asymmetry caret-light already has, where a tint over a bright surface needs less
// alpha to read than one over a dark surface.
const ALPHA: Record<Scheme, { wash: string; mark: string; markActive: string }> = {
  dark: { wash: "29", mark: "2e", markActive: "57" },
  light: { wash: "1f", mark: "24", markActive: "47" },
};

/** Expand a palette's decided colors into caret's full token set. */
export function paletteTheme(input: PaletteInput): Theme {
  const alpha = ALPHA[input.scheme];
  const tokens: Record<ColorToken, string> = {
    "--paper": input.paper,
    "--paper-raised": input.raised,
    "--paper-sunk": input.sunk,
    "--ink": input.ink,
    "--ink-soft": input.inkSoft,
    "--ink-faint": input.inkFaint,
    "--rule": `${input.ink}1a`,
    "--rule-strong": `${input.ink}29`,
    "--accent": input.accent,
    "--accent-bright": input.accentBright,
    "--accent-wash": `${input.accent}${alpha.wash}`,
    "--accent-ink": input.accentInk,
    "--mark": `${input.accent}${alpha.mark}`,
    "--mark-active": `${input.accent}${alpha.markActive}`,
    "--mark-orphan": `${input.neutral}29`,
    "--ok": input.ok,
    "--danger": input.danger,
    "--attention": input.attention,
    "--shadow-card": SHADOW[input.scheme],
  };
  return { id: input.id, label: input.label, scheme: input.scheme, tokens };
}

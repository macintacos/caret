// The shared shape every palette is mapped through (EXC-752), caret's own two
// (./caret.ts) included: name the thirteen colors a palette actually decides, and
// the seven that are always derived (the two rules, the accent wash, the two marks,
// the orphan mark, the shadow) come out consistent for every theme instead of being
// re-typed once per palette.
//
// The alpha suffixes and the two shadows are caret-dark's and caret-light's own
// values, so a vendor theme's hairlines and highlight marks sit at exactly the
// weight caret's chrome was designed around — only the hue changes. A palette that
// wants a derived wash on some other hue says so through the three optional
// overrides below rather than by writing its tokens out by hand.

import type { ColorToken, Scheme, Theme, ThemeId } from "$lib/theme.ts";
import type { UpstreamShikiThemeId } from "$lib/upstream-shiki.ts";

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

  // Hue overrides. A derived wash normally rides the color it belongs to; these
  // three name a different hue for the cases where a palette decides one
  // separately, so the weight still comes from the recipe and only the hue moves.

  /** The hue the two hairline rules ride. Defaults to `ink` — caret-dark rides
   * pure white instead, so its hairlines stay neutral on near-black paper. */
  ruleHue?: string;
  /** The hue `--accent-wash` rides. Defaults to `accent`. */
  washHue?: string;
  /** The hue the two marks ride. Falls back to `washHue`, then `accent`, so a
   * palette whose marks and wash share a hue declares it once. */
  markHue?: string;

  /** The vendor's own published shiki theme, when there is one (EXC-896). A
   * palette that names one highlights code with it; one that names none — caret's
   * own pair — gets the seven-role derivation in caret-theme.ts instead. */
  shikiTheme?: UpstreamShikiThemeId;
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
  const ruleHue = input.ruleHue ?? input.ink;
  const washHue = input.washHue ?? input.accent;
  const markHue = input.markHue ?? washHue;
  const tokens: Record<ColorToken, string> = {
    "--paper": input.paper,
    "--paper-raised": input.raised,
    "--paper-sunk": input.sunk,
    "--ink": input.ink,
    "--ink-soft": input.inkSoft,
    "--ink-faint": input.inkFaint,
    "--rule": `${ruleHue}1a`,
    "--rule-strong": `${ruleHue}29`,
    "--accent": input.accent,
    "--accent-bright": input.accentBright,
    "--accent-wash": `${washHue}${alpha.wash}`,
    "--accent-ink": input.accentInk,
    "--mark": `${markHue}${alpha.mark}`,
    "--mark-active": `${markHue}${alpha.markActive}`,
    "--mark-orphan": `${input.neutral}29`,
    "--ok": input.ok,
    "--danger": input.danger,
    "--attention": input.attention,
    "--shadow-card": SHADOW[input.scheme],
  };
  return {
    id: input.id,
    label: input.label,
    scheme: input.scheme,
    tokens,
    shikiTheme: input.shikiTheme,
  };
}

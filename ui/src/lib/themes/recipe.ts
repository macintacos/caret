// The shared shape every theme file's palette is mapped through (EXC-752): name the
// thirteen colors a palette actually decides, and the sixteen that are always derived
// (the two rules, the accent wash, the three marks and the text on the search's two, the
// orphan mark, the six chip tints, the shadow) come out consistent for every theme
// instead of being re-typed once per palette.
//
// The alpha suffixes and the two shadows are caret-dark's and caret-light's own
// values, so a vendor theme's hairlines and highlight marks sit at exactly the
// weight caret's chrome was designed around — only the hue changes. A palette that
// wants a derived wash on some other hue says so through the nine optional
// overrides below rather than by writing its tokens out by hand.

import type { ColorToken, Scheme } from "$lib/theme.ts";

/** The colors a palette decides for itself. Every other token is derived from these
 * by `paletteTokens`. */
export interface PaletteInput {
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
  /** The accent's hover step, a shade further from `paper` — hovers, and shiki's
   * entity/constant role. */
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
  // nine name a different hue for the cases where a palette decides one separately,
  // so the weight still comes from the recipe and only the hue moves.

  /** The hue the two hairline rules ride. Defaults to `ink` — caret's own pair
   * rides a warmer neutral instead, so its hairlines carry the paper's cast
   * rather than the ink's. */
  ruleHue?: string;
  /** The hue `--accent-wash` rides. Defaults to `accent`. */
  washHue?: string;
  /** The hue the two marks ride. Falls back to `washHue`, then `accent`, so a
   * palette whose marks and wash share a hue declares it once. */
  markHue?: string;

  // The six plan-view chip tints ride the hues named at their derivation below.

  /** The hue `--chip-bold` rides. Defaults to `ink`. */
  chipBoldHue?: string;
  /** The hue `--chip-italic` rides. Defaults to `inkSoft`. */
  chipItalicHue?: string;
  /** The hue `--chip-code` rides. Defaults to `neutral`. */
  chipCodeHue?: string;
  /** The hue `--chip-link` rides. Defaults to `accentBright`. */
  chipLinkHue?: string;
  /** The hue `--chip-ref` rides. Defaults to `ok`. */
  chipRefHue?: string;
  /** The hue `--chip-skill` rides. Defaults to `attention`. */
  chipSkillHue?: string;
}

// caret-dark's and caret-light's shadows. Black alphas, so they carry no hue and
// transfer to any palette of the same scheme unchanged.
const SHADOW: Record<Scheme, string> = {
  dark: "0 1px 2px #00000066, 0 10px 30px #00000080",
  light: "0 1px 2px #0000000f, 0 8px 24px #00000014",
};

// How hard the derived washes sit. A light palette takes the softer set — the same
// asymmetry caret-light already has, where a tint over a bright surface needs less
// alpha to read than one over a dark surface. `chip` sits below the selection wash
// on purpose: one wash marks one row, while a paragraph can carry a dozen chips.
// `match`, every `/` search hit, sits a step over `mark`, which a comment span wears.
const ALPHA: Record<Scheme, { wash: string; mark: string; match: string; chip: string }> = {
  dark: { wash: "29", mark: "2e", match: "5c", chip: "24" },
  light: { wash: "1f", mark: "24", match: "5c", chip: "1c" },
};

const channels = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));

function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = channels(hex).map((c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi = 0, lo = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `hue` laid over `ground` at `alpha` (0–1), as the browser composites it. */
function over(hue: string, alpha: number, ground: string): string {
  const g = channels(ground);
  const mixed = channels(hue).map((c, i) => Math.round(c * alpha + (g[i] ?? 0) * (1 - alpha)));
  return `#${mixed.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** `ink`, stepped toward white if it is lighter than `ground` or black if darker, only as
 * far as it takes for `holds` to pass. */
function legibleInk(ink: string, ground: string, holds: (text: string) => boolean): string {
  const extreme = luminance(ink) > luminance(ground) ? "#ffffff" : "#000000";
  let step = 0;
  const stepped = () => over(extreme, step / 20, ink);
  while (step < 20 && !holds(stepped())) step++;
  return stepped();
}

/** Expand a palette's decided colors into caret's full token set. */
export function paletteTokens(input: PaletteInput): Record<ColorToken, string> {
  const alpha = ALPHA[input.scheme];
  const ruleHue = input.ruleHue ?? input.ink;
  const washHue = input.washHue ?? input.accent;
  const markHue = input.markHue ?? washHue;
  const chipHues = {
    bold: input.chipBoldHue ?? input.ink,
    italic: input.chipItalicHue ?? input.inkSoft,
    code: input.chipCodeHue ?? input.neutral,
    link: input.chipLinkHue ?? input.accentBright,
    ref: input.chipRefHue ?? input.ok,
  };
  // The source view sets a match on either paper or a code or table card's floor, under up
  // to 9% `--ink` of the cursor's or the pointer's band and any chip, or on a table header's
  // pad, lit toward its top. The card floor, `--body` and `--pad-top` follow derived.css,
  // mixed here in sRGB rather than lab.
  const dark = input.scheme === "dark";
  const body = dark ? over(input.ink, 0.07, input.raised) : over(input.ink, 0.05, input.sunk);
  const cardFloor = dark ? over("#000000", 0.25, input.sunk) : over(input.ink, 0.03, input.sunk);
  const headPad = dark ? over(input.ink, 0.07, body) : over(input.raised, 0.6, body);
  const matchGrounds = [input.paper, input.sunk, cardFloor]
    .flatMap((floor) => [floor, over(input.ink, 0.09, floor)])
    .flatMap((ground) => [
      ground,
      ...Object.values(chipHues).map((hue) =>
        over(hue, Number.parseInt(alpha.chip, 16) / 255, ground),
      ),
    ])
    .concat(body, headPad)
    .map((ground) => over(markHue, Number.parseInt(alpha.match, 16) / 255, ground));
  // The preview lays its bands over the current match and its text alike: a held
  // selection's wash, then up to 9% `--ink` of the cursor's or the pointer's band.
  const underBands = (color: string) =>
    [color, over(washHue, Number.parseInt(alpha.wash, 16) / 255, color)].flatMap((c) => [
      c,
      over(input.ink, 0.09, c),
    ]);
  const onActive = (text: string, mark: string) => {
    const marks = underBands(mark);
    return Math.min(...underBands(text).map((t, i) => contrast(t, marks[i] ?? mark)));
  };
  const activeInk = [input.ink, input.paper, input.raised, input.sunk].reduce((a, b) =>
    onActive(b, markHue) > onActive(a, markHue) ? b : a,
  );
  // Where not even white or black text holds under the bands, the mark steps away from it.
  const activeMark = legibleInk(
    markHue,
    activeInk,
    (mark) => onActive(luminance(activeInk) > luminance(mark) ? "#ffffff" : "#000000", mark) >= 4.5,
  );
  return {
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
    // The `/` search: every match a wash a step over `--mark`, and the current one the
    // mark itself, opaque, so it leads whatever band it lands on.
    "--mark-match": `${markHue}${alpha.match}`,
    "--mark-match-ink": legibleInk(input.ink, input.paper, (text) =>
      matchGrounds.every((ground) => contrast(text, ground) >= 4.5),
    ),
    "--mark-active": activeMark,
    "--mark-active-ink": legibleInk(
      activeInk,
      activeMark,
      (text) => onActive(text, activeMark) >= 4.5,
    ),
    "--mark-orphan": `${input.neutral}29`,
    // Of the five below only two carry hue — `accentBright` for a link and `ok` for
    // a resolved reference — which is what keeps a paragraph holding several of them
    // quiet. `accent` stays reserved for selection and brand, `danger` stays
    // semantic, and `attention` is the trap: Catppuccin draws it eleven degrees from
    // `accentBright`, so a link and a reference would be one chip across four
    // flavors. The other three ride the neutral ramp and are told apart by weight,
    // slant and the mono family (EXC-867), not by tint — in most palettes bold and
    // italic composite within a 1.05 contrast ratio. theme.test.ts pins the separations
    // and carries the full account.
    "--chip-bold": `${chipHues.bold}${alpha.chip}`,
    "--chip-italic": `${chipHues.italic}${alpha.chip}`,
    "--chip-code": `${chipHues.code}${alpha.chip}`,
    "--chip-link": `${chipHues.link}${alpha.chip}`,
    "--chip-ref": `${chipHues.ref}${alpha.chip}`,
    // A skill chip and a path chip share a sentence in the feedback editors
    // (EXC-1186), so this has to separate from `--chip-ref` the way a link does, and
    // `attention` is what is left. Its closeness to `accentBright` costs a link and a
    // skill some distance, which no surface pairs.
    "--chip-skill": `${input.chipSkillHue ?? input.attention}${alpha.chip}`,
    "--ok": input.ok,
    "--danger": input.danger,
    "--attention": input.attention,
    "--shadow-card": SHADOW[input.scheme],
  };
}

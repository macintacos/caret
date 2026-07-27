// caret's own two palettes — the reference every other theme is mapped against, and the
// only pair that names its colors instead of transcribing a vendor's. caret-dark is also
// the source ui/generate-palette-css.ts emits as app.css's static first-paint fallback.
//
// The direction is earth pigment (EXC-902). caret's token vocabulary is paper, ink, rule,
// and mark — a proofing desk — so the palette is the pigment set that desk would hold,
// and dark mode's page is a dark PAPER rather than a neutral void. Nothing runs at full
// chroma, and that restraint is what lets twenty-seven colors read as one page rather
// than a parade. The count is sized against Catppuccin's 26 per flavor — a count, not a
// source of hues.

import type { AuthoredShikiThemeId } from "$lib/authored-shiki.ts";
import type { Scheme, Theme, ThemeId } from "$lib/theme.ts";
import { paletteTheme } from "$lib/themes/recipe.ts";

/** Every color caret's own palettes name: the thirteen `PaletteInput` values, the three
 * hues the recipe's derived washes ride, and the syntax half only the highlighter
 * spends. Exported because the authored shiki themes (authored-shiki.ts) read the last
 * group out of it — nothing else in the UI reaches past `Theme.tokens`. */
export interface CaretPalette {
  // The three surfaces. Dark is kraft: the page darkest, the plan document a step up, the
  // chrome a step above that. Light is oat — a warm limestone rather than a cool grey, so
  // it reads as caret-dark's sibling (EXC-776); theme.test.ts pins R > B on every light
  // neutral that reaches a token. `PaletteInput` documents what each surface carries; what
  // matters here is that `sunk` is the plan document, and so the surface every syntax hue
  // below is measured on.
  paper: string;
  raised: string;
  sunk: string;

  // The ink ramp: body copy, then secondary copy, then metadata. The rungs clear WCAG AA
  // (AA-large for the faintest) on both chrome surfaces, not just the page, because
  // dialogs and dropdowns sit on the raised one.
  ink: string;
  inkSoft: string;
  inkFaint: string;

  // The accent trio — carrot, the pigment the rest of the chrome's prose calls amber, and
  // the scarce mark caret spends on the current selection. The syntax half carries its own
  // sienna and ochre, so the authored themes (authored-shiki.ts) spend the accent only on
  // a markdown heading rather than on every keyword.
  accent: string;
  accentBright: string;
  accentInk: string;

  // Hue overrides: a hue the recipe's derived washes ride instead of the token they would
  // otherwise default to. The rules ride bone (dark) and a warm umber (light) rather than
  // the ink, because a pure-white hairline on brown paper reads cold; the accent wash
  // rides an ember that is deliberately not the accent; the marks ride a lighter amber
  // than the wash, so a highlight sits above the wash it overlaps.
  ruleHue: string;
  washHue: string;
  markHue: string;

  // The mid-tone neutral behind the orphaned-comment mark.
  neutral: string;

  // The semantic trio — three different pigments rather than three tints of one. `ok` is
  // carrot-top, the green above the root, and it cascades into the diff addition tint.
  // `danger` is madder, pulled to the blue side of red so a deletion never reads as an
  // orange mark. `attention` is thistle — the "look here" hue for novelty, a different job
  // from selection, and the far side of the wheel from both.
  ok: string;
  danger: string;
  attention: string;

  // The syntax half — shiki-only, and measured against `sunk`. Eleven hues, because the
  // authored themes must tell a type from a function, a number from a string escape, and
  // an attribute from a property; those three pairs are the ones held apart by hue, never
  // under 157 degrees in either scheme.
  //
  // Three pigments are each spent twice, at different value: thistle on keyword and
  // attention, madder on escape and danger, terre verte on string and ok. Keyword and
  // attention split cleanly across code and chrome. The other two meet on the diff surface,
  // where --ok / --danger reach the code rows as the line tint and gutter bar
  // (styles/diffview.css) — there the chrome hue is a low-alpha wash UNDER text and the
  // syntax hue is the text, so the two never compete as foregrounds.
  keyword: string;
  type: string;
  func: string;
  variable: string;
  property: string;
  attribute: string;
  string: string;
  escape: string;
  number: string;
  comment: string;
  punctuation: string;
}

export const CARET_DARK: CaretPalette = {
  paper: "#0a0806", // kraft — the darkest stock, and what accentInk paints back onto
  raised: "#15110d", // kraft, two steps up: chrome, cards, dialogs, dropdowns
  sunk: "#100d0a", // kraft, one step up: the code body lifts off the page
  ink: "#f7f2ea", // parchment
  inkSoft: "#bcb0a1", // parchment, half-tone
  inkFaint: "#918576", // parchment, quarter-tone
  accent: "#ff8f3d", // carrot
  accentBright: "#ffb277", // carrot, lifted
  accentInk: "#0a0806", // the page, painted back onto the accent
  ruleHue: "#f2e7d5", // bone — a white hairline on brown paper reads cold
  washHue: "#f2842f", // ember, a shade off the accent so the wash is its own color
  markHue: "#ffa64d", // amber, a step above the wash so a mark reads over it
  neutral: "#9a8c7e", // dust
  ok: "#5fc464", // carrot-top
  danger: "#f0697a", // madder
  attention: "#bb92e6", // thistle
  keyword: "#b982e8", // thistle, deepened — the spine of a statement
  type: "#7fc0dc", // woad, the cool anchor
  func: "#e2bd6a", // ochre
  variable: "#ece2d4", // bone, barely off the ink — identifiers keep the page calm
  property: "#aecada", // flax — keys read as pale types
  attribute: "#f08a5e", // sienna
  string: "#8ec97e", // terre verte, lighter and a shade yellower than carrot-top
  escape: "#f78a94", // madder, lifted — an escape has to break its string
  number: "#5fcabb", // verdigris
  comment: "#7f7466", // umber — the pencil note, held to the large-text floor
  punctuation: "#a89a90", // stone
};

export const CARET_LIGHT: CaretPalette = {
  paper: "#fefcf8", // oat
  raised: "#fffefc", // oat, bleached
  sunk: "#faf6ec", // oat, recessed: light inverts the surface order dark uses
  ink: "#191310", // umber, near-black
  inkSoft: "#544b43", // umber, half-tone
  inkFaint: "#847a70", // umber, quarter-tone
  accent: "#c2490d", // burnt carrot — the light scheme takes the accent deeper
  accentBright: "#e06a24", // burnt carrot, lifted
  accentInk: "#fff6ec", // oat, bleached warmer
  ruleHue: "#2a2018", // umber — a warmer red/blue ratio than the ink, at the same weight
  washHue: "#e07a2e", // ember
  markHue: "#e8882e", // amber
  neutral: "#7a6f63", // dust
  ok: "#2f7d3a", // carrot-top
  danger: "#b8323f", // madder
  attention: "#7440b5", // thistle
  keyword: "#6a37a0", // thistle, deepened
  type: "#26648c", // woad
  func: "#7d5a05", // ochre
  variable: "#2a221c", // umber, barely off the ink
  property: "#456075", // flax
  attribute: "#984314", // sienna
  string: "#3d7040", // terre verte
  escape: "#ad2f3f", // madder, deepened
  number: "#0d6d66", // verdigris
  comment: "#8a7d6d", // umber, recessive
  punctuation: "#665b52", // stone
};

/** Where a named color lands downstream. `token` is one the chrome reads through
 * `var(--x)` on a surface; `derived` is one that reaches the page only as a mix — a
 * wash, a hairline, a hover step; `shiki-only` is one that nothing but code
 * highlighting spends. */
export type ColorPlacement = "token" | "derived" | "shiki-only";

/** Every color's placement, so EXC-903 (authored shiki themes) and EXC-904 (the
 * `ColorToken` plumbing) each know which half of the set is theirs.
 *
 * `Record<keyof CaretPalette, ColorPlacement>` is the point: a color with no placement,
 * or a placement for no color, is a compile error rather than something a runtime test
 * has to re-check. */
export const CARET_COLOR_PLACEMENT: Record<keyof CaretPalette, ColorPlacement> = {
  paper: "token",
  raised: "token",
  sunk: "token",
  ink: "token",
  inkSoft: "token",
  inkFaint: "token",
  accent: "token",
  accentBright: "token",
  accentInk: "token",
  // Four hues, not colors the chrome can read: each reaches the page only through an
  // alpha the recipe applies (--rule, --accent-wash, --mark, --mark-orphan). `neutral`
  // belongs here for the same reason as the three overrides — there is no --neutral in
  // ColorToken, and its one path to a surface is the orphaned-comment mark's 29 alpha.
  ruleHue: "derived",
  washHue: "derived",
  markHue: "derived",
  neutral: "derived",
  ok: "token",
  danger: "token",
  attention: "token",
  keyword: "shiki-only",
  type: "shiki-only",
  func: "shiki-only",
  variable: "shiki-only",
  property: "shiki-only",
  attribute: "shiki-only",
  string: "shiki-only",
  escape: "shiki-only",
  number: "shiki-only",
  comment: "shiki-only",
  punctuation: "shiki-only",
};

/** Read one palette's sixteen chrome colors out of its record and through the recipe.
 * The syntax half is not passed: `paletteTheme` has nowhere to put it, and the authored
 * shiki themes (authored-shiki.ts) read it from the record directly.
 *
 * @param id - caret's palettes and its authored shiki themes spell their ids
 * identically, so the one string names both. The intersection makes that identity a
 * compile error to break rather than a coincidence to rely on — the same shape
 * catppuccin.ts's `flavor` uses for the vendor half. */
function caretTheme(
  id: ThemeId & AuthoredShikiThemeId,
  label: string,
  scheme: Scheme,
  p: CaretPalette,
): Theme {
  return paletteTheme({
    id,
    label,
    scheme,
    shikiTheme: id,
    paper: p.paper,
    raised: p.raised,
    sunk: p.sunk,
    ink: p.ink,
    inkSoft: p.inkSoft,
    inkFaint: p.inkFaint,
    accent: p.accent,
    accentBright: p.accentBright,
    accentInk: p.accentInk,
    neutral: p.neutral,
    ok: p.ok,
    danger: p.danger,
    attention: p.attention,
    ruleHue: p.ruleHue,
    washHue: p.washHue,
    markHue: p.markHue,
  });
}

export const caretDark = caretTheme("caret-dark", "caret dark", "dark", CARET_DARK);
export const caretLight = caretTheme("caret-light", "caret light", "light", CARET_LIGHT);

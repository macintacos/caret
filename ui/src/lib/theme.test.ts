import "@ui/support/setup.ts";
import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { BUILTIN_THEME_IDS } from "@core/theme/builtin-ids.ts";
import { HEADING_LEVELS, ROLE_SCOPES } from "@core/theme/role-scopes.ts";
import type { MarkdownElement, RoleStyle, SyntaxRole } from "@core/theme/schema.ts";
import { customThemeFile, readThemeFile, themeFileColors } from "@ui/support/theme-file.ts";
import { readAppCss } from "$lib/appCss.ts";
import { shikiThemeName } from "$lib/caret-theme.ts";
import { QUOTE_SUBDUE } from "$lib/diffview/coreStyles.ts";
import {
  addTheme,
  type BuiltinThemeId,
  type ColorToken,
  isBuiltinThemeId,
  isCustomThemeId,
  paintPalette,
  paintTheme,
  type RuntimeTheme,
  replaceTheme,
  type Scheme,
  THEME_IDS,
  THEMES,
  type ThemeId,
  themeFor,
  themesForScheme,
} from "$lib/theme.ts";

afterEach(() => {
  // Strip any inline vars/attrs a prior paintTheme wrote onto the root.
  document.documentElement.removeAttribute("style");
  document.documentElement.removeAttribute("data-theme");
});

/** A color's three channels as 0–1 sRGB. One parse for every measurement below, so
 * they cannot disagree about what a malformed value is. An alpha suffix is ignored:
 * a wash and the hue it rides differ only in alpha, so a derived token measures the
 * same as the color it was mixed from. */
function channels(hex: string): [number, number, number] {
  const rgb = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex);
  if (rgb === null) throw new Error(`expected #rrggbb, got ${hex}`);
  return rgb.slice(1, 4).map((pair) => Number.parseInt(pair, 16) / 255) as [number, number, number];
}

// WCAG relative luminance, so "is this palette legible" is arithmetic rather than
// a judgement call.
function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  ) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** A color's HSL hue angle in degrees, so "are these two chips the same color" is
 * arithmetic too. An achromatic input has no angle and answers 0. */
function hue(hex: string): number {
  const [r, g, b] = channels(hex);
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  if (delta === 0) return 0;
  const sextant =
    max === r ? (g - b) / delta : max === g ? 2 + (b - r) / delta : 4 + (r - g) / delta;
  return (((sextant * 60) % 360) + 360) % 360;
}

/** A color's HSL saturation, 0–1. What tells a HUED token from a NEUTRAL one, which the
 * angle above cannot: a NEAR-neutral's angle is whatever faint cast its gray happens to
 * carry, so two grays can read as identical while measuring 200 degrees apart. (A truly
 * achromatic color has no angle at all and answers 0, as hue() documents.) */
function saturation(hex: string): number {
  const [r, g, b] = channels(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  return (max - min) / (1 - Math.abs(max + min - 1));
}

/** The WCAG contrast ratio between two solid colors, lighter over darker. */
function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** A row of the diff surface: `bg` banded with `pct` of `ink`, the shape
 * `color-mix(in lab, --paper-sunk, --ink N%)` paints for the cursor and hover bands.
 * This is the ground every plan-view decoration is really drawn on, as distinct from
 * the two CHROME surfaces the ink-ramp case measures.
 *
 * Mixed in sRGB rather than in lab: the two differ by well under the headroom these
 * floors are measured with, and matching the browser's space exactly would mean
 * carrying a lab implementation to pin ratios that clear by more than a point. */
function banded(bg: string, ink: string, pct: number): string {
  const [br, bg_, bb] = channels(bg);
  const [ir, ig, ib] = channels(ink);
  const mix = (b: number, i: number) => b * (1 - pct) + i * pct;
  return `#${[mix(br, ir), mix(bg_, ig), mix(bb, ib)]
    .map((c) =>
      Math.round(c * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/** The bands a plan-view row is drawn over: the bare surface, the hover/cursor tint,
 * and the widest band, which is the darkest ground any decoration sits on. */
const ROW_BANDS = [0, 0.02, 0.08] as const;

/** The table card's own fill (EXC-1136), quoted from the code card:
 * `color-mix(in lab, var(--paper-sunk), var(--ink) 6%)`. A table's marks are drawn on
 * THIS rather than on the bare surface, so it joins the grounds they are measured over. */
const TABLE_CARD_FILL = 0.06;

/** The grounds a table's rules are drawn on — NOT the row bands verbatim. A carded table
 * never sits on bare --paper-sunk: an unbanded row is cleared to transparent and shows
 * the card's own fill, and a banded one paints its band in place of it. So the bare
 * surface drops out and the fill takes its place, leaving the resting panel and the two
 * banded cases a row can be in. A 0 here would measure a ground that only exists outside
 * the card, and the LIGHTEST one — quietly setting the top of the spread the rules case
 * checks. */
const TABLE_GROUNDS = [0.02, TABLE_CARD_FILL, 0.08] as const;

/** The declarations a scheme resolves across the flat sheet, in cascade order: the
 * derived tier's `:root, [data-theme]` block, which carries dark's recipe, and the
 * blocks keyed on the scheme's own `[data-theme="…"]`. */
function schemeDecls(scheme: Scheme): Record<string, string> {
  const selector = `[data-theme="${scheme}"]`;
  const decls: Record<string, string> = {};
  for (const block of readAppCss()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("}")) {
    const [head = "", body] = block.split("{");
    if (body === undefined || !(head.includes(selector) || /\[data-theme\]\s*$/.test(head))) {
      continue;
    }
    for (const d of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) decls[d[1]!] = d[2]!.trim();
  }
  return decls;
}

/** A saved comment's state stamp (SourceAnnotationCard.svelte), per scheme, read from
 * the sheet: its floor is the well floor (styles/derived.css) tinted --stamp-floor
 * toward the state's hue, and its word is that hue mixed --stamp-word-mix toward
 * --stamp-word-toward (styles/tokens.css). */
function stampRecipe(scheme: Scheme) {
  const decls = schemeDecls(scheme);
  const well = /color-mix\(in lab, var\(--paper-raised\), (black|var\(--ink\)) (\d+)%\)/.exec(
    decls["--well-floor"] ?? "",
  );
  const toward = (c: string) =>
    c === "black" ? "#000000" : c.replace(/^var\((--[\w-]+)\)$/, "$1");
  const pct = (v: string | undefined) => Number.parseFloat(v ?? "NaN") / 100;
  return {
    wellToward: toward(well?.[1] ?? ""),
    well: pct(well?.[2]),
    floor: pct(decls["--stamp-floor"]),
    inkToward: toward(decls["--stamp-word-toward"] ?? ""),
    ink: pct(decls["--stamp-word-mix"]),
  };
}

const themeEntries = () =>
  Object.entries(THEMES) as [BuiltinThemeId, (typeof THEMES)[BuiltinThemeId]][];

/** A color's CIELAB coordinates (D65), so "can a reader tell these two apart" weighs
 * lightness alongside hue, as the eye does. */
function lab(hex: string): [number, number, number] {
  const linear = channels(hex).map((c) =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  const [r, g, b] = linear as [number, number, number];
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const fx = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const fy = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const fz = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** The CIE76 distance between two colors. */
function deltaE(a: string, b: string): number {
  const [p, q] = [lab(a), lab(b)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/** The shorter way round the hue circle between two colors, in degrees. */
function hueGap(a: string, b: string): number {
  const gap = Math.abs(hue(a) - hue(b));
  return Math.min(gap, 360 - gap);
}

/** A translucent token composited over `ground`, as the browser paints it. */
function over(fg: string, ground: string): string {
  const alpha = /^#[0-9a-f]{6}([0-9a-f]{2})$/i.exec(fg)?.[1];
  return banded(ground, fg.slice(0, 7), alpha === undefined ? 1 : Number.parseInt(alpha, 16) / 255);
}

describe("THEMES", () => {
  test("THEME_IDS lists caret's palettes first, then each vendor family", () => {
    expect(THEME_IDS).toEqual([
      "caret-dark",
      "caret-light",
      "catppuccin-latte",
      "catppuccin-frappe",
      "catppuccin-macchiato",
      "catppuccin-mocha",
      "dracula",
      "github-light",
      "github-dark",
      "dawnfox",
      "duskfox",
    ]);
  });

  test("the daemon's built-in id list matches THEME_IDS", () => {
    expect(new Set(BUILTIN_THEME_IDS)).toEqual(new Set(THEME_IDS));
    expect(BUILTIN_THEME_IDS.length).toBe(THEME_IDS.length);
  });

  test("every theme carries a human label and a scheme matching its id", () => {
    expect(THEMES["caret-dark"].label).toBe("caret dark");
    expect(THEMES["caret-dark"].scheme).toBe("dark");
    expect(THEMES["caret-light"].label).toBe("caret light");
    expect(THEMES["caret-light"].scheme).toBe("light");
  });

  test("both themes define an identical token key set", () => {
    const dark = Object.keys(THEMES["caret-dark"].tokens).sort();
    const light = Object.keys(THEMES["caret-light"].tokens).sort();
    expect(light).toEqual(dark);
  });

  test("light and dark do not collapse to the same values", () => {
    expect(THEMES["caret-light"].tokens["--paper"]).not.toBe(
      THEMES["caret-dark"].tokens["--paper"],
    );
  });

  // EXC-776: the light theme's neutral surfaces, ink, and rules must lean warm
  // (brown-ish), a sibling to caret-dark, rather than a cool pure grey. A pure grey
  // has R === B; warm means R > B. Only the neutral tokens are held to this — the
  // accent and semantic hues carry their own color on purpose. The alpha rule/mark
  // tokens are `#rrggbbaa`, so the alpha tail is optional.
  test("caret-light neutral greys lean warm (red channel exceeds blue)", () => {
    const NEUTRALS: ColorToken[] = [
      "--paper",
      "--paper-raised",
      "--paper-sunk",
      "--ink",
      "--ink-soft",
      "--ink-faint",
      "--rule",
      "--rule-strong",
      "--mark-orphan",
      "--chip-bold",
      "--chip-italic",
      "--chip-code",
    ];
    const tokens = THEMES["caret-light"].tokens;
    for (const token of NEUTRALS) {
      const hex = tokens[token];
      const rgb = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})(?:[0-9a-f]{2})?$/i.exec(hex);
      expect(rgb, `${token} should be #rrggbb or #rrggbbaa, got ${hex}`).not.toBeNull();
      const [, r, , b] = rgb!;
      expect(
        Number.parseInt(r!, 16),
        `${token} (${hex}) red channel must exceed blue (warm, not cool)`,
      ).toBeGreaterThan(Number.parseInt(b!, 16));
    }
  });

  // Neither caret palette has a CSS mirror — app.css's first-paint block is emitted
  // from this record — so each pins its whole token set directly, and nothing else
  // in the repo pins their decided colors. The eleven derived values come out of the
  // recipe's hue fallbacks; the thirteen decided ones are read from the palette in
  // themes/caret-{dark,light}.json, so this pin is what catches a slip in the file or the
  // recipe. The three hue overrides are subsumed: each rides a hue that is NOT the
  // token it would otherwise default to — the rules ride bone in dark and a warmer
  // umber than the ink in light, the accent wash an ember that is not --accent, the
  // marks a lighter amber than the wash's — so a dropped or mis-cascaded override
  // surfaces as a changed byte rather than a subtly-off hairline.
  test("caret-dark's full token set", () => {
    expect(THEMES["caret-dark"].tokens).toEqual({
      "--paper": "#0a0806",
      "--paper-raised": "#15110d",
      "--paper-sunk": "#100d0a",
      "--ink": "#f7f2ea",
      "--ink-soft": "#bcb0a1",
      "--ink-faint": "#918576",
      "--rule": "#f2e7d51a",
      "--rule-strong": "#f2e7d529",
      "--accent": "#ff8f3d",
      "--accent-bright": "#ffb277",
      "--accent-wash": "#f2842f29",
      "--accent-ink": "#0a0806",
      "--mark": "#ffa64d2e",
      "--mark-active": "#ffa64d57",
      "--mark-orphan": "#9a8c7e29",
      "--chip-bold": "#f7f2ea24",
      "--chip-italic": "#bcb0a124",
      "--chip-code": "#9a8c7e24",
      "--chip-link": "#f56f8e24",
      "--chip-ref": "#4ed05624",
      "--chip-skill": "#6ec4e424",
      "--ok": "#4ed056",
      "--danger": "#f65a6f",
      "--attention": "#3fbda9",
      "--shadow-card": "0 1px 2px #00000066, 0 10px 30px #00000080",
    });
  });

  test("caret-light's full token set", () => {
    expect(THEMES["caret-light"].tokens).toEqual({
      "--paper": "#fefcf8",
      "--paper-raised": "#fffefc",
      "--paper-sunk": "#faf6ec",
      "--ink": "#191310",
      "--ink-soft": "#544b43",
      "--ink-faint": "#786f65",
      "--rule": "#2a20181a",
      "--rule-strong": "#2a201829",
      "--accent": "#c2490d",
      "--accent-bright": "#9f3c0b",
      "--accent-wash": "#e07a2e1f",
      "--accent-ink": "#fff6ec",
      "--mark": "#e8882e24",
      "--mark-active": "#e8882e47",
      "--mark-orphan": "#7a6f6329",
      "--chip-bold": "#1913101c",
      "--chip-italic": "#544b431c",
      "--chip-code": "#7a6f631c",
      "--chip-link": "#ab1f431c",
      "--chip-ref": "#1d802a1c",
      "--chip-skill": "#145d8f1c",
      "--ok": "#1d802a",
      "--danger": "#c11f30",
      "--attention": "#0a5f57",
      "--shadow-card": "0 1px 2px #0000000f, 0 8px 24px #00000014",
    });
  });
});

// caret's own theme files' colors — the palette the thirteen decided tokens
// are read from, and the syntax roles caret's shiki themes spend. The token colors
// are already covered by the two full-token pins above and by the registry-wide
// invariants below; what those cannot reach is the syntax half, which never becomes a
// ColorToken and so never renders on a surface the other tests measure.
const CARET_RECORDS = [
  ["caret-dark", await themeFileColors("caret-dark.json")],
  ["caret-light", await themeFileColors("caret-light.json")],
] as const;
const SYNTAX_ROLES = Object.keys(ROLE_SCOPES) as SyntaxRole[];

describe("caret's theme file colors", () => {
  // The syntax hues render on --paper-sunk (the code body and the diff surface), which
  // is neither of the two chrome surfaces the ink-ramp floors are measured against — in
  // caret-dark it sits between them, in caret-light below both. So they get their own
  // floor on their own surface: WCAG AA, except the hues that recede on purpose, held to
  // the large-text floor instead. The exception list is named here rather than inferred,
  // so widening it is a visible decision.
  const RECESSIVE: SyntaxRole[] = ["comment"];

  test("clears caret's contrast floors for every syntax role, on --paper-sunk", () => {
    for (const [id, record] of CARET_RECORDS) {
      for (const role of SYNTAX_ROLES) {
        const ratio = contrast(record[role], record.sunk);
        if (RECESSIVE.includes(role)) {
          expect(ratio, `${id} ${role} on sunk (recessive)`).toBeGreaterThan(3);
        } else {
          expect(ratio, `${id} ${role} on sunk`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  // The registry-wide ink-ramp test holds --ink-faint to 3:1 so a vendor palette's own
  // metadata grey ships as drawn. caret's two palettes hold every text colour to 4.5:1,
  // and the bright accent too: it colours link hovers and code, and the primary action's
  // label sits on it on hover.
  test("clears the text floor for faint ink and both accents, on every surface", () => {
    for (const [id] of CARET_RECORDS) {
      const tokens = THEMES[id].tokens;
      for (const surface of ["--paper", "--paper-raised", "--paper-sunk"] as const) {
        for (const fg of ["--ink-faint", "--accent", "--accent-bright"] as const) {
          expect(
            contrast(tokens[fg], tokens[surface]),
            `${id} ${fg} on ${surface}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
      expect(
        contrast(tokens["--accent-ink"], tokens["--accent-bright"]),
        `${id} --accent-ink on --accent-bright`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});

// Registry-wide invariants: these run over every palette rather than the two named
// ones, so a theme added later is held to caret's structure — surface ordering, a
// legible ink ramp, and the shape the shiki resolver needs — the moment it lands.
describe("every theme", () => {
  test("keys itself by its own id and carries a label", () => {
    for (const [id, theme] of themeEntries()) {
      expect(theme.id, id).toBe(id);
      expect(theme.label.length, id).toBeGreaterThan(0);
    }
  });

  test("covers caret-dark's full token set", () => {
    const reference = Object.keys(THEMES["caret-dark"].tokens).sort();
    for (const [id, theme] of themeEntries()) {
      expect(Object.keys(theme.tokens).sort(), id).toEqual(reference);
    }
  });

  test("paints surfaces its declared scheme agrees with", () => {
    for (const [id, theme] of themeEntries()) {
      const paper = luminance(theme.tokens["--paper"]);
      const ink = luminance(theme.tokens["--ink"]);
      if (theme.scheme === "dark") expect(paper, id).toBeLessThan(ink);
      else expect(paper, id).toBeGreaterThan(ink);
    }
  });

  // --paper-raised is what lifts off the page: cards, dialogs, dropdowns, the plan
  // pane. It is the lightest of the three surfaces in either scheme. Where --paper
  // and --paper-sunk sit relative to each other is the palette's own call — caret-dark
  // lifts its sunk surface above the page because the page is nearly black, while
  // GitHub Dark recesses it below — so only the raised relation is pinned.
  test("keeps --paper-raised as the lightest surface", () => {
    for (const [id, theme] of themeEntries()) {
      const raised = luminance(theme.tokens["--paper-raised"]);
      expect(raised, `${id} --paper-raised vs --paper`).toBeGreaterThan(
        luminance(theme.tokens["--paper"]),
      );
      expect(raised, `${id} --paper-raised vs --paper-sunk`).toBeGreaterThan(
        luminance(theme.tokens["--paper-sunk"]),
      );
    }
  });

  // The ink ramp is body copy, secondary copy, and metadata — WCAG AA for the first
  // two, the large-text floor for the faintest. It is held to those floors on BOTH
  // chrome surfaces it actually renders on: the page and the raised surface every
  // dialog, dropdown, and card sits on (--card / --popover / --secondary all bridge
  // to --paper-raised). Measuring the page alone flatters a dark palette, whose page
  // is its darkest surface — and lets a flavor ship sub-AA settings rows.
  test("clears caret's contrast floors for the ink ramp, on every surface it renders on", () => {
    for (const [id, theme] of themeEntries()) {
      for (const surface of ["--paper", "--paper-raised"] as const) {
        const bg = theme.tokens[surface];
        expect(
          contrast(theme.tokens["--ink"], bg),
          `${id} --ink on ${surface}`,
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrast(theme.tokens["--ink-soft"], bg),
          `${id} --ink-soft on ${surface}`,
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrast(theme.tokens["--ink-faint"], bg),
          `${id} --ink-faint on ${surface}`,
        ).toBeGreaterThan(3);
      }
    }
  });

  // The file preview's close circle (EXC-1067) is a graphical object required to
  // understand the content in WCAG 1.4.11's own sense: it is a disc with its glyph
  // held back until hover, so its SHAPE and its fill are the whole control and 3:1
  // is the floor that binds. It renders on the preview panel's --paper, and it is
  // the one place the chrome spends --danger on something that is not a semantic
  // (doc/agents/svelte-rules.md § CSS-token discipline records the carve-out). A
  // palette whose red goes muddy against its page fails here rather than shipping a
  // close control a reader cannot find.
  test("keeps the preview's close circle findable on every palette", () => {
    for (const [id, theme] of themeEntries()) {
      expect(
        contrast(theme.tokens["--danger"], theme.tokens["--paper"]),
        `${id} --danger on --paper`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  // EXC-863 subdues a quoted line by fading its tokens with `opacity`, which no other
  // assertion in this file can see: opacity composites at paint time, so the ramp above
  // still measures the same solid tokens while what the reader gets is lighter. Quoted
  // prose is body copy — it is the plan text a reviewer is reading — so it is held to the
  // same AA floor as `--ink` itself, on the surface it actually renders on (the diff
  // surface binds --diffs-bg to --paper-sunk, styles/diffview.css).
  //
  // This is the constraint that sets QUOTE_SUBDUE, and it binds unevenly: `--ink` on sunk
  // has least headroom on catppuccin-latte (doc/agents/svelte-rules.md § CSS-token
  // discipline), so the fade a roomy palette could carry would push latte under. Adding a palette
  // with a compressed ink ramp fails HERE, which is the point — the alternative is
  // discovering it as unreadable quoted text in that flavor.
  test("keeps a subdued blockquote's ink at AA on every palette", () => {
    // What `opacity: QUOTE_SUBDUE` on a token composites to: the ink mixed toward the
    // surface behind it, in sRGB, which is how the browser composites an opacity group.
    const faded = (fg: string, bg: string): string => {
      const [fr, fg_, fb] = channels(fg);
      const [br, bg_, bb] = channels(bg);
      const mix = (f: number, b: number) => f * QUOTE_SUBDUE + b * (1 - QUOTE_SUBDUE);
      return `#${[mix(fr, br), mix(fg_, bg_), mix(fb, bb)]
        .map((c) =>
          Math.round(c * 255)
            .toString(16)
            .padStart(2, "0"),
        )
        .join("")}`;
    };
    for (const [id, theme] of themeEntries()) {
      const sunk = theme.tokens["--paper-sunk"];
      expect(
        contrast(faded(theme.tokens["--ink"], sunk), sunk),
        `${id} quoted --ink on --paper-sunk`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  // The plan view's REPLACEMENT markers: every decoration that takes its source character
  // to transparent and draws in the column it vacated. Nothing legible survives beside one,
  // so each is the only thing carrying what its marker used to say — which is precisely
  // WCAG 1.4.11's test for a graphical object required to understand the content, and puts
  // all three under its 3:1 floor. The ink-ramp case above cannot speak to them: it measures
  // --paper and --paper-raised, the two CHROME surfaces, while a marker renders on the diff
  // surface (--diffs-bg is --paper-sunk, styles/diffview.css) and on the 2-8% ink mixes the
  // row bands lay over it.
  //
  // That gap is why every member spends --ink-soft and not the --ink-faint markers take
  // generally. Falsifiable, and it really does bite: swap MARKER_INK to "--ink-faint" and
  // this reds on the FIRST band it reaches, catppuccin-latte at 2.99.
  // doc/agents/svelte-rules.md § CSS-token discipline carries the full ranges.
  //
  // The membership is closed by a rule rather than by inspection: a marker whose glyph
  // SURVIVES is supplementary and stays on --ink-faint (the fence markers, the ** / _
  // emphasis markers, an ordered item's number), and only a replaced marker appears here.
  // Two of the family are measured separately, one test down each, because neither paints
  // its token neat: the thematic break's can carry an alpha suffix that has to composite
  // first, and a table's rules soften theirs toward the surface, so measuring the token
  // would measure a color the sheet never paints.
  //
  // One assertion rather than one per member: all three draw in the same token. Which
  // SELECTORS spend it is coreStyles.test.ts's job. Neither file can catch a SEVENTH
  // replacement marker shipped on --ink-faint; that gap is real and named here rather
  // than papered over.
  /** Assert `paintOn(theme, ground)` clears the 3:1 non-text floor against every
   * row-banded ground, on every palette. */
  function expectAboveNonTextFloor(
    paintOn: (theme: (typeof THEMES)[BuiltinThemeId], ground: string) => string,
    label: string,
  ): void {
    for (const [id, theme] of themeEntries()) {
      const sunk = theme.tokens["--paper-sunk"];
      for (const pct of ROW_BANDS) {
        const ground = banded(sunk, theme.tokens["--ink"], pct);
        expect(
          contrast(paintOn(theme, ground), ground),
          `${id} ${label} on --paper-sunk banded ${pct * 100}%`,
        ).toBeGreaterThanOrEqual(3);
      }
    }
  }

  test("keeps every replacement marker above the non-text floor on every palette", () => {
    const MARKER_INK = "--ink-soft" as const;
    expectAboveNonTextFloor(
      (theme) => theme.tokens[MARKER_INK],
      `replacement marker ${MARKER_INK}`,
    );
  });

  // EXC-862 draws a thematic break as a full-width hairline and takes the source glyphs
  // to transparent, so the LINE is the only thing carrying "a section break sits here" —
  // no legible marker survives beside it to argue the decoration is ornamental. That is
  // what puts it under the same 3:1 non-text floor as the replacement family above rather
  // than among the faint supplementary markers, and on the same surface: the diff body is
  // --paper-sunk (styles/diffview.css) plus the row bands.
  //
  // Both tokens a divider suggests first fail there, which is the whole reason this case
  // exists. --rule and --rule-strong are 10% and 16% ink; composited over these grounds
  // they sit barely above the 1.05 this epic treats as indistinguishable, so the line
  // renders as nothing at all. --ink-faint, the marker ink, misses the floor on the
  // lightest palettes (doc/agents/svelte-rules.md § CSS-token discipline). Swap RULE_INK
  // to any of the three and this reds naming the palette.
  test("keeps the thematic-break rule above the non-text floor on every palette", () => {
    const RULE_INK = "--ink-soft" as const;
    // What the line PAINTS, not what its token names. channels() drops an alpha suffix
    // on purpose — a wash and its hue are one color for the angle tests — but a
    // translucent paint's contrast is the contrast of what lands on the ground, so it is
    // composited first. An opaque token passes through unchanged, which is why the
    // assertion can be written once for any candidate.
    expectAboveNonTextFloor(
      (theme, ground) => over(theme.tokens[RULE_INK], ground),
      `thematic-break rule ${RULE_INK}`,
    );
  });

  // The table's rules — the column dividers, the delimiter rule and the row hairlines —
  // are one mark declared once as --table-rule (diffview/coreStyles.ts).
  //
  // THIS CASE DELIBERATELY DOES NOT MEASURE 3:1, AND THAT IS THE POINT OF READING IT.
  // The rules are a design call (EXC-1136): a low-contrast style, closer to the surface
  // than to the ink, consistently on every palette. 1.4.11's non-text floor does not bind
  // them the way it binds a replacement decoration, because a table's columns are ALSO
  // carried by the layout — the cells are max-content tracks with the source's own spacing
  // between them — so a faint divider degrades the reading rather than removing it. A
  // table with no vertical rules at all is a normal, legible rendering; one with
  // unreadable TEXT is not, which is why the header case below still measures a real
  // floor.
  //
  // So what is pinned here is the style itself, in two halves:
  //
  //   PRESENT — every palette stays clear of its ground on every one of them. The floor is
  //   deliberately low: at a 12% step the mark IS at the edge of perceptibility on the
  //   lightest palettes (catppuccin-latte reaches ~1.05 on a hovered row, which the epic
  //   calls a line in the DOM and not on the screen), and that edge is the requested look
  //   rather than a defect. What this half still catches is the failure that would be a
  //   bug — a step that resolves to the same colour as the ground it is drawn on, which is
  //   what a palette bump or a changed card fill could silently produce.
  //
  //   CONSISTENT — the spread across palettes stays inside a narrow band, which is the
  //   property the design call actually asked for. Softening --ink-soft by a fixed amount
  //   would land in two different places on a light and a dark palette and need a
  //   light-dark() with two numbers; stating the colour the other way round — --paper-sunk
  //   stepped 12% toward --ink — makes one number land in the same place everywhere,
  //   because the operands flip with the scheme. Reintroduce a per-scheme arm and the
  //   spread widens and this reds.
  //
  // The heaviest ground is the widest ROW BAND, not the card's resting fill: a rule inside
  // a table still has to be findable on a hovered, cursored or selected row.
  test("keeps a table's rules a faint, evenly-spread step off the surface", () => {
    const STEP = 0.12;
    const seen: number[] = [];
    for (const [id, theme] of themeEntries()) {
      const sunk = theme.tokens["--paper-sunk"];
      const ink = theme.tokens["--ink"];
      // color-mix(in lab, var(--paper-sunk), var(--ink) 12%) — banded() is that same mix.
      const painted = banded(sunk, ink, STEP);
      for (const pct of TABLE_GROUNDS) {
        const ratio = contrast(painted, banded(sunk, ink, pct));
        seen.push(ratio);
        expect(
          ratio,
          `${id} table rule stepped ${STEP * 100}% on --paper-sunk banded ${pct * 100}%`,
        ).toBeGreaterThan(1.03);
      }
    }
    // One number, one look. A palette landing well outside the others means the mechanism
    // stopped being scheme-symmetric, whatever each individual ratio says.
    expect(Math.max(...seen)).toBeLessThan(1.45);
  });

  // The table header is plain --ink-soft on the card's own fill (EXC-1136). The ink is
  // spent neat — only the GROUND is unusual — which is what separates this from the rules
  // case above.
  //
  // THE FLOOR HERE IS 3:1 AND THAT IS A DELIBERATE, NARROW EXEMPTION. A header cell is
  // text, so 1.4.3's 4.5:1 would ordinarily bind, and the ink-ramp case further up holds
  // --ink-soft to exactly that on the two CHROME surfaces. On this ground it does not clear
  // it everywhere: catppuccin-latte binds at 4.34, 0.16 short. 3:1 ships on the reasoning
  // that the row is uppercase, short, and sits directly above body copy at full --ink.
  // Soften the ink at all and latte drops below 4 — measure before touching it.
  // doc/agents/svelte-rules.md § CSS-token discipline carries the range and the rest of
  // the argument.
  test("keeps a table header above the non-text floor on the card's own fill", () => {
    for (const [id, theme] of themeEntries()) {
      const ground = banded(theme.tokens["--paper-sunk"], theme.tokens["--ink"], TABLE_CARD_FILL);
      expect(
        contrast(theme.tokens["--ink-soft"], ground),
        `${id} table header --ink-soft on --paper-sunk banded ${TABLE_CARD_FILL * 100}%`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  test("keeps every comment stamp's word at AA on its stamp", () => {
    for (const [id, theme] of themeEntries()) {
      const recipe = stampRecipe(theme.scheme);
      const tokens = theme.tokens as Record<string, string>;
      const toward = (c: string) => tokens[c] ?? c;
      const well = banded(tokens["--paper-raised"]!, toward(recipe.wellToward), recipe.well);
      // Accepted is settled, so its floor tints half as far.
      for (const [hue, settle] of [
        ["--attention", 1],
        ["--danger", 1],
        ["--ok", 0.5],
      ] as const) {
        const stamp = banded(well, tokens[hue]!, recipe.floor * settle);
        const word = banded(tokens[hue]!, toward(recipe.inkToward), recipe.ink);
        expect(contrast(word, stamp), `${id} ${hue}`).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(tokens["--ink-soft"]!, well), `${id} expired`).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("keeps --accent-ink readable on --accent", () => {
    for (const [id, theme] of themeEntries()) {
      expect(
        contrast(theme.tokens["--accent-ink"], theme.tokens["--accent"]),
        `${id} --accent-ink on --accent`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  // shiki resolves token colors at highlight time and takes plain 6-digit hex; an
  // alpha suffix on any of these would reach the highlighter as an invalid color.
  // Only the tokens caret-theme.ts's appended markdown rules read reach shiki through
  // the tokens: every built-in's syntax and chrome colors come from its theme file,
  // which theme-file.test.ts validates as 6-digit hex.
  test("supplies alpha-free hex for the tokens shiki reads", () => {
    const shikiTokens: ColorToken[] = ["--ink-faint", "--ink-soft", "--accent"];
    for (const [id, theme] of themeEntries()) {
      for (const token of shikiTokens) {
        expect(theme.tokens[token], `${id} ${token}`).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  // The two chip tints that carry hue have to stay apart in EVERY palette, not just
  // caret's — a link and a resolved reference are the pair a reader tells apart by
  // color alone, and EXC-880 rests on that. Picking the source hues by eye is what
  // this catches: Catppuccin draws --chip-link's `lavender` and --attention's `blue`
  // eleven degrees apart, so the obvious "link rides accentBright, ref rides
  // attention" mapping collapses into one chip across four flavors while every
  // key-set and contrast test above still passes. 60 degrees is a wide floor
  // deliberately — among palettes that keep the default `chipRefHue`, the surviving
  // `accentBright` x `ok` pairing clears 76 in the tightest (github-light), so this
  // fires on a mapping mistake, not on a palette's taste. `accentBright` x `ok` is not
  // the only pairing that would clear it — `accent` x `ok` bottoms at 75 and `danger` x
  // `ok` at 97 — it is the one left once `accent` stays reserved for selection and
  // `danger` for semantics. Dawnfox's green sits 47 degrees from its link blue, one
  // reason it overrides `chipRefHue`.
  //
  // Only the hued pair is pinned. The three neutral chips are a lightness ramp, and
  // a vendor's own ink-to-inkSoft step decides how wide it is: bold and italic
  // composite within a 1.05 contrast ratio in most palettes. A floor
  // there would fail on those palettes' taste rather than on a mistake, and the
  // tint is not what separates those three anyway — EXC-867's weight, slant, and
  // mono family are.
  test("keeps the two hued chip tints at least 60 degrees apart", () => {
    for (const [id, theme] of themeEntries()) {
      const separation = Math.abs(
        hue(theme.tokens["--chip-link"]) - hue(theme.tokens["--chip-ref"]),
      );
      expect(
        Math.min(separation, 360 - separation),
        `${id} --chip-link vs --chip-ref`,
      ).toBeGreaterThanOrEqual(60);
    }
  });

  // The composer's own pair (EXC-1186). A feedback comment routinely carries both a
  // file chip and a skill chip in one sentence, and telling them apart at a glance is
  // the whole reason the second tint exists — so this is the same floor and the same
  // reasoning as the pin above, on the pairing that actually shares a surface.
  //
  // The recipe's default hue for --chip-skill is `attention`, which clears this in every
  // vendor palette (66 degrees at the tightest, dawnfox's yellow attention against its
  // pink chip-ref). caret's own two do NOT clear it that way — verdigris is about 46
  // degrees off carrot-top — so caret-{dark,light}.json set `chipSkillHue` to woad instead, and they land near
  // 72. Without that override this is the test that fails.
  //
  // caret's skill chip rides its syntax `type` hue; the theme files spell the two
  // separately, so this holds them together.
  test("gives caret's skill chip its syntax type hue", async () => {
    for (const name of ["caret-dark.json", "caret-light.json"]) {
      const file = await readThemeFile(name);
      expect(file.palette.chipSkillHue, name).toBe(file.syntax.type.color);
    }
  });

  // NOT pinned: --chip-skill against --chip-link. Catppuccin draws those about 15
  // degrees apart, and no surface renders both — a link chip is the rendered plan's,
  // a skill chip is the composer's.
  test("keeps the skill chip at least 60 degrees from the file chip", () => {
    for (const [id, theme] of themeEntries()) {
      const separation = Math.abs(
        hue(theme.tokens["--chip-skill"]) - hue(theme.tokens["--chip-ref"]),
      );
      expect(
        Math.min(separation, 360 - separation),
        `${id} --chip-skill vs --chip-ref`,
      ).toBeGreaterThanOrEqual(60);
    }
  });

  // The reference chip's OTHER load-bearing pair (EXC-880). A resolved reference rests in
  // --chip-ref and takes --accent-wash on hover, so "hover is a visible step up" depends
  // on those two being told apart. The step is carried almost entirely by hue: the alphas
  // are two percentage points apart
  // (ALPHA.chip vs ALPHA.wash in recipe.ts), so a palette whose accent drifted toward
  // --chip-ref's green would quietly reduce hover to that alpha nudge. Only the e2e's two
  // palettes are ever rendered in a browser; every other is held here or nowhere.
  // Same 60-degree floor and same reasoning as the pin above; github-light is tightest at
  // roughly 75 degrees, so this fires on a palette mistake rather than on a palette's taste.
  test("keeps the resting reference chip at least 60 degrees from its hover wash", () => {
    for (const [id, theme] of themeEntries()) {
      const separation = Math.abs(
        hue(theme.tokens["--accent-wash"]) - hue(theme.tokens["--chip-ref"]),
      );
      expect(
        Math.min(separation, 360 - separation),
        `${id} --accent-wash vs --chip-ref`,
      ).toBeGreaterThanOrEqual(60);
    }
  });

  // The reference chip's THIRD pair (EXC-880, EXC-868). --chip-ref and --chip-code sit in
  // the same paragraph — `package.json` draws both at once — so "a resolved path is
  // distinct from ordinary inline code" needs holding rather than being true by
  // construction.
  //
  // Measured as SATURATION rather than as the hue distance the two pins above use, because
  // --chip-code rides `neutral` and a neutral's hue angle is noise: caret's sits at 30
  // degrees and Catppuccin's at 228, with no design intent in the gap. A hue floor would
  // pass on a desaturated `ok` that had genuinely collapsed into the neutral, and fail on a
  // green-cast gray that still read fine. What actually separates the two roles is chroma —
  // one is a wash of the palette's gray, the other of its green. The floor sits between the
  // measured extremes with headroom on both sides: --chip-ref bottoms at 0.44
  // (catppuccin-frappe) and --chip-code tops out at 0.27 (dracula), so this fires on a
  // palette naming a hued token for `chipCodeHue` (or a flat one for `chipRefHue`) rather
  // than on a palette's taste. One named floor rather than the number twice: the two
  // assertions separate the chips only because they share it, and relaxing one alone
  // would sever that silently.
  const CHROMA_FLOOR = 0.35;
  test("keeps the reference chip hued and the inline-code chip neutral", () => {
    for (const [id, theme] of themeEntries()) {
      expect(saturation(theme.tokens["--chip-ref"]), `${id} --chip-ref`).toBeGreaterThan(
        CHROMA_FLOOR,
      );
      expect(saturation(theme.tokens["--chip-code"]), `${id} --chip-code`).toBeLessThan(
        CHROMA_FLOOR,
      );
    }
  });

  // A theme file's markdown styles color the plan's body copy, so each is text held to
  // WCAG AA on the plan surface, as the syntax roles are. An element drawn on a chip is
  // measured on the chip's tint as well: a link chip riding the link's own hue moves the
  // ground toward the text. Which palettes the floor pushes back onto their ink ramp is
  // in doc/agents/svelte-rules.md § CSS-token discipline.
  const MARKDOWN_CHIPS: Partial<Record<MarkdownElement, ColorToken>> = {
    code: "--chip-code",
    link: "--chip-link",
    bold: "--chip-bold",
    italic: "--chip-italic",
  };
  test("keeps every markdown text style at AA on the ground it renders on", () => {
    for (const [id, theme] of themeEntries()) {
      const sunk = theme.tokens["--paper-sunk"];
      for (const [element, style] of Object.entries(theme.markdown)) {
        if (element === "listMarker") continue;
        const chip = MARKDOWN_CHIPS[element as MarkdownElement];
        for (const ground of chip ? [sunk, over(theme.tokens[chip], sunk)] : [sunk]) {
          expect(
            contrast(style.color, ground),
            `${id} ${element} on ${ground}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  // The bullet replaces its dash, so a list-marker style joins the replacement family
  // above and owes the same non-text floor on the same grounds.
  test("keeps a list-marker style above the non-text floor on every palette", () => {
    expectAboveNonTextFloor(
      (theme) => theme.markdown.listMarker?.color ?? theme.tokens["--ink-soft"],
      "list marker",
    );
  });

  // The hue rules below exempt a style that spends the palette's own ink ramp: those
  // colors carry no hue to confuse, and the weight, slant, chip and underline tell the
  // elements apart as they did before a theme could style them.
  const onInkRamp = (theme: (typeof THEMES)[BuiltinThemeId], color: string) =>
    [theme.tokens["--ink"], theme.tokens["--ink-soft"], theme.tokens["--ink-faint"]].includes(
      color,
    );

  // A hue caret reserves for one meaning, which a style this near reads as.
  const RESERVED_HUE_GAP = 15;

  // The accent marks the current selection, so a markdown element in its hue reads as
  // selected. A theme without a heading style paints every heading outside markdown in the
  // accent. Falsifiable: Dracula's headings in its purple accent red here.
  test("keeps every hued markdown style off the accent's hue", () => {
    for (const [id, theme] of themeEntries()) {
      const styles = { heading: { color: theme.tokens["--accent"] }, ...theme.markdown };
      for (const [element, style] of Object.entries(styles)) {
        if (onInkRamp(theme, style.color)) continue;
        expect(
          hueGap(style.color, theme.tokens["--accent"]),
          `${id} ${element}`,
        ).toBeGreaterThanOrEqual(RESERVED_HUE_GAP);
      }
    }
  });

  const HEADING_STYLES: MarkdownElement[] = [
    "heading",
    ...HEADING_LEVELS.map((level) => `heading${level}` as const),
  ];

  // A version diff paints a deletion in --danger, and the Reject control and the error
  // states wear it, so a heading near its hue reads as one of them, the plan's title worst
  // of all. Falsifiable: Catppuccin Frappé's title in its maroon.
  test("keeps every hued heading style off the danger hue", () => {
    for (const [id, theme] of themeEntries()) {
      for (const element of HEADING_STYLES) {
        const style = theme.markdown[element];
        if (style === undefined || onInkRamp(theme, style.color)) continue;
        expect(
          hueGap(style.color, theme.tokens["--danger"]),
          `${id} ${element}`,
        ).toBeGreaterThanOrEqual(RESERVED_HUE_GAP);
      }
    }
  });

  // Every plan row is one size, so a heading set regular and upright near the body's ink
  // reads as a paragraph, its markers the only sign. 15 sits between the subtext levels that
  // read as body by eye and Frappé's sapphire, which reads as blue. Falsifiable: Latte's
  // fourth level regular in its subtext.
  const BODY_GAP = 15;
  test("sets every heading style apart from body text by weight, slant or color", () => {
    for (const [id, theme] of themeEntries()) {
      for (const element of HEADING_STYLES) {
        const style = theme.markdown[element];
        if (style === undefined || style.fontStyle?.some((f) => f === "bold" || f === "italic")) {
          continue;
        }
        expect(
          deltaE(style.color, theme.tokens["--ink"]),
          `${id} ${element}`,
        ).toBeGreaterThanOrEqual(BODY_GAP);
      }
    }
  });

  // A resolved reference shares its sentence with the inline elements, and a skill chip
  // shares the comment editor's with a link, so neither may borrow its hue. 30 degrees,
  // half the chip pins' floor, because a text color is a smaller patch than a tint.
  // Falsifiable: caret-dark italics in its string green sit 23 degrees from --chip-ref.
  test("keeps inline markdown styles off the reference chip's hue, and a link off the skill chip's", () => {
    for (const [id, theme] of themeEntries()) {
      for (const element of ["code", "link", "bold", "italic"] as const) {
        const style = theme.markdown[element];
        if (style === undefined || onInkRamp(theme, style.color)) continue;
        const near = [
          "--chip-ref",
          ...(element === "link" ? (["--chip-skill"] as const) : []),
        ] as const;
        for (const chip of near) {
          expect(
            hueGap(style.color, theme.tokens[chip]),
            `${id} ${element} vs ${chip}`,
          ).toBeGreaterThanOrEqual(30);
        }
      }
    }
  });

  // The elements that share a line have to read as different colors where both spend a
  // hue: the four inline ones among themselves, a quote against everything nested in it,
  // and a list marker against what starts its item. A heading is absent: what sits inline
  // in it has a floor of its own below, and it shares a line with nothing else. 20 is a
  // large step on the CIE76 scale — a glance, not a comparison. Falsifiable: Dracula's link
  // in its italic yellow.
  const GLANCE = 20;
  const SHARE_A_LINE: [MarkdownElement, MarkdownElement][] = [
    ["code", "link"],
    ["code", "bold"],
    ["code", "italic"],
    ["link", "bold"],
    ["link", "italic"],
    ["bold", "italic"],
    ...(["code", "link", "bold", "italic", "listMarker"] as const).map(
      (e): [MarkdownElement, MarkdownElement] => ["quote", e],
    ),
    ...(["code", "link", "bold", "italic"] as const).map(
      (e): [MarkdownElement, MarkdownElement] => ["listMarker", e],
    ),
  ];
  test("keeps the hued markdown styles that share a line apart", () => {
    for (const [id, theme] of themeEntries()) {
      for (const [a, b] of SHARE_A_LINE) {
        const [ca, cb] = [theme.markdown[a]?.color, theme.markdown[b]?.color];
        if (ca === undefined || cb === undefined) continue;
        if (onInkRamp(theme, ca) || onInkRamp(theme, cb)) continue;
        expect(deltaE(ca, cb), `${id} ${a} vs ${b}`).toBeGreaterThanOrEqual(GLANCE);
      }
    }
  });

  /** Each heading level's style, a level the theme leaves unstyled as caret's accent bold. */
  const levelStyles = (theme: (typeof THEMES)[BuiltinThemeId]): RoleStyle[] =>
    HEADING_LEVELS.map(
      (level) =>
        theme.markdown[`heading${level}`] ?? {
          color: theme.tokens["--accent"],
          fontStyle: ["bold"],
        },
    );

  /** Whether two of the theme file's colors that clear a heading's floors above sit GLANCE
   * apart, so its heading levels can step by color. doc/agents/svelte-rules.md
   * § CSS-token discipline names the palettes that cannot. */
  async function headingsStepByColor(id: BuiltinThemeId, theme: (typeof THEMES)[BuiltinThemeId]) {
    const clearsHeadingFloors = (color: string) =>
      contrast(color, theme.tokens["--paper-sunk"]) >= 4.5 &&
      (onInkRamp(theme, color) ||
        (hueGap(color, theme.tokens["--accent"]) >= RESERVED_HUE_GAP &&
          hueGap(color, theme.tokens["--danger"]) >= RESERVED_HUE_GAP));
    const colors = Object.values(await themeFileColors(`${id}.json`)).filter(
      (color) => color !== undefined && clearsHeadingFloors(color),
    );
    return colors.some((a) => colors.some((b) => deltaE(a, b) >= GLANCE));
  }

  // Bold, italic and a link inside a heading share its line, so where one's color is within
  // GLANCE of the level's, it has to differ in what it adds, as it inherits the rest of its
  // font from the heading: bold its weight, italic its slant, and a link a decoration its
  // style names, since the excerpt preview draws a link no underline of its own. Code is
  // exempt: the plan view and the comment editor draw it a pill. So is a palette whose
  // levels cannot step by color, its inline text in the same ink. Falsifiable: Dracula's
  // second level bold in its bold orange.
  const INLINE_ADDS = { bold: ["bold"], italic: ["italic"], link: [] } as const;
  test("keeps bold, italic and links apart from a heading level near their color", async () => {
    for (const [id, theme] of themeEntries()) {
      if (!(await headingsStepByColor(id, theme))) continue;
      for (const [i, heading] of levelStyles(theme).entries()) {
        for (const [element, marks] of Object.entries(INLINE_ADDS)) {
          const style = theme.markdown[element as keyof typeof INLINE_ADDS];
          if (style === undefined || deltaE(style.color, heading.color) >= GLANCE) continue;
          const adds = [...marks, ...(style.fontStyle ?? [])];
          expect(
            adds.some((f) => !heading.fontStyle?.includes(f)),
            `${id} heading${i + 1} vs ${element}`,
          ).toBe(true);
        }
      }
    }
  });

  // Every plan row is one size, so a heading's level shows in its color first, and the
  // outline reads only if adjacent levels differ at a glance: by GLANCE in CIE76. Only a
  // palette whose levels cannot step by color may step by weight or slant instead.
  // Falsifiable: caret-dark's first two levels both in its function gold.
  test("keeps adjacent heading levels a glance apart in color, where the palette allows", async () => {
    const font = (style: RoleStyle) =>
      (["bold", "italic"] as const).filter((f) => style.fontStyle?.includes(f)).join(" ");
    for (const [id, theme] of themeEntries()) {
      const byColor = await headingsStepByColor(id, theme);
      const levels = levelStyles(theme);
      for (const [i, lower] of levels.entries()) {
        const upper = levels[i - 1];
        if (upper === undefined || (!byColor && font(upper) !== font(lower))) continue;
        expect(
          deltaE(upper.color, lower.color),
          `${id} heading${i} vs heading${i + 1}`,
        ).toBeGreaterThanOrEqual(GLANCE);
      }
    }
  });

  // A version diff paints a deletion in --danger, and an error wears it too, so inline code
  // or bold in that red reads as one of them. --ok is left open on purpose: green code is
  // Dracula's and Catppuccin's own convention, and reads as that before it reads as an
  // added line. Falsifiable: duskfox's code in its love red.
  test("keeps every markdown style off --danger", () => {
    for (const [id, theme] of themeEntries()) {
      for (const [element, style] of Object.entries(theme.markdown)) {
        expect(style.color.toLowerCase(), `${id} ${element}`).not.toBe(
          theme.tokens["--danger"].toLowerCase(),
        );
      }
    }
  });

  // --accent is the scarce mark caret spends on the current selection; --attention is
  // the separate "look here" hue (the notification dot, the version-count badge).
  // Collapsing them into one color erases that distinction.
  test("keeps --attention distinct from --accent", () => {
    for (const [id, theme] of themeEntries()) {
      expect(theme.tokens["--attention"], id).not.toBe(theme.tokens["--accent"]);
    }
  });
});

// Every appearance slot is keyed by scheme, so a scheme with no themes would
// render an empty picker — and the light/dark defaults would have nothing to
// point at. Adding a palette to THEMES keeps both slots populated for free.
describe("themesForScheme", () => {
  test("every scheme offers at least one theme", () => {
    const schemes: Scheme[] = ["light", "dark"];
    for (const scheme of schemes) {
      expect(themesForScheme(scheme).length, scheme).toBeGreaterThan(0);
    }
  });

  test("returns only that scheme's themes, in THEME_IDS order", () => {
    for (const theme of themesForScheme("light")) expect(theme.scheme).toBe("light");
    for (const theme of themesForScheme("dark")) expect(theme.scheme).toBe("dark");
    const ordered = themesForScheme("dark").map((t) => t.id);
    expect(ordered).toEqual(THEME_IDS.filter((id) => THEMES[id].scheme === "dark"));
  });

  test("partitions THEMES exactly — every theme lands in one scheme's list", () => {
    const partitioned = [...themesForScheme("light"), ...themesForScheme("dark")].map((t) => t.id);
    expect(partitioned.sort()).toEqual([...THEME_IDS].sort());
  });
});

describe("paintPalette", () => {
  test("paints a palette's tokens, color-scheme and data-theme onto a target", () => {
    const node = document.createElement("div");
    const tokens = { ...THEMES["caret-light"].tokens, "--accent": "#ff00aa" };
    paintPalette({ scheme: "light", tokens }, node);
    for (const [name, value] of Object.entries(tokens)) {
      expect(node.style.getPropertyValue(name), name).toBe(value);
    }
    expect(node.style.getPropertyValue("color-scheme")).toBe("light");
    expect(node.dataset.theme).toBe("light");
  });

  // The plan view and the feedback editor read these; shiki carries the same styles to
  // the highlighted code. Each surface falls back to its own look where one is unset.
  test("paints each markdown style as the element's custom properties", () => {
    const node = document.createElement("div");
    const { tokens } = THEMES["caret-dark"];
    paintPalette(
      {
        scheme: "dark",
        tokens,
        markdown: {
          heading: { color: "#50fa7b", fontStyle: ["italic"] },
          heading2: { color: "#bd93f9", fontStyle: ["bold", "underline"] },
          link: { color: "#ff79c6", fontStyle: ["strikethrough"] },
          listMarker: { color: "#8be9fd" },
          quote: { color: "#f1fa8c", fontStyle: ["italic"] },
        },
      },
      node,
    );
    const painted = Object.fromEntries(
      Array.from(node.style)
        .filter((name) => name.startsWith("--markdown-"))
        .map((name) => [name, node.style.getPropertyValue(name)]),
    );
    expect(painted).toEqual({
      // caret's own heading is bold, so a heading style without bold paints normal weight.
      "--markdown-heading-color": "#50fa7b",
      "--markdown-heading-font-weight": "normal",
      "--markdown-heading-font-style": "italic",
      "--markdown-heading2-color": "#bd93f9",
      "--markdown-heading2-font-weight": "bold",
      "--markdown-heading2-text-decoration": "underline",
      // A link is always underlined; its style adds to that rather than replacing it.
      "--markdown-link-color": "#ff79c6",
      "--markdown-link-text-decoration": "underline line-through",
      "--markdown-list-marker-color": "#8be9fd",
      "--markdown-quote-color": "#f1fa8c",
      "--markdown-quote-font-style": "italic",
      // A quote with a color of its own is told apart by it, so it drops the subdue.
      "--markdown-quote-opacity": "1",
    });
  });

  // caret's own heading is bold, so a heading level's style that names no bold replaces it.
  test("paints a heading level's style without bold at normal weight", () => {
    const node = document.createElement("div");
    const { tokens } = THEMES["caret-dark"];
    paintPalette({ scheme: "dark", tokens, markdown: { heading5: { color: "#bd93f9" } } }, node);
    expect(node.style.getPropertyValue("--markdown-heading5-font-weight")).toBe("normal");
  });

  test("clears the markdown styles a previous palette painted", () => {
    const node = document.createElement("div");
    const { tokens } = THEMES["caret-dark"];
    paintPalette({ scheme: "dark", tokens, markdown: { link: { color: "#ff79c6" } } }, node);
    paintPalette({ scheme: "dark", tokens, markdown: {} }, node);
    expect(Array.from(node.style).filter((name) => name.startsWith("--markdown-"))).toEqual([]);
  });
});

describe("paintTheme", () => {
  test("writes every token as an inline custom property on the root", () => {
    paintTheme("caret-light");
    const style = document.documentElement.style;
    for (const [name, value] of Object.entries(THEMES["caret-light"].tokens)) {
      expect(style.getPropertyValue(name), name).toBe(value);
    }
  });

  test("sets color-scheme and data-theme to the theme's scheme", () => {
    paintTheme("caret-light");
    expect(document.documentElement.style.getPropertyValue("color-scheme")).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");

    paintTheme("caret-dark");
    expect(document.documentElement.style.getPropertyValue("color-scheme")).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  test("returns the painted theme object", () => {
    const painted: ThemeId = paintTheme("caret-light").id;
    expect(painted).toBe("caret-light");
  });

  // The scoped-target contract (EXC-884): the same paint, aimed anywhere.
  test("writes every token as an inline custom property on a passed target", () => {
    const node = document.createElement("div");
    paintTheme("caret-light", node);
    for (const [name, value] of Object.entries(THEMES["caret-light"].tokens)) {
      expect(node.style.getPropertyValue(name), name).toBe(value);
    }
  });

  test("sets color-scheme and data-theme on a passed target", () => {
    const node = document.createElement("div");
    paintTheme("caret-light", node);
    expect(node.style.getPropertyValue("color-scheme")).toBe("light");
    expect(node.dataset.theme).toBe("light");
  });

  // A scoped paint that leaked to the root would retint the whole app behind a
  // preview, so the root is pre-painted to the opposite scheme — any leak is a
  // visible contradiction rather than a coincidence.
  test("leaves the document root untouched when given a target", () => {
    paintTheme("caret-dark");
    const node = document.createElement("div");
    paintTheme("caret-light", node);

    const root = document.documentElement;
    expect(root.dataset.theme).toBe("dark");
    expect(root.style.getPropertyValue("color-scheme")).toBe("dark");
    expect(root.style.getPropertyValue("--paper")).toBe(THEMES["caret-dark"].tokens["--paper"]);
  });

  test("returns the painted theme when given a target", () => {
    const painted: ThemeId = paintTheme("caret-light", document.createElement("div")).id;
    expect(painted).toBe("caret-light");
  });
});

// EXC-905: a palette token nothing reads is the opposite of a system, and the recipe
// plus the full-token pins above will happily carry one for every palette without
// noticing. This walks ui/src and asserts every ColorToken is read by something, so
// "declared for nobody" fails the suite. It is a floor, not proof a token reaches a
// rendered surface: the reader may be plumbing rather than paint — --accent-ink is
// satisfied partly by styles/shadcn-bridge.css.
describe("every ColorToken is read somewhere in ui/src", () => {
  const UI_SRC = join(import.meta.dir, "..");
  // palette.generated.css DECLARES every token, so counting it would make the
  // assertion vacuous. Test files are excluded for the same reason: a token named
  // only by its own pin is not a token the chrome uses.
  const sources = readdirSync(UI_SRC, { recursive: true, encoding: "utf8" })
    .filter((f) => /\.(svelte|css|ts)$/.test(f) && !f.endsWith(".test.ts"))
    .filter((f) => f !== join("styles", "palette.generated.css"))
    .map((f) => readFileSync(join(UI_SRC, f), "utf8"))
    .join("\n");

  // The five content chips (EXC-858) are spent in diffview/coreStyles.ts, each through
  // its own --md-* layer variable, and the sixth (--chip-skill, EXC-1186) in
  // lib/markdownEditor.ts — so the rule below holds over every token with no exemptions.
  for (const token of Object.keys(THEMES["caret-dark"].tokens) as ColorToken[]) {
    test(`${token} is read by at least one var()`, () => {
      // The negative lookahead keeps --mark from matching --mark-active and --ink
      // from matching --ink-soft — the same guard ThemePreviewCard.test.ts uses.
      expect(new RegExp(`var\\(\\s*${token}(?![\\w-])`).test(sources), token).toBe(true);
    });
  }
});

describe("runtime themes", () => {
  test("themesForScheme lists a registered theme after the built-ins, in its own scheme only", async () => {
    const id = addTheme(await customThemeFile("runtime-list", "light"));
    const lightIds = themesForScheme("light").map((t) => t.id);
    expect(lightIds.at(-1)).toBe(id);
    expect(lightIds.slice(0, -1)).toEqual(THEME_IDS.filter((t) => THEMES[t].scheme === "light"));
    expect(themesForScheme("dark").map((t) => t.id)).not.toContain(id);
  });

  test("paintTheme paints a registered theme's tokens", async () => {
    const file = await customThemeFile("runtime-paint", "dark");
    paintTheme(addTheme(file));
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe(
      file.tokens["--accent"],
    );
  });

  test("addTheme refuses a built-in or already-registered id", async () => {
    addTheme(await customThemeFile("runtime-twice", "dark"));
    const darkBefore = themesForScheme("dark");
    for (const id of ["caret-dark", "dracula", "runtime-twice"]) {
      const file = await customThemeFile(id, "dark");
      expect(() => addTheme(file)).toThrow(id);
    }
    expect(themeFor("caret-dark")).toBe(THEMES["caret-dark"]);
    expect(themesForScheme("dark")).toEqual(darkBefore);
  });

  test("replaceTheme swaps the entry in place, keeping the slot's order", async () => {
    const id = addTheme(await customThemeFile("replace-swap", "dark"));
    addTheme(await customThemeFile("replace-swap-after", "dark"));
    const orderBefore = themesForScheme("dark").map((t) => t.id);
    const next = { ...(await customThemeFile("replace-swap", "dark")), label: "Swapped" };
    next.tokens = { ...next.tokens, "--accent": "#123456" };

    expect(replaceTheme(next)).toBe(id);

    expect(themeFor(id).label).toBe("Swapped");
    expect(themeFor(id).tokens["--accent"]).toBe("#123456");
    expect(themesForScheme("dark").map((t) => t.id)).toEqual(orderBefore);
  });

  test("replaceTheme names the shiki theme afresh on every replace", async () => {
    const file = await customThemeFile("replace-name", "dark");
    const id = addTheme(file);
    const revisionOf = () => (themeFor(id) as RuntimeTheme).revision;
    replaceTheme(file);
    const first = shikiThemeName(themeFor(id));
    expect(revisionOf()).toBe(1);
    replaceTheme(file);
    expect(revisionOf()).toBe(2);
    expect(shikiThemeName(themeFor(id))).not.toBe(first);
    expect(first).not.toBe(id);
  });

  test("replaceTheme refuses an unregistered or built-in id", async () => {
    for (const id of ["replace-unknown", "caret-dark"]) {
      const file = await customThemeFile(id, "dark");
      expect(() => replaceTheme(file)).toThrow(id);
    }
    expect(themeFor("caret-dark")).toBe(THEMES["caret-dark"]);
  });

  test("isCustomThemeId holds only once addTheme registered the id", async () => {
    const file = await customThemeFile("custom-check", "dark");
    expect(isCustomThemeId("custom-check")).toBe(false);
    addTheme(file);
    expect(isCustomThemeId("custom-check")).toBe(true);
    expect(isCustomThemeId("caret-dark")).toBe(false);
  });

  test("an unregistered string is not a ThemeId", () => {
    // @ts-expect-error a ThemeId is a built-in or one addTheme minted
    const id: ThemeId = "not-a-theme";
    expect(isBuiltinThemeId(id)).toBe(false);
  });
});

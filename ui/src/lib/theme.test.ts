import "@ui/test-setup.ts";
import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { QUOTE_SUBDUE } from "$lib/diffview/coreStyles.ts";
import {
  type ColorToken,
  paintTheme,
  type Scheme,
  THEME_IDS,
  THEMES,
  type ThemeId,
  themesForScheme,
} from "$lib/theme.ts";
import { CARET_COLOR_PLACEMENT, CARET_DARK, CARET_LIGHT } from "$lib/themes/caret.ts";

afterEach(() => {
  localStorage.clear();
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

const themeEntries = () => Object.entries(THEMES) as [ThemeId, (typeof THEMES)[ThemeId]][];

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
    ]);
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
  // (brown-ish), a sibling to caret-dark, rather than the cool pure greys they
  // started as. A pure grey has R === B; warm means R > B. Only the neutral tokens
  // are held to this — the accent and semantic hues carry their own color on purpose.
  // The alpha rule/mark tokens are `#rrggbbaa`, so the alpha tail is optional.
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
  // recipe's hue fallbacks; the thirteen decided ones are read from the named color set
  // in themes/caret.ts, so this pin is what catches a slip in either the set or the
  // reading. The three hue overrides are subsumed: each rides a hue that is NOT the
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
      "--chip-link": "#ffb27724",
      "--chip-ref": "#4ed05624",
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
      "--ink-faint": "#847a70",
      "--rule": "#2a20181a",
      "--rule-strong": "#2a201829",
      "--accent": "#c2490d",
      "--accent-bright": "#e06a24",
      "--accent-wash": "#e07a2e1f",
      "--accent-ink": "#fff6ec",
      "--mark": "#e8882e24",
      "--mark-active": "#e8882e47",
      "--mark-orphan": "#7a6f6329",
      "--chip-bold": "#1913101c",
      "--chip-italic": "#544b431c",
      "--chip-code": "#7a6f631c",
      "--chip-link": "#e06a241c",
      "--chip-ref": "#1d802a1c",
      "--ok": "#1d802a",
      "--danger": "#c11f30",
      "--attention": "#0a5f57",
      "--shadow-card": "0 1px 2px #0000000f, 0 8px 24px #00000014",
    });
  });
});

// caret's own named color set (EXC-902) — the record the thirteen PaletteInput values
// are read from, and the one EXC-903's caret shiki themes spend. The token colors
// are already covered by the two full-token pins above and by the registry-wide
// invariants below; what those cannot reach is the set's shiki-only half, which never
// becomes a ColorToken and so never renders on a surface the other tests measure.
//
// Coverage of the placement map is deliberately NOT asserted here.
// `Record<keyof CaretPalette, ColorPlacement>` already makes a color with no placement
// (or a placement for no color) a compile error, and the "type annotation is a weak
// proxy" note below applies to source-text claims that cannot be typed, not to this one.
describe("the caret color set", () => {
  const records = [
    ["caret-dark", CARET_DARK],
    ["caret-light", CARET_LIGHT],
  ] as const;

  // shiki resolves token colors at highlight time and takes plain 6-digit hex, and the
  // registry-wide pin below already demands the same form of the tokens it reads. One
  // rule over the whole record keeps the two halves from drifting apart.
  test("names every color as alpha-free 6-digit hex", () => {
    for (const [id, record] of records) {
      for (const [color, value] of Object.entries(record)) {
        expect(value, `${id} ${color}`).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  // The syntax hues render on --paper-sunk (the code body and the diff surface), which
  // is neither of the two chrome surfaces the ink-ramp floors are measured against — in
  // caret-dark it sits between them, in caret-light below both. So they get their own
  // floor on their own surface: WCAG AA, except the hues that recede on purpose, held to
  // the large-text floor instead. The exception list is named here rather than inferred,
  // so widening it is a visible decision.
  const RECESSIVE: (keyof typeof CARET_DARK)[] = ["comment"];

  const shikiOnly = Object.entries(CARET_COLOR_PLACEMENT)
    .filter(([, placement]) => placement === "shiki-only")
    .map(([color]) => color as keyof typeof CARET_DARK);

  // Guards the loop below against iterating an empty list: a reclassification that left
  // no color `shiki-only` would otherwise report as a clean pass having measured nothing.
  test("names a shiki-only half to measure", () => {
    expect(shikiOnly.length).toBeGreaterThan(0);
  });

  test("clears caret's contrast floors for every shiki-only hue, on --paper-sunk", () => {
    for (const [id, record] of records) {
      for (const color of shikiOnly) {
        const ratio = contrast(record[color], record.sunk);
        if (RECESSIVE.includes(color)) {
          expect(ratio, `${id} ${color} on sunk (recessive)`).toBeGreaterThan(3);
        } else {
          expect(ratio, `${id} ${color} on sunk`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });
});

// The recipe is the only way a Theme is constructed (EXC-885). Asserted against each
// palette module's source rather than its exports, because a hand-written token
// record and a generated one are indistinguishable once they are Theme objects —
// the thing worth pinning is that the derivation is not re-typed per palette.
// recipe.ts is the constructor itself, so it is the one file exempt.
describe("every palette module", () => {
  const THEMES_DIR = join(import.meta.dir, "themes");
  const modules = readdirSync(THEMES_DIR).filter(
    (file) => file.endsWith(".ts") && file !== "recipe.ts",
  );

  // Guards the loop below against iterating an empty list, which would report as a
  // clean pass if the directory ever moved.
  test("is found beside recipe.ts", () => {
    expect(modules.length).toBeGreaterThan(0);
  });

  for (const file of modules) {
    test(`${file} builds its themes through paletteTheme`, () => {
      const source = readFileSync(join(THEMES_DIR, file), "utf8");
      expect(source, file).toContain("paletteTheme(");
      expect(source, file).not.toContain("Record<ColorToken, string>");
      // The type annotation alone is a weak proxy — a module could drop it and still
      // hand-write a token record. No palette module names a `"--token":` key at all
      // (only recipe.ts does, and it is excluded), so the absence of one is the
      // falsifiable form of "the derivation is not re-typed per palette".
      expect(source, file).not.toMatch(/"--[\w-]+"\s*:/);
    });
  }
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
  // runs from 6.0:1 (catppuccin-latte) to 18.9:1 (github-dark), so the fade a roomy
  // palette could easily carry is the one that would push latte under. Adding a palette
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
  // That gap is why every member spends --ink-soft and not the --ink-faint the epic
  // prescribed for markers generally. Falsifiable, and it really does bite: swap MARKER_INK
  // to "--ink-faint" and this reds on the FIRST band it reaches, catppuccin-latte at 2.99,
  // with github-light behind it at 2.97; the ink bottoms at 2.63 across the nine and
  // --ink-soft at 4.21. doc/agents/svelte-rules.md § chips carries the full ranges.
  //
  // EXC-860 opened this case for the checkbox alone and left the rest of the family faint,
  // correctly — re-tinting a shared token is not one ticket's call. EXC-871 made it across
  // the whole epic and the list is now closed by a rule rather than by inspection: a marker
  // whose glyph SURVIVES is supplementary and stays on --ink-faint (the fence markers, the
  // ** / _ emphasis markers, an ordered item's number), and only a marker that has been
  // replaced appears below. Two of the family are measured separately, one test down
  // each, because neither paints its token neat: the thematic break's can carry an alpha
  // suffix that has to composite first, and a table's rules soften theirs toward the
  // surface, so measuring the token would measure a color the sheet never paints.
  //
  // One assertion rather than one per member: all three draw in the same token, so a
  // per-marker loop would run the identical arithmetic three times for a longer message.
  // Which SELECTORS spend it is coreStyles.test.ts's job — it pins the six this epic drew
  // by name. Neither file can catch a SEVENTH replacement marker shipped on --ink-faint;
  // that gap is real and named here rather than papered over.
  test("keeps every replacement marker above the non-text floor on every palette", () => {
    const MARKER_INK = "--ink-soft" as const;
    for (const [id, theme] of themeEntries()) {
      const sunk = theme.tokens["--paper-sunk"];
      for (const pct of ROW_BANDS) {
        const ground = banded(sunk, theme.tokens["--ink"], pct);
        expect(
          contrast(theme.tokens[MARKER_INK], ground),
          `${id} replacement marker ${MARKER_INK} on --paper-sunk banded ${pct * 100}%`,
        ).toBeGreaterThanOrEqual(3);
      }
    }
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
  // they measure 1.15-1.37 and 1.24-1.64 across the nine — barely above the 1.05 this
  // epic treats as indistinguishable, so the line renders as nothing at all. --ink-faint,
  // the marker ink, lands at 2.63-4.79 and misses the floor on catppuccin-latte and
  // github-light, the same two EXC-860 found. Swap RULE_INK to any of the three and this
  // reds naming the palette.
  test("keeps the thematic-break rule above the non-text floor on every palette", () => {
    const RULE_INK = "--ink-soft" as const;
    // What the line PAINTS, not what its token names. channels() drops an alpha suffix
    // on purpose — a wash and its hue are one color for the angle tests — but a
    // translucent paint's contrast is the contrast of what lands on the ground, so the
    // src-over composite happens here. An opaque token passes through unchanged, which
    // is why the assertion can be written once for any candidate.
    const alpha = (hex: string) => {
      const m = /^#[0-9a-f]{6}([0-9a-f]{2})$/i.exec(hex);
      return m === null ? 1 : Number.parseInt(m[1] as string, 16) / 255;
    };
    const over = (fg: string, bg: string) => banded(bg, fg, alpha(fg));
    for (const [id, theme] of themeEntries()) {
      const sunk = theme.tokens["--paper-sunk"];
      for (const pct of ROW_BANDS) {
        const ground = banded(sunk, theme.tokens["--ink"], pct);
        expect(
          contrast(over(theme.tokens[RULE_INK], ground), ground),
          `${id} thematic-break rule ${RULE_INK} on --paper-sunk banded ${pct * 100}%`,
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });

  // EXC-864's table rules — the frame, the column dividers and the header rule — are one
  // mark declared once as --table-rule (diffview/coreStyles.ts). They are a replacement
  // decoration: the pipes and the delimiter row's dashes go transparent and these are
  // drawn where they stood, so the 3:1 floor binds exactly as it does for the break above.
  //
  // What makes this its own case is that the rules do NOT paint --ink-soft neat. Drawn at
  // full strength a table read as a cage — --ink-soft is 9.10 against caret-dark's bare
  // surface, which is text contrast for something that is only supposed to say "column
  // ends here" — so the sheet softens it toward the surface. This pins how far that can
  // go: SOFTEN is the most that still clears the floor everywhere, and it is
  // catppuccin-latte's widest row band that binds at 3.19. Raise it to 0.2 and this reds
  // naming that palette.
  //
  // Mixed in sRGB here AND in the sheet, which is the one place this file's usual
  // "lab and sRGB differ by well under the headroom" note does not hold: the headroom is
  // 0.19 of a ratio point, so the two spaces have to be the same one or the pin stops
  // measuring what ships.
  test("keeps a table's rules above the non-text floor once softened", () => {
    const SOFTEN = 0.15;
    for (const [id, theme] of themeEntries()) {
      const sunk = theme.tokens["--paper-sunk"];
      // color-mix(in srgb, var(--ink-soft), var(--paper-sunk) 15%) — banded() is that
      // same channel-wise mix, read the other way round.
      const painted = banded(theme.tokens["--ink-soft"], sunk, SOFTEN);
      for (const pct of ROW_BANDS) {
        const ground = banded(sunk, theme.tokens["--ink"], pct);
        expect(
          contrast(painted, ground),
          `${id} table rule --ink-soft softened ${SOFTEN * 100}% on --paper-sunk banded ${pct * 100}%`,
        ).toBeGreaterThanOrEqual(3);
      }
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
  // the tokens: caret's own themes take their colors from the named set (covered
  // by "names every color as alpha-free 6-digit hex" above), and a vendor palette
  // highlights with its own upstream `colors`.
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
  // deliberately — the surviving `accentBright` x `ok` pairing clears 76 in the
  // tightest palette (github-light), so this fires on a mapping mistake, not on a
  // palette's taste. `accentBright` x `ok` is not the only pairing that would clear
  // it — `accent` x `ok` bottoms at 75 and `danger` x `ok` at 97 — it is the one
  // left once `accent` stays reserved for selection and `danger` for semantics.
  //
  // Only the hued pair is pinned. The three neutral chips are a lightness ramp, and
  // a vendor's own ink-to-inkSoft step decides how wide it is: bold and italic
  // composite within a 1.05 contrast ratio in five of the nine palettes. A floor
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

  // The reference chip's OTHER load-bearing pair, and the one EXC-880 created. A resolved
  // reference rests in --chip-ref and takes --accent-wash on hover, so "hover is a visible
  // step up" now depends on those two being told apart — where before EXC-880 the resting
  // state was transparent and any wash read against it by construction. The step is
  // carried almost entirely by hue: the alphas are two percentage points apart
  // (ALPHA.chip vs ALPHA.wash in recipe.ts), so a palette whose accent drifted toward
  // --chip-ref's green would quietly reduce hover to that alpha nudge. Only the e2e's two
  // palettes are ever rendered in a browser; the other seven are held here or nowhere.
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

  // The reference chip's THIRD pair, deferred by EXC-880 to the ticket that made it
  // renderable: until EXC-868 painted inline code, --chip-ref and --chip-code could not
  // appear side by side, so "a resolved path is distinct from ordinary inline code" was
  // true by construction with nothing holding it. They now sit in the same paragraph —
  // `package.json` draws both at once — so it is held here.
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

  // Painting is the whole job: which theme to paint (and remembering it) is
  // appearance.ts's, so a paint must never write a preference of its own.
  test("persists nothing", () => {
    paintTheme("caret-light");
    expect(localStorage.length).toBe(0);
  });

  test("returns the painted theme object", () => {
    const painted: ThemeId = paintTheme("caret-light").id;
    expect(painted).toBe("caret-light");
  });

  // The scoped-target contract (EXC-884): the same paint, aimed anywhere. The four
  // tests above are the no-target contract and stay as they are.
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

// EXC-905: a palette token nothing reads is the opposite of a system. --mark-active
// and --mark-orphan were produced by the recipe for all nine palettes and pinned by
// both full-token tests above while having zero var() readers anywhere in the
// chrome, and nothing caught it. This walks ui/src and asserts every ColorToken is
// read by something, so "declared for nobody" fails the suite rather than waiting to
// be noticed. It is a floor, not proof a token reaches a rendered surface: the reader
// may be plumbing rather than paint — --accent-ink is satisfied partly by
// styles/shadcn-bridge.css. Declared-but-unread is what it catches.
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

  // All five chip tints (EXC-858) are spent in diffview/coreStyles.ts: --chip-code fills
  // the fence-marker chip, --chip-ref the resting file-reference chip, and --chip-bold /
  // --chip-italic / --chip-link the three inline chips, each through its own --md-* layer
  // variable. So the rule below holds over every token with no exemptions.
  for (const token of Object.keys(THEMES["caret-dark"].tokens) as ColorToken[]) {
    test(`${token} is read by at least one var()`, () => {
      // The negative lookahead keeps --mark from matching --mark-active and --ink
      // from matching --ink-soft — the same guard ThemePreviewCard.test.ts uses.
      expect(new RegExp(`var\\(\\s*${token}(?![\\w-])`).test(sources), token).toBe(true);
    });
  }
});

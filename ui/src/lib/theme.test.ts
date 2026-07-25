import "@ui/test-setup.ts";
import { afterEach, describe, expect, test } from "bun:test";

import { readAppCss } from "$lib/appCss.ts";
import {
  type ColorToken,
  paintTheme,
  type Scheme,
  THEME_IDS,
  THEMES,
  type ThemeId,
  themesForScheme,
} from "$lib/theme.ts";

afterEach(() => {
  localStorage.clear();
  // Strip any inline vars/attrs a prior paintTheme wrote onto the root.
  document.documentElement.removeAttribute("style");
  document.documentElement.removeAttribute("data-theme");
});

// The color custom properties app.css declares in :root — the exhaustive set a
// theme must supply. Parsed from the first :root block so a token added to
// app.css without a matching THEMES entry (or vice versa) fails here.
function readFirstRootTokens(css: string): Record<string, string> {
  const body = css.match(/:root\s*\{([^}]*)\}/)?.[1];
  if (body === undefined) throw new Error("app.css :root block not found");
  // Strip comments first so prose inside them can't be mistaken for a
  // declaration, then capture every `prop: value;` — custom properties and the
  // bare `color-scheme` alike (the :root block declares nothing else).
  const tokens: Record<string, string> = {};
  for (const decl of body.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([\w-]+)\s*:\s*([^;]+);/g)) {
    tokens[decl[1]!] = decl[2]!.trim();
  }
  return tokens;
}

// WCAG relative luminance, so "is this palette legible" is arithmetic rather than
// a judgement call. Alpha suffixes are ignored — every token these run on is solid.
function luminance(hex: string): number {
  const rgb = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex);
  if (rgb === null) throw new Error(`expected #rrggbb, got ${hex}`);
  const [r, g, b] = rgb.slice(1, 4).map((pair) => {
    const c = Number.parseInt(pair, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The WCAG contrast ratio between two solid colors, lighter over darker. */
function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

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

  test("caret-dark mirrors the app.css :root fallback exactly", () => {
    const root = readFirstRootTokens(readAppCss());
    for (const [name, value] of Object.entries(THEMES["caret-dark"].tokens)) {
      expect(root[name], `app.css :root ${name}`).toBe(value);
    }
    expect(root["color-scheme"]).toBe("dark");
  });
});

// Registry-wide invariants: these run over every palette rather than the two named
// ones, so a theme added later is held to caret's structure — surface ordering, a
// legible ink ramp, and the shape the shiki derivation needs — the moment it lands.
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

  // caret's own two palettes place --paper-sunk differently by scheme: in dark BOTH
  // panel surfaces lift off the page (raised > sunk > paper), in light the sunk
  // surface recedes below it (raised > paper > sunk). --paper-raised is the lightest
  // either way. A palette mapped without that shape reads inside-out.
  test("keeps caret's surface ordering for its scheme", () => {
    for (const [id, theme] of themeEntries()) {
      const paper = luminance(theme.tokens["--paper"]);
      const raised = luminance(theme.tokens["--paper-raised"]);
      const sunk = luminance(theme.tokens["--paper-sunk"]);
      expect(raised, `${id} --paper-raised is the lightest surface`).toBeGreaterThan(
        theme.scheme === "dark" ? sunk : paper,
      );
      if (theme.scheme === "dark") expect(sunk, `${id} --paper-sunk`).toBeGreaterThan(paper);
      else expect(paper, `${id} --paper`).toBeGreaterThan(sunk);
    }
  });

  // The ink ramp is body copy, secondary copy, and metadata — WCAG AA for the first
  // two, the large-text floor for the faintest. A vendor palette whose neutrals are
  // too close together fails here rather than shipping unreadable settings rows.
  test("clears caret's contrast floors for the ink ramp", () => {
    for (const [id, theme] of themeEntries()) {
      const paper = theme.tokens["--paper"];
      expect(contrast(theme.tokens["--ink"], paper), `${id} --ink`).toBeGreaterThanOrEqual(4.5);
      expect(
        contrast(theme.tokens["--ink-soft"], paper),
        `${id} --ink-soft`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.tokens["--ink-faint"], paper), `${id} --ink-faint`).toBeGreaterThan(3);
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
  test("supplies alpha-free hex for the tokens shiki reads", () => {
    const shikiTokens: ColorToken[] = [
      "--paper-sunk",
      "--ink",
      "--ink-faint",
      "--ink-soft",
      "--accent",
      "--accent-bright",
      "--ok",
    ];
    for (const [id, theme] of themeEntries()) {
      for (const token of shikiTokens) {
        expect(theme.tokens[token], `${id} ${token}`).toMatch(/^#[0-9a-f]{6}$/i);
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
});

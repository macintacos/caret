import "@ui/test-setup.ts";
import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

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

  // The six washes caret's three hue overrides exist to reproduce. Each rides a hue
  // that is NOT the token it would otherwise default to — the rules ride pure white
  // in dark rather than the ink, the accent wash rides a mid-amber that is not
  // --accent, and the dark marks ride a second, lighter amber that is not the wash's
  // — so a dropped or mis-cascaded override surfaces here as a changed byte rather
  // than as a subtly-off hairline. caret-dark's set is pinned transitively by the
  // app.css mirror above; caret-light's is pinned nowhere else.
  const OVERRIDE_SENSITIVE: ColorToken[] = [
    "--rule",
    "--rule-strong",
    "--accent-wash",
    "--mark",
    "--mark-active",
    "--mark-orphan",
  ];
  const washes = (id: ThemeId) =>
    Object.fromEntries(OVERRIDE_SENSITIVE.map((token) => [token, THEMES[id].tokens[token]]));

  test("caret-dark's overridden washes", () => {
    expect(washes("caret-dark")).toEqual({
      "--rule": "#ffffff1a",
      "--rule-strong": "#ffffff29",
      "--accent-wash": "#ec7c3829",
      "--mark": "#f3953c2e",
      "--mark-active": "#f3953c57",
      "--mark-orphan": "#9b9b9b29",
    });
  });

  test("caret-light's overridden washes", () => {
    expect(washes("caret-light")).toEqual({
      "--rule": "#1c17141a",
      "--rule-strong": "#1c171429",
      "--accent-wash": "#ec7c381f",
      "--mark": "#ec7c3824",
      "--mark-active": "#ec7c3847",
      "--mark-orphan": "#78706829",
    });
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
    });
  }
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

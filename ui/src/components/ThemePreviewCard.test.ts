import "@ui/support/mount.ts";

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { render } from "@ui/support/mount.ts";
import ThemePreviewCard from "@/components/ThemePreviewCard.svelte";
import { SWATCH_TOKENS } from "$lib/settingsRegistry.ts";
import { THEMES } from "$lib/theme.ts";

// A real palette, not a hand-rolled stand-in: the card paints through paintTheme, so
// the registry entry IS the contract. caret-light is the light one — distinct from
// whatever caret-dark :root might carry, so a leak onto the root is unmistakable.
const PREVIEWED = THEMES["caret-light"];

const baseProps = { themeId: PREVIEWED.id, label: PREVIEWED.label };

function root(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>("[data-slot='theme-preview']");
}

describe("ThemePreviewCard chrome", () => {
  test("renders a macOS window with three traffic-light dots and the theme label", () => {
    const { flush } = render(ThemePreviewCard, baseProps);
    flush();
    const el = root();
    expect(el === null).toBe(false);
    expect(el?.querySelectorAll(".tp-dot").length).toBe(3);
    // The theme name identifies which palette is being previewed (title + a11y name).
    expect(el?.textContent).toContain("caret light");
  });

  test("reuses the vendored Skeleton primitive for the placeholder bars", () => {
    const { flush } = render(ThemePreviewCard, baseProps);
    flush();
    // Sidebar rows + plan-pane bars are all skeleton blocks — redacted placeholders.
    expect((root()?.querySelectorAll("[data-slot='skeleton']").length ?? 0) >= 3).toBe(true);
  });
});

describe("ThemePreviewCard tinting is scoped to the card", () => {
  test("applies the previewed theme's tokens as inline custom properties on its own root", () => {
    const { flush } = render(ThemePreviewCard, baseProps);
    flush();
    const el = root();
    for (const [name, value] of Object.entries(PREVIEWED.tokens)) {
      expect(el?.style.getPropertyValue(name), name).toBe(value);
    }
  });

  // The scheme travels with the palette (EXC-884), so scheme-keyed rules inside the
  // card resolve against the PREVIEWED scheme rather than the app's.
  test("carries the previewed palette's scheme as color-scheme and data-theme", () => {
    const { flush } = render(ThemePreviewCard, baseProps);
    flush();
    const el = root();
    expect(el?.dataset.theme).toBe(PREVIEWED.scheme);
    expect(el?.style.getPropertyValue("color-scheme")).toBe(PREVIEWED.scheme);
  });

  test("never writes the tokens onto the document root (:root untouched)", () => {
    const beforePaper = document.documentElement.style.getPropertyValue("--paper");
    const beforeScheme = document.documentElement.dataset.theme;
    const { flush } = render(ThemePreviewCard, baseProps);
    flush();
    expect(document.documentElement.style.getPropertyValue("--paper")).toBe(beforePaper);
    expect(document.documentElement.dataset.theme).toBe(beforeScheme);
  });

  // The card paints through the shared paintTheme (EXC-884) rather than a setProperty
  // loop of its own, which would drift from the registry's stamp.
  test("owns no paint loop of its own — it delegates to paintTheme", () => {
    const source = readFileSync(join(import.meta.dir, "ThemePreviewCard.svelte"), "utf8");
    expect(/\.setProperty\s*\(/.test(source)).toBe(false);
    // Line-anchored so the header's own `paintTheme(themeId, node)` prose can't
    // satisfy it — a comment line starts with `//`, a call does not.
    expect(/^\s*paintTheme\(/m.test(source)).toBe(true);
  });
});

describe("ThemePreviewCard single-primary rule", () => {
  test("marks exactly one element as the accent-bearing (selected) row", () => {
    const { flush } = render(ThemePreviewCard, baseProps);
    flush();
    expect(root()?.querySelectorAll("[data-tp-accent]").length).toBe(1);
  });
});

describe("ThemePreviewCard samples the palette beyond the accent", () => {
  test("shows added and removed diff lines (pulling in --ok / --danger)", () => {
    const { flush } = render(ThemePreviewCard, baseProps);
    flush();
    const el = root();
    // Caret is a diff/plan reviewer, so the plan pane reads as a diff: some lines are
    // additions (green --ok), one is a removal (red --danger) — more of the palette on show.
    expect((el?.querySelectorAll("[data-tp-diff='add']").length ?? 0) >= 1).toBe(true);
    expect((el?.querySelectorAll("[data-tp-diff='del']").length ?? 0) >= 1).toBe(true);
  });

  // The mark vocabulary is a quarter of the palette's hue jobs (EXC-905). Two
  // segments, not one: --mark-active only means anything beside a plain --mark, so
  // the pair is what advertises the two-step.
  test("shows a marked run and the current match (pulling in --mark / --mark-active)", () => {
    const { flush } = render(ThemePreviewCard, baseProps);
    flush();
    expect((root()?.querySelectorAll("[data-tp-mark]").length ?? 0) >= 2).toBe(true);
  });

  for (const token of ["--mark", "--mark-active"]) {
    test(`paints an element in ${token}`, () => {
      const source = readFileSync(join(import.meta.dir, "ThemePreviewCard.svelte"), "utf8");
      // The negative lookahead keeps --mark from matching --mark-active.
      expect(new RegExp(`var\\(\\s*${token}(?![\\w-])`).test(source)).toBe(true);
    });
  }
});

describe("ThemePreviewCard covers the theme-dropdown swatch colors (EXC-753)", () => {
  // The preview's floor: it must paint at least the same tokens the option's swatch
  // dots show (SWATCH_TOKENS) — background, raised surface, ink, accent, positive hue —
  // so a hovered theme never previews fewer colors than its dots. Extra hues
  // (--danger, --attention, the marks) are welcome; these five are the minimum.
  const source = readFileSync(join(import.meta.dir, "ThemePreviewCard.svelte"), "utf8");

  for (const token of SWATCH_TOKENS) {
    test(`paints an element in ${token}`, () => {
      // A real var(<token>) usage — the negative lookahead keeps --paper from matching
      // --paper-raised, and --ink from matching --ink-soft / --ink-faint.
      expect(new RegExp(`var\\(\\s*${token}(?![\\w-])`).test(source)).toBe(true);
    });
  }
});

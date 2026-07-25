import "@ui/test-mount.ts";

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { render } from "@ui/test-mount.ts";
import ThemePreviewCard from "@/components/ThemePreviewCard.svelte";
import { SWATCH_TOKENS } from "$lib/settingsRegistry.ts";

// A representative palette: distinctive hex values so a token that lands on the card
// root is unmistakable, and separable from anything :root might carry.
const TOKENS = {
  "--paper": "#101112",
  "--paper-raised": "#1a1b1c",
  "--paper-sunk": "#0c0d0e",
  "--ink": "#eeeeee",
  "--ink-soft": "#aaaaaa",
  "--ink-faint": "#777777",
  "--rule": "#ffffff22",
  "--rule-strong": "#ffffff33",
  "--accent": "#ff8800",
  "--accent-wash": "#ff880033",
} as const;

const baseProps = { tokens: TOKENS, label: "caret light" };

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
  test("applies the passed tokens as inline custom properties on its own root", () => {
    const { flush } = render(ThemePreviewCard, baseProps);
    flush();
    const el = root();
    expect(el?.style.getPropertyValue("--paper")).toBe("#101112");
    expect(el?.style.getPropertyValue("--ink")).toBe("#eeeeee");
    expect(el?.style.getPropertyValue("--accent")).toBe("#ff8800");
  });

  test("never writes the tokens onto the document root (:root untouched)", () => {
    const before = document.documentElement.style.getPropertyValue("--paper");
    const { flush } = render(ThemePreviewCard, baseProps);
    flush();
    expect(document.documentElement.style.getPropertyValue("--paper")).toBe(before);
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
});

describe("ThemePreviewCard covers the theme-dropdown swatch colors (EXC-753)", () => {
  // The preview's floor: it must paint at least the same tokens the option's swatch
  // dots show (SWATCH_TOKENS) — background, raised surface, ink, accent, positive hue —
  // so a hovered theme never previews fewer colors than its dots. Extra hues
  // (--danger / --attention) are welcome; these five are the minimum.
  const source = readFileSync(join(import.meta.dir, "ThemePreviewCard.svelte"), "utf8");

  for (const token of SWATCH_TOKENS) {
    test(`paints an element in ${token}`, () => {
      // A real var(<token>) usage — the negative lookahead keeps --paper from matching
      // --paper-raised, and --ink from matching --ink-soft / --ink-faint.
      expect(new RegExp(`var\\(\\s*${token}(?![\\w-])`).test(source)).toBe(true);
    });
  }
});

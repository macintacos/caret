// How the `/` search marks read in every bundled theme, light and dark. The marks are CSS
// Custom Highlights, which only a real browser paints, so each is measured off a screenshot
// of the plan here. Which ranges register, and when, is plan-search.e2e.ts and
// preview-search.e2e.ts; the colours come from paletteTokens in ui/src/lib/themes/recipe.ts.
//
// Distances are CIE76 colour differences (ΔE), where about 2.3 is just noticeable and 20
// tells two colours apart at a glance. Dawnfox sits closest to each distance floor, and
// Catppuccin Latte to the contrast floor.

import type { Page } from "@playwright/test";

import { sourceToggle } from "@test/e2e/support/chrome.ts";
import { colorDistance, contrast, highlightPaint, paintOver } from "@test/e2e/support/color.ts";
import { expect, test } from "@test/e2e/support/fixtures.ts";
import { openPlanForKeys, PLAN_PREVIEW, PREVIEW_DRAG } from "@test/e2e/support/source-view.ts";
import { bundledThemes } from "@test/support/theme.ts";

// At 2x a glyph's stems are several pixels wide, so its core shows the text's own colour
// rather than one antialiased toward the fill.
test.use({ deviceScaleFactor: 2 });

/** An other match stands this far off the line it sits on, */
const OTHER_FROM_LINE = 18;
/** and this many times as far as a comment span's `--mark` on that line does. */
const OTHER_OVER_SPAN = 1.5;
/** The current match stands this far off its line, the cursor's, and further off than an
 * other match does. */
const CURRENT_FROM_LINE = 45;
/** The current match stands this far off an other match. */
const CURRENT_FROM_OTHER = 30;
/** The text inside either match holds the body-text floor. */
const TEXT_CONTRAST = 4.5;

// The current match opens the first line, so the cursor's band lies under that line's chip;
// the table's header rides its pad's lit top.
const PLAN = [
  "The first lantern sits beside a `lantern` chip.",
  "The second lantern waits here.",
  "| Column | Lantern |\n| --- | --- |\n| row | x |",
  "",
].join("\n\n");

const VIEWS = {
  source: { other: "caret-search", current: "caret-search-current" },
  preview: { other: "caret-preview-search", current: "caret-preview-search-current" },
} as const;

async function useTheme(page: Page, theme: { scheme: string; id: string }): Promise<void> {
  await page.addInitScript(
    ([scheme, id]) => {
      localStorage.setItem("caret.theme.mode", scheme);
      localStorage.setItem(`caret.theme.${scheme}`, id);
    },
    [theme.scheme, theme.id] as const,
  );
}

async function showPreview(page: Page): Promise<void> {
  await sourceToggle(page).click();
  await expect(page.locator(PLAN_PREVIEW)).toBeVisible();
}

async function search(page: Page, query: string, current: string): Promise<void> {
  await page.mouse.move(0, 0);
  await page.keyboard.press("/");
  await page.keyboard.type(query);
  await page.keyboard.press("Enter");
  await expect
    .poll(() => page.evaluate((name) => CSS.highlights.get(name)?.size ?? 0, current))
    .toBe(1);
}

test("a match on a thematic break marks the row and draws none of its dashes", async ({
  daemon,
  page,
}) => {
  await openPlanForKeys(
    page,
    daemon,
    ["Above the break.", "---", "Below the break.", ""].join("\n\n"),
  );
  await search(page, "---", VIEWS.source.current);

  const [mark] = await highlightPaint(page, VIEWS.source.current);
  if (mark === undefined) throw new Error("the match did not paint");
  expect(await colorDistance(page, mark.fill, mark.ground)).toBeGreaterThanOrEqual(
    CURRENT_FROM_LINE,
  );
  expect(await colorDistance(page, mark.ink, mark.fill)).toBeLessThan(3);
});

for (const theme of bundledThemes()) {
  for (const [view, names] of Object.entries(VIEWS)) {
    test(`the current match leads and every other match stands out, ${theme.id} ${view}`, async ({
      daemon,
      page,
    }) => {
      await useTheme(page, theme);
      await openPlanForKeys(page, daemon, PLAN);
      if (view === "preview") await showPreview(page);
      await search(page, "lantern", names.current);

      const [current] = await highlightPaint(page, names.current);
      const others = await highlightPaint(page, names.other);
      const other = others.find((paint) => paint.block.includes("second"));
      if (current === undefined || other === undefined) throw new Error("a match did not paint");
      expect(current.block).toContain("first");
      expect(others).toHaveLength(3);

      const mark = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--mark").trim(),
      );
      const spanFromLine = await colorDistance(
        page,
        await paintOver(page, mark, other.ground),
        other.ground,
      );
      const otherFromLine = await colorDistance(page, other.fill, other.ground);
      const currentFromLine = await colorDistance(page, current.fill, current.ground);
      expect(otherFromLine).toBeGreaterThanOrEqual(OTHER_FROM_LINE);
      expect(otherFromLine).toBeGreaterThanOrEqual(OTHER_OVER_SPAN * spanFromLine);
      expect(currentFromLine).toBeGreaterThanOrEqual(CURRENT_FROM_LINE);
      expect(currentFromLine).toBeGreaterThan(otherFromLine);
      expect(await colorDistance(page, current.fill, other.fill)).toBeGreaterThanOrEqual(
        CURRENT_FROM_OTHER,
      );
      expect(contrast(current.ink, current.fill)).toBeGreaterThanOrEqual(TEXT_CONTRAST);
      for (const paint of others) {
        expect(contrast(paint.ink, paint.fill), paint.block).toBeGreaterThanOrEqual(TEXT_CONTRAST);
      }
    });
  }

  // `V`, then `/`, extends a selection to a match, so the current one lands under the
  // preview's selection band and its cursor's, both drawn over the text.
  test(`the current match holds its text under a held selection, ${theme.id} preview`, async ({
    daemon,
    page,
  }) => {
    await useTheme(page, theme);
    await openPlanForKeys(
      page,
      daemon,
      ["Where the selection starts.", "Where it runs on.", "The lantern it reaches.", ""].join(
        "\n\n",
      ),
    );
    await showPreview(page);
    await page.keyboard.press("V");
    await page.keyboard.press("j");
    await search(page, "lantern", VIEWS.preview.current);
    await expect
      .poll(() =>
        page.evaluate(
          ([bands, name]) => {
            const range = [...(CSS.highlights.get(name) ?? [])][0] as Range | undefined;
            const box = range?.getBoundingClientRect();
            const boxes = [...document.querySelectorAll(bands)].map((band) =>
              band.getBoundingClientRect(),
            );
            return (
              box !== undefined &&
              boxes.length === 2 &&
              boxes.every((band) => band.top <= box.top && band.bottom >= box.bottom)
            );
          },
          [`${PREVIEW_DRAG}, [data-caret-preview-cursor]`, VIEWS.preview.current] as const,
        ),
      )
      .toBe(true);

    const [current] = await highlightPaint(page, VIEWS.preview.current);
    if (current === undefined) throw new Error("the match did not paint");
    expect(contrast(current.ink, current.fill)).toBeGreaterThanOrEqual(TEXT_CONTRAST);
  });
}

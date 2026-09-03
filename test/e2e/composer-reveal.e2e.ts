// Composer reveal (EXC-782): opening a comment near the bottom of the plan left
// the composer clipped, often with its whole Comment / Keep for later / Discard
// row off screen. The composer now scrolls itself into view on mount, moving the
// plan the minimum amount that shows the whole card. Real layout and real scroll
// behavior, so it is an e2e per browser-testing.md — happy-dom reports zero for
// every metric this measures.

import type { Locator, Page } from "@playwright/test";

import { TALL_PLAN } from "@test/e2e/support/fixture-plan.ts";
import { type Daemon, expect, test } from "@test/e2e/support/fixtures.ts";
import {
  openPlan,
  PLAN_SURFACE,
  revealGutterPlus,
  submitComposer,
} from "@test/e2e/support/source-view.ts";

// TALL_PLAN is several viewports tall, so a composer can open well below the fold
// and there is always somewhere to scroll to.

/** The highest 1-based line whose gutter cell still sits fully inside the scroll
 * viewport — the anchor whose composer is guaranteed to open past the fold, since
 * the annotation row renders below its line. */
async function lastVisibleLine(page: Page): Promise<number> {
  const line = await page.evaluate(() => {
    const scroller = document.querySelector(".diff-plan");
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    if (scroller == null || sh == null) return 0;
    const viewBottom = scroller.getBoundingClientRect().bottom;
    let best = 0;
    for (const span of sh.querySelectorAll("[data-line-number-content]")) {
      const cell = span.parentElement as HTMLElement | null;
      const index = cell?.dataset.lineIndex;
      if (cell == null || index === undefined) continue;
      if (cell.getBoundingClientRect().bottom > viewBottom) continue;
      best = Math.max(best, Number(index) + 1);
    }
    return best;
  });
  if (line === 0) throw new Error("no fully-visible source line found");
  return line;
}

/** How far `dialog`'s bottom edge overhangs the scroll viewport's, in px.
 * `<= 0` means the whole card — label, editor, action row — is on screen. */
async function bottomOverhang(dialog: Locator): Promise<number> {
  return dialog.evaluate((el) => {
    const scroller = document.querySelector(".diff-plan");
    if (scroller == null) return Number.NaN;
    return el.getBoundingClientRect().bottom - scroller.getBoundingClientRect().bottom;
  });
}

/** Resolve once `count` animation frames have elapsed. Frames, not wall-clock:
 * this rides the same rAF loop the reveal measures on, so it outlasts the
 * height-settle retry without racing it or sleeping a fixed span. */
async function afterFrames(page: Page, count: number): Promise<void> {
  await page.evaluate(
    (n) =>
      new Promise<void>((resolve) => {
        let left = n;
        const tick = () => (--left <= 0 ? resolve() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    count,
  );
}

async function loadPlan(page: Page, daemon: Daemon): Promise<void> {
  await openPlan(page, daemon, TALL_PLAN);
  await expect(page.locator(".diffview [data-content] [data-line]").first()).toBeVisible();
}

/** Scroll the plan a third of the way down, so there is plan above and below whatever
 * opens next. Returns the plan view. */
async function parkAThirdDown(page: Page): Promise<Locator> {
  const view = page.locator(PLAN_SURFACE);
  await view.evaluate((el) => el.scrollTo({ top: Math.round(el.scrollHeight / 3) }));
  await expect.poll(() => view.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  return view;
}

/** Open a composer on the last fully visible line — the line whose composer is
 * guaranteed to open past the fold, since the annotation row renders below its line. */
async function openComposerOnLastVisibleLine(page: Page): Promise<Locator> {
  const plus = await revealGutterPlus(page, await lastVisibleLine(page));
  await plus.click();
  const composer = page.getByRole("dialog", { name: "Add a comment" });
  await expect(composer).toBeVisible();
  return composer;
}

/** Scroll so `target`'s bottom edge rests on the scroll viewport's bottom edge.
 * Driven off the Locator, not a re-query: it auto-waits and throws on a miss, so
 * a precondition that silently did not happen fails here rather than leaving the
 * assertion that depends on it to pass for the wrong reason. */
async function parkAtBottom(target: Locator): Promise<void> {
  await target.evaluate((el) => {
    const scroller = document.querySelector(".diff-plan");
    if (scroller == null) throw new Error("no .diff-plan scroller");
    const delta = el.getBoundingClientRect().bottom - scroller.getBoundingClientRect().bottom;
    scroller.scrollBy({ top: delta, behavior: "auto" });
  });
}

test("a composer opened on the last visible line scrolls itself fully into view", async ({
  daemon,
  page,
}) => {
  await loadPlan(page, daemon);

  // Park a third of the way down, so there is plan above and below the composer.
  const view = await parkAThirdDown(page);
  const before = await view.evaluate((el) => el.scrollTop);

  // The composer opens in the annotation row BELOW this line, so it starts clipped.
  const composer = await openComposerOnLastVisibleLine(page);

  // The whole card ends up on screen — the poll absorbs the settle frames and the
  // smooth scroll — and it took a scroll to get there. Without the reveal the view
  // never moves and the action row stays below the fold.
  await expect.poll(() => bottomOverhang(composer)).toBeLessThanOrEqual(0);
  expect(await view.evaluate((el) => el.scrollTop)).toBeGreaterThan(before);
});

test("a composer that already fits leaves the view exactly where it was", async ({
  daemon,
  page,
}) => {
  await loadPlan(page, daemon);

  const view = page.locator(PLAN_SURFACE);
  const before = await view.evaluate((el) => el.scrollTop);

  // Line 3 is body text near the top, with the whole viewport below it.
  const plus = await revealGutterPlus(page, 3);
  await plus.click();

  const composer = page.getByRole("dialog", { name: "Add a comment" });
  await expect(composer).toBeVisible();
  // Measured against the scroller, like every other geometry check here — not
  // toBeInViewport, which reads the window and passes on a single pixel.
  expect(await bottomOverhang(composer)).toBeLessThanOrEqual(0);

  // Past the settle cap, so the measurement has certainly run: it found the card
  // already inside the viewport and moved nothing.
  await afterFrames(page, 40);
  expect(await view.evaluate((el) => el.scrollTop)).toBe(before);
});

test("re-opening a saved comment for editing inherits the same reveal", async ({
  daemon,
  page,
}) => {
  await loadPlan(page, daemon);
  const view = await parkAThirdDown(page);

  // Leave a comment anchored near the bottom of the view.
  const composer = await openComposerOnLastVisibleLine(page);

  // Park the saved card flush against the bottom edge, so the taller edit
  // composer that replaces it is clipped the moment it mounts.
  const card = await submitComposer(composer, "Worth a second look.");
  await parkAtBottom(card);
  const before = await view.evaluate((el) => el.scrollTop);
  await card.getByRole("button", { name: "Edit" }).click();

  // The edit surface is the same component, so it reveals itself the same way —
  // this is the second parent inheriting the behavior, not a second wiring. The
  // card was parked flush, so the taller composer cannot fit without a scroll.
  const editor = page.getByRole("dialog", { name: "Edit comment" });
  await expect(editor).toBeVisible();
  await expect.poll(() => bottomOverhang(editor)).toBeLessThanOrEqual(0);
  expect(await view.evaluate((el) => el.scrollTop)).toBeGreaterThan(before);
});

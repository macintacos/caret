// The plan view's Preview toggle (EXC-2012): a button beside Versions swaps the
// single-version source view for the rendered preview, the browser remembers the
// choice, and compare mode hides the toggle and shows source until it hands the
// remembered view back.
//
// What needs a real browser here: focus staying on the toggle across a flip,
// persistence across a real page.reload(), a long paragraph's layout wrap
// (scrollWidth against clientWidth), the `indeterminate` property a live DOM sets,
// the `?heading=` deep link held across a preview mount and honored on the first
// source mount, scroll position across a live daemon.addVersion, and a flip keeping
// the reader's place — the reading zone's live geometry, wheel scrolling, and an
// image's late load above the parked block. The pure half stays units: the preference
// and surface table in ui/src/lib/planView.test.ts, the mount in
// ui/src/components/PlanPreview.test.ts, the toggle's wiring in
// ui/src/components/DiffPlanView.test.ts, and the place lookups and hold in
// ui/src/lib/planPlace.test.ts and ui/src/lib/diffview/scroll.test.ts.

import type { Locator, Page } from "@playwright/test";

import { currentCrumb, previewToggle as toggle } from "@test/e2e/support/chrome.ts";
import { expect, test } from "@test/e2e/support/fixtures.ts";
import {
  lineCenterY,
  lineOf,
  PLAN_PREVIEW as PREVIEW,
  planSurface,
  previewTopBlock,
  settledMutations,
  sourceTopLine,
} from "@test/e2e/support/source-view.ts";
import { SCROLL_OFFSET_TOP } from "@ui/src/lib/layout.ts";

const paragraphs = (tag: string) =>
  Array.from({ length: 30 }, (_, i) => `${tag} paragraph ${i + 1} of the plan body.`).join("\n\n");

const LONG_WORD = "x".repeat(600);
const TASK_PLAN = `# Plan\n\n- [/] half-done task\n- [x] done task\n\n${LONG_WORD}\n`;
const SECTIONED = `# Alpha\n\n${paragraphs("alpha")}\n\n## Bravo\n\n${paragraphs("bravo")}\n\n## Echo\n\n${paragraphs("echo")}\n`;

async function turnPreviewOn(page: Page): Promise<void> {
  await toggle(page).click();
  await expect(page.locator(PREVIEW)).toBeVisible();
}

test("the toggle flips a fresh origin from source to a laid-out preview", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: TASK_PLAN });
  await page.goto("/");
  await planSurface(page);
  await expect(page.locator(".diffview")).toBeVisible();
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");

  await toggle(page).focus();
  await page.keyboard.press("Enter");

  const preview = page.locator(PREVIEW);
  await expect(preview).toBeVisible();
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  await expect(toggle(page)).toBeFocused();
  const slashed = preview.locator('input[data-task="slashed"]');
  await expect.poll(() => slashed.evaluate((el: HTMLInputElement) => el.indeterminate)).toBe(true);
  const longParagraph = preview.locator("p", { hasText: LONG_WORD });
  await expect
    .poll(() => longParagraph.evaluate((el) => el.scrollWidth <= el.clientWidth))
    .toBe(true);
});

test("the preview stays on across a reload", async ({ daemon, page }) => {
  await daemon.seed({ plan: TASK_PLAN });
  await page.goto("/");
  await planSurface(page);
  await turnPreviewOn(page);

  await page.reload();

  await expect(page.locator(PREVIEW)).toBeVisible();
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
});

test("compare hides the toggle, then hands back the preview and re-arms heading tracking", async ({
  daemon,
  page,
}) => {
  await daemon.seedVersions(2, [SECTIONED, SECTIONED.replace("echo paragraph 1", "edited")]);
  await page.goto("/");
  await planSurface(page);
  await turnPreviewOn(page);

  await page.getByRole("button", { name: "Versions" }).click();
  await expect(toggle(page)).toHaveCount(0);

  await page.getByRole("button", { name: "Versions" }).click();
  await expect(page.locator(PREVIEW)).toBeVisible();

  await toggle(page).click();
  const plan = await planSurface(page);
  await plan.hover();
  await page.mouse.wheel(0, 100_000);
  await expect(currentCrumb(page)).toHaveText("Echo");
});

test("a ?heading= deep link waits under the preview for the first source mount", async ({
  daemon,
  page,
}) => {
  const id = await daemon.seed({ plan: SECTIONED });
  await page.goto("/");
  await planSurface(page);
  await turnPreviewOn(page);

  await page.goto(`/?review=${id}&heading=echo`);
  await expect(page.locator(PREVIEW)).toBeVisible();
  expect(new URL(page.url()).searchParams.get("heading")).toBe("echo");

  await toggle(page).click();
  await expect(currentCrumb(page)).toHaveText("Echo");
});

test("a new version re-renders the preview without losing scroll", async ({ daemon, page }) => {
  const id = await daemon.seed({ plan: SECTIONED });
  await page.goto("/");
  const plan = await planSurface(page);
  await turnPreviewOn(page);

  await page.locator(PREVIEW).hover();
  await page.mouse.wheel(0, 600);
  await expect.poll(() => plan.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  const scrollTopBefore = await plan.evaluate((el) => el.scrollTop);

  // The edit sits in the last section, below the viewport, so nothing above it moves.
  await daemon.addVersion(id, SECTIONED.replace("echo paragraph 30 ", "revised echo text "));

  await expect(page.locator(PREVIEW).getByText("revised echo text")).toHaveCount(1);
  await expect
    .poll(async () => Math.abs((await plan.evaluate((el) => el.scrollTop)) - scrollTopBefore))
    .toBeLessThan(2);
});

/** Wait until the plan's scrollTop holds still across two reads, so a wheel's
 * scroll has landed before a probe reads the reading zone. */
async function settleScroll(plan: Locator): Promise<void> {
  let previous = -1;
  await expect
    .poll(async () => {
      const now = await plan.evaluate((el) => el.scrollTop);
      const still = now === previous;
      previous = now;
      return still;
    })
    .toBe(true);
}

/** Wheel the plan by however far puts source `line`'s centre in the reading zone. */
async function wheelLineToZone(page: Page, plan: Locator, line: number): Promise<void> {
  const top = await plan.evaluate((el) => el.getBoundingClientRect().top);
  await plan.hover();
  await page.mouse.wheel(0, (await lineCenterY(page, line)) - top - SCROLL_OFFSET_TOP);
  await settleScroll(plan);
}

/** The start of the preview block a source line belongs to: the first block whose
 * span ends at or after it, so a line in a gap between blocks takes the next one. */
function blockStartFor(page: Page, line: number): Promise<number | null> {
  return page.evaluate(
    ({ preview, ln }) => {
      const block = [...document.querySelectorAll<HTMLElement>(`${preview} > div`)].find(
        (b) => Number(b.dataset.sourceEnd) >= ln,
      );
      return block ? Number(block.dataset.sourceStart) : null;
    },
    { preview: PREVIEW, ln: line },
  );
}

const parkedAt = async (page: Page, start: number): Promise<boolean> => {
  const block = await previewTopBlock(page);
  return block?.start === start && Math.abs(block.top - SCROLL_OFFSET_TOP) <= 2;
};

const CODE_LINES = Array.from({ length: 40 }, (_, i) => `code line ${i + 1}`).join("\n");
const PLACE_PLAN = SECTIONED.replace(
  "bravo paragraph 10 of the plan body.",
  (p) => `${p}\n\n\`\`\`text\n${CODE_LINES}\n\`\`\``,
);
const LATE_IMAGE = "https://assets.test/late.svg";
const IMAGE_PLAN = SECTIONED.replace(
  "alpha paragraph 10 of the plan body.",
  (p) => `${p}\n\n![late](${LATE_IMAGE})`,
);

test("flipping keeps the reader's place in both directions", async ({ daemon, page }) => {
  await daemon.seed({ plan: PLACE_PLAN });
  await page.goto("/");
  const plan = await planSurface(page);
  await expect(page.locator(".diffview")).toBeVisible();
  await plan.hover();
  await page.mouse.wheel(0, 1500);
  await settleScroll(plan);

  const line = (await sourceTopLine(page)) as number;
  await toggle(page).click();
  await expect(page.locator(PREVIEW)).toBeVisible();
  const start = (await blockStartFor(page, line)) as number;
  await expect.poll(() => parkedAt(page, start)).toBe(true);

  await page.locator(PREVIEW).hover();
  await page.mouse.wheel(0, 900);
  await settleScroll(plan);
  const back = (await previewTopBlock(page))?.start;
  await toggle(page).click();
  await expect.poll(() => sourceTopLine(page)).toBe(back);
  await settledMutations(page);
  expect(await sourceTopLine(page)).toBe(back);
});

test("a round trip from inside a code block lands within it", async ({ daemon, page }) => {
  await daemon.seed({ plan: PLACE_PLAN });
  await page.goto("/");
  const plan = await planSurface(page);
  const fenceStart = (await lineOf(page, "code line 1")) - 1;
  const fenceEnd = (await lineOf(page, "code line 40")) + 1;
  await wheelLineToZone(page, plan, fenceStart + 20);
  const inside = (await sourceTopLine(page)) as number;
  expect(inside).toBeGreaterThan(fenceStart);
  expect(inside).toBeLessThan(fenceEnd);

  await turnPreviewOn(page);
  await expect.poll(() => parkedAt(page, fenceStart)).toBe(true);
  await toggle(page).click();

  await expect.poll(() => sourceTopLine(page)).toBe(fenceStart);
});

test("the anchored block stays put while an image above it loads", async ({ daemon, page }) => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(LATE_IMAGE, async (route) => {
    await gate;
    await route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="700"/>',
    });
  });
  await daemon.seed({ plan: IMAGE_PLAN });
  await page.goto("/");
  const plan = await planSurface(page);
  // Chromium's native scroll anchoring would hide a missing hold; with it off, the
  // test proves caret's own, which is all Safari (≤ 26, no anchoring) has.
  await page.addStyleTag({ content: ".diff-plan { overflow-anchor: none !important; }" });
  await wheelLineToZone(page, plan, await lineOf(page, "alpha paragraph 14 of the plan body."));

  const line = (await sourceTopLine(page)) as number;
  await turnPreviewOn(page);
  const start = (await blockStartFor(page, line)) as number;
  await expect.poll(() => parkedAt(page, start)).toBe(true);

  release();
  const image = page.locator(`${PREVIEW} img`);
  await expect
    .poll(() => image.evaluate((el: HTMLImageElement) => el.complete && el.naturalHeight > 0))
    .toBe(true);
  await expect.poll(() => parkedAt(page, start)).toBe(true);
});

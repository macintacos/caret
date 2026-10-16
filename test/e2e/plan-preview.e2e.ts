// The plan view's Preview toggle (EXC-2012): a button beside Versions swaps the
// single-version source view for the rendered preview, the browser remembers the
// choice, and compare mode hides the toggle and shows source until it hands the
// remembered view back.
//
// What needs a real browser here: focus staying on the toggle across a flip,
// persistence across a real page.reload(), a long paragraph's layout wrap
// (scrollWidth against clientWidth), the `indeterminate` property a live DOM sets,
// a `?heading=` deep link landing under the preview, the preview mirroring the
// heading it reads and the picker jumping it, scroll position across a live
// daemon.addVersion, and a flip keeping the reader's place — the reading zone's live geometry, wheel scrolling, and an
// image's late load above the parked block. The pure half stays units: the preference
// and surface table in ui/src/lib/planView.test.ts, the mount in
// ui/src/components/PlanPreview.test.ts, the toggle's wiring in
// ui/src/components/DiffPlanView.test.ts, and the place lookups and hold in
// ui/src/lib/planPlace.test.ts and ui/src/lib/diffview/scroll.test.ts.

import type { Locator, Page } from "@playwright/test";

import { currentCrumb, previewToggle as toggle } from "@test/e2e/support/chrome.ts";
import { type Daemon, expect, test } from "@test/e2e/support/fixtures.ts";
import {
  jumpToHeading,
  lineCenterY,
  lineOf,
  PLAN_SURFACE,
  PLAN_PREVIEW as PREVIEW,
  planSurface,
  previewTopBlock,
  settledMutations,
  sourceTopLine,
  wheelPlan,
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

const lineOfHeading = (heading: string) => SECTIONED.split("\n").indexOf(heading) + 1;
const BRAVO_LINE = lineOfHeading("## Bravo");
const ECHO_LINE = lineOfHeading("## Echo");
const headingParam = (page: Page) => new URL(page.url()).searchParams.get("heading");

async function seedOnPreview(daemon: Daemon, page: Page): Promise<string> {
  const id = await daemon.seed({ plan: SECTIONED });
  await page.goto("/");
  await planSurface(page);
  await turnPreviewOn(page);
  return id;
}

test("a ?heading= deep link lands under the preview", async ({ daemon, page }) => {
  const id = await seedOnPreview(daemon, page);

  await page.goto(`/?review=${id}&heading=echo`);

  await expect.poll(() => parkedAt(page, ECHO_LINE)).toBe(true);
  await expect(currentCrumb(page)).toHaveText("Echo");
  await expect.poll(() => headingParam(page)).toBe("echo");
});

test("the preview mirrors the heading it reads, and that URL opens there in either view", async ({
  daemon,
  page,
}) => {
  await seedOnPreview(daemon, page);
  await expect(currentCrumb(page)).toHaveText("Alpha");
  await expect
    .poll(async () => {
      await wheelPlan(page, 300, PREVIEW);
      return currentCrumb(page).textContent();
    })
    .toBe("Bravo");
  await expect.poll(() => headingParam(page)).toBe("bravo");
  const url = page.url();

  await page.goto(url);
  await expect.poll(() => parkedAt(page, BRAVO_LINE)).toBe(true);

  await page.evaluate(() => localStorage.setItem("caret.planView", "source"));
  await page.goto(url);
  await expect.poll(() => sourceTopLine(page)).toBe(BRAVO_LINE);
  await expect(currentCrumb(page)).toHaveText("Bravo");
});

test("the contents popup jumps the preview", async ({ daemon, page }) => {
  await seedOnPreview(daemon, page);

  await page.keyboard.press("\\");
  await page.getByRole("option").filter({ hasText: "Echo" }).click();

  await expect.poll(() => parkedAt(page, ECHO_LINE)).toBe(true);
  await expect(currentCrumb(page)).toHaveText("Echo");
  await expect.poll(() => headingParam(page)).toBe("echo");
});

test("the breadcrumbs jump the preview", async ({ daemon, page }) => {
  await seedOnPreview(daemon, page);

  await jumpToHeading(page, "Bravo");

  await expect.poll(() => parkedAt(page, BRAVO_LINE)).toBe(true);
  await expect(currentCrumb(page)).toHaveText("Bravo");
});

test("a flip back to source keeps the place over the mirrored heading", async ({
  daemon,
  page,
}) => {
  await seedOnPreview(daemon, page);
  await jumpToHeading(page, "Echo");
  await expect.poll(() => parkedAt(page, ECHO_LINE)).toBe(true);
  await wheelPlan(page, 600, PREVIEW);
  const start = await present(
    async () => (await previewTopBlock(page))?.start,
    "no preview block at the reading zone",
  );
  expect(start).toBeGreaterThan(ECHO_LINE + 2);
  await expect.poll(() => headingParam(page)).toBe("echo");

  await toggle(page).click();

  await expect.poll(() => sourceTopLine(page)).toBe(start);
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

/** Wheel the plan by however far puts source `line`'s centre in the reading zone. */
async function wheelLineToZone(page: Page, plan: Locator, line: number): Promise<void> {
  const top = await plan.evaluate((el) => el.getBoundingClientRect().top);
  await wheelPlan(page, (await lineCenterY(page, line)) - top - SCROLL_OFFSET_TOP);
}

/** Polls a nullable probe until it reads a value, failing with `message` otherwise,
 * and returns the value it proved — a re-read could come back null. */
async function present<T>(read: () => Promise<T | null | undefined>, message: string): Promise<T> {
  // An object, not a local: control-flow analysis cannot see into the poll callback.
  const last: { value: T | null | undefined } = { value: null };
  await expect
    .poll(
      async () => {
        last.value = await read();
        return last.value != null;
      },
      { message },
    )
    .toBe(true);
  return last.value as T;
}

const readingLine = (page: Page) =>
  present(() => sourceTopLine(page), "no source row at the reading zone");

const blockStart = (page: Page, line: number) =>
  present(() => blockStartFor(page, line), `no preview block reaches source line ${line}`);

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

/** Whether the preview block starting at `start` sits parked at the reading zone. */
async function parkedAt(page: Page, start: number): Promise<boolean> {
  const block = await previewTopBlock(page);
  // 2px: device-pixel rounding of the parked scrollTop plus the probe's own rect read.
  return block?.start === start && Math.abs(block.top - SCROLL_OFFSET_TOP) <= 2;
}

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
  await planSurface(page);
  await expect(page.locator(".diffview")).toBeVisible();
  await wheelPlan(page, 1500);

  const line = await readingLine(page);
  await toggle(page).click();
  await expect(page.locator(PREVIEW)).toBeVisible();
  const start = await blockStart(page, line);
  await expect.poll(() => parkedAt(page, start)).toBe(true);

  await wheelPlan(page, 900, PREVIEW);
  const previewStart = await present(
    async () => (await previewTopBlock(page))?.start,
    "no preview block at the reading zone",
  );
  await toggle(page).click();
  await expect.poll(() => sourceTopLine(page)).toBe(previewStart);
  await settledMutations(page);
  // Deliberately one read: the claim is that it stayed, which a poll would weaken.
  expect(await sourceTopLine(page)).toBe(previewStart);
});

test("a round trip from inside a code block lands at its fence", async ({ daemon, page }) => {
  await daemon.seed({ plan: PLACE_PLAN });
  await page.goto("/");
  const plan = await planSurface(page);
  const fenceStart = (await lineOf(page, "code line 1")) - 1;
  const fenceEnd = (await lineOf(page, "code line 40")) + 1;
  await wheelLineToZone(page, plan, fenceStart + 20);
  const inside = await readingLine(page);
  expect(inside).toBeGreaterThan(fenceStart);
  expect(inside).toBeLessThan(fenceEnd);

  await turnPreviewOn(page);
  await expect.poll(() => parkedAt(page, fenceStart)).toBe(true);
  await toggle(page).click();

  await expect.poll(() => sourceTopLine(page)).toBe(fenceStart);
});

/** Seeds IMAGE_PLAN with its image held back until the returned `release` is called,
 * flips to the preview from below the image, and waits until the reader's block is
 * parked. Returns that block's start and `release`. */
async function parkBelowLateImage(
  daemon: Daemon,
  page: Page,
): Promise<{ start: number; release: () => Promise<void> }> {
  let open = () => {};
  const gate = new Promise<void>((resolve) => {
    open = resolve;
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

  const line = await readingLine(page);
  await turnPreviewOn(page);
  const start = await blockStart(page, line);
  await expect.poll(() => parkedAt(page, start)).toBe(true);

  const release = async () => {
    open();
    const image = page.locator(`${PREVIEW} img`);
    await expect
      .poll(() => image.evaluate((el: HTMLImageElement) => el.complete && el.naturalHeight > 0))
      .toBe(true);
  };
  return { start, release };
}

test("the anchored block stays put while an image above it loads", async ({ daemon, page }) => {
  const { start, release } = await parkBelowLateImage(daemon, page);
  await release();
  await expect.poll(() => parkedAt(page, start)).toBe(true);
});

test("a reader who scrolls away is not pulled back when an image loads", async ({
  daemon,
  page,
}) => {
  const { release } = await parkBelowLateImage(daemon, page);
  const plan = page.locator(PLAN_SURFACE);
  await wheelPlan(page, 200, PREVIEW);
  const scrolled = await plan.evaluate((el) => el.scrollTop);
  await release();
  // Two frames: the image's resize reaches a hold's observer within one.
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  // Deliberately one read: the claim is that it stayed, which a poll would weaken.
  expect(await plan.evaluate((el) => el.scrollTop)).toBe(scrolled);
});

// Dev-flagged source-view surface (EXC-583). With the flag on, the plan renders
// as line-numbered markdown source through the @pierre/diffs wrapper instead of
// the legacy plan view + contents rail. A left-hand filterable contents pane
// jumps to headings, the line gutter creates comments (EXC-584), and approve and
// request-changes still round-trip. The view instance must survive the 2s poll
// with no scroll reset.

import type { Locator, Page } from "@playwright/test";
import { expect, test, waitPastSafeModeGrace } from "./support/fixtures.ts";

// Every spec in this file boots a flag-on daemon.
test.use({ diffSurface: true });

// A plan tall enough to scroll the source view past one viewport.
const TALL_PLAN = `# Tall Plan\n\n${Array.from({ length: 120 }, (_, i) => `Line ${i + 1} of the plan body, long enough to overflow the viewport.`).join("\n\n")}\n`;

test("renders the plan as markdown source, with no legacy plan view or contents rail", async ({
  daemon,
  page,
}) => {
  await daemon.seed();
  await page.goto("/");

  // The source-view container is mounted; the plan source text is visible
  // (Playwright pierces the library's shadow root for text).
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.getByText("This plan reorganizes the widget cache")).toBeVisible();

  // The legacy surface is absent: no rendered-HTML article, no legacy rail.
  await expect(page.locator("article.plan")).toHaveCount(0);
  await expect(page.locator("nav.toc")).toHaveCount(0);
});

test("scroll position survives the 2-second poll tick", async ({ daemon, page }) => {
  await daemon.seed({ plan: TALL_PLAN });
  await page.goto("/");

  const view = page.locator(".diff-plan");
  await expect(view).toBeVisible();
  await expect(page.getByText("Line 1 of the plan body")).toBeVisible();

  // Scroll down, then assert the position settled at a non-zero offset.
  await view.evaluate((el) => {
    el.scrollTop = 400;
  });
  await expect.poll(async () => view.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  const before = await view.evaluate((el) => el.scrollTop);

  // Wait out more than two poll ticks (the poll re-delivers the same version
  // every 2s); a remount on an unchanged version would reset scrollTop to 0.
  // web-first: poll the condition rather than a fixed sleep.
  const t0 = await page.evaluate(() => performance.now());
  await page.waitForFunction((t) => performance.now() > t + 5000, t0);

  // Same scroll offset — the instance was preserved, not remounted.
  expect(await view.evaluate((el) => el.scrollTop)).toBe(before);
});

test("approving resolves the review on the source-view surface", async ({ daemon, page }) => {
  const id = await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();

  await page.getByRole("button", { name: "Approve", exact: true }).click();

  await expect(page.getByRole("heading", { name: "No plans awaiting review" })).toBeVisible();
  await expect.poll(async () => (await daemon.listReviews()).map((r) => r.id)).not.toContain(id);
});

test("request-changes with a general comment round-trips on the source-view surface", async ({
  daemon,
  page,
}) => {
  const id = await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await waitPastSafeModeGrace(page);

  const feedback = "Please tighten the verification section.";
  const dialog = page.getByRole("dialog", { name: "Request changes" });
  await page.getByRole("button", { name: "Request changes" }).click();
  await expect(dialog).toBeVisible();
  await dialog.locator("textarea").fill(feedback);
  await page.keyboard.press("ControlOrMeta+Enter");

  await expect(page.getByRole("heading", { name: "No plans awaiting review" })).toBeVisible();
  await expect.poll(async () => (await daemon.getReview(id)).body?.decision?.behavior).toBe("deny");
  const review = (await daemon.getReview(id)).body;
  expect(review?.status).toBe("rejected");
  expect(review?.decision?.feedback).toContain(feedback);
});

// ----- Filterable contents pane (EXC-580) -----

// A multi-heading plan with tall sections so a jump produces a visible scroll.
const padding = Array.from({ length: 40 }, (_, i) => `Filler line ${i + 1}.`).join("\n\n");
const TOC_PLAN = `# Overview\n\n${padding}\n\n## Approach\n\n${padding}\n\n## Verification\n\n${padding}\n`;

test("shows a filterable contents pane and jumps to a heading's line", async ({ daemon, page }) => {
  await daemon.seed({ plan: TOC_PLAN });
  await page.goto("/");

  const view = page.locator(".diff-plan");
  await expect(view).toBeVisible();

  // The pane lists every heading.
  const pane = page.getByRole("navigation", { name: "Plan contents" });
  await expect(pane).toBeVisible();
  await expect(pane.locator(".toc-row")).toHaveCount(3);

  // Filtering hides non-matching rows (hide-non-matches default).
  await pane.getByRole("textbox", { name: "Filter headings" }).fill("veri");
  await expect(pane.locator(".toc-row")).toHaveCount(1);
  await expect(pane.locator(".toc-row")).toHaveText("Verification");

  // Clicking the filtered heading jumps the source view down to its line.
  await pane.locator(".toc-row").click();
  await expect.poll(async () => view.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
});

test("suppresses the contents pane for a single-heading plan", async ({ daemon, page }) => {
  await daemon.seed({ plan: "# Only Heading\n\nNo other sections to navigate.\n" });
  await page.goto("/");

  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.getByText("No other sections to navigate")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Plan contents" })).toHaveCount(0);
});

// ----- Annotation creation from the line gutter (EXC-584) -----

// A plan with body text on several lines so a range spans real source lines.
const RANGE_PLAN = `# Range Plan\n\n${Array.from(
  { length: 12 },
  (_, i) => `Body line ${i + 1} content here.`,
).join("\n\n")}\n`;

/** The vertical center (viewport px) of a 1-based source line in the view. */
async function lineCenterY(page: Page, line: number): Promise<number> {
  return page.evaluate((ln) => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    const span = Array.from(sh?.querySelectorAll("[data-line-number-content]") ?? []).find(
      (s) => (s.parentElement as HTMLElement)?.dataset.lineIndex === String(ln - 1),
    );
    const r = (span?.parentElement as HTMLElement)?.getBoundingClientRect();
    return r ? r.y + r.height / 2 : 0;
  }, line);
}

/** Reveal the gutter `+` on `line` by moving the mouse over its left edge. The
 * source view's gutter sits at the left of the .diff-plan scroll container, which
 * the contents pane shifts right when present — so anchor the hover to that
 * container's left edge rather than the viewport's. */
async function revealGutterPlus(page: Page, line: number): Promise<Locator> {
  const y = await lineCenterY(page, line);
  const x = await page.locator(".diff-plan").evaluate((el) => el.getBoundingClientRect().x + 6);
  await page.mouse.move(x, y);
  const plus = page.locator(".diffview [data-utility-button]");
  await expect(plus).toBeVisible();
  return plus;
}

/**
 * Drag the gutter `+` from its current line down to `endLine`, producing a
 * multi-line SelectedLineRange. Driven with dispatched PointerEvents sharing one
 * pointerId — the library's document-level drag listener filters on pointerId,
 * which Playwright's CDP mouse drag does not carry consistently.
 */
async function dragGutterToLine(page: Page, endLine: number): Promise<void> {
  await page.evaluate((end) => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    if (!sh) return;
    const btn = sh.querySelector("[data-utility-button]") as HTMLElement;
    const br = btn.getBoundingClientRect();
    const x = br.x + br.width / 2;
    const rowY = (line: number) => {
      const span = Array.from(sh.querySelectorAll("[data-line-number-content]")).find(
        (s) => (s.parentElement as HTMLElement)?.dataset.lineIndex === String(line - 1),
      );
      const r = (span?.parentElement as HTMLElement).getBoundingClientRect();
      return r.y + r.height / 2;
    };
    const ev = (y: number) =>
      ({ pointerId: 1, clientX: x, clientY: y, bubbles: true, composed: true, button: 0 }) as const;
    btn.dispatchEvent(new PointerEvent("pointerdown", ev(br.y + br.height / 2)));
    document.dispatchEvent(new PointerEvent("pointermove", ev(rowY(end))));
    document.dispatchEvent(new PointerEvent("pointerup", ev(rowY(end))));
  }, endLine);
}

test("creating a single-line annotation from the gutter persists it line-anchored", async ({
  daemon,
  page,
}) => {
  const id = await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.getByText("This plan reorganizes the widget cache")).toBeVisible();

  // Line 3 is the "This plan reorganizes…" paragraph in the fixture plan.
  const plus = await revealGutterPlus(page, 3);
  await plus.click();

  const composer = page.getByRole("dialog", { name: "Add a comment" });
  await expect(composer).toBeVisible();
  await expect(composer.getByText("Line 3")).toBeVisible();
  await composer.locator("textarea").fill("Quantify the cold cost here.");
  await composer.getByRole("button", { name: "Comment" }).click();

  // The composer closes and the annotation persists line-anchored via /draft.
  await expect(composer).toHaveCount(0);
  await expect
    .poll(async () => (await daemon.getReview(id)).body?.annotations?.length ?? 0)
    .toBe(1);
  const ann = (await daemon.getReview(id)).body?.annotations?.[0];
  expect(ann).toMatchObject({ startLine: 3, endLine: 3, comment: "Quantify the cold cost here." });
});

test("creating a range annotation from the gutter persists the correct line span", async ({
  daemon,
  page,
}) => {
  const id = await daemon.seed({ plan: RANGE_PLAN });
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.getByText("Body line 1 content here.")).toBeVisible();

  // Reveal the + on line 5, then drag down to line 8 to select the range.
  await revealGutterPlus(page, 5);
  await dragGutterToLine(page, 8);

  const composer = page.getByRole("dialog", { name: "Add a comment" });
  await expect(composer).toBeVisible();
  await expect(composer.getByText("Lines 5–8")).toBeVisible();
  const rangeInput = composer.locator("textarea");
  await rangeInput.fill("This whole block needs a rewrite.");
  // Submit via the keyboard chord; focus the input first so the chord lands on it.
  await rangeInput.click();
  await page.keyboard.press("ControlOrMeta+Enter");

  await expect(composer).toHaveCount(0);
  await expect
    .poll(async () => (await daemon.getReview(id)).body?.annotations?.length ?? 0)
    .toBe(1);
  const ann = (await daemon.getReview(id)).body?.annotations?.[0];
  expect(ann).toMatchObject({ startLine: 5, endLine: 8 });
});

test("cancelling the composer with Escape leaves no residue", async ({ daemon, page }) => {
  const id = await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.getByText("This plan reorganizes the widget cache")).toBeVisible();

  const plus = await revealGutterPlus(page, 3);
  await plus.click();

  const composer = page.getByRole("dialog", { name: "Add a comment" });
  await expect(composer).toBeVisible();
  const textarea = composer.locator("textarea");
  await textarea.fill("discard me");
  await textarea.click();
  await page.keyboard.press("Escape");

  // The composer is gone from the DOM and nothing was persisted.
  await expect(composer).toHaveCount(0);
  // Wait out the autosave debounce window and confirm no annotation landed.
  await expect
    .poll(async () => (await daemon.getReview(id)).body?.annotations?.length ?? 0)
    .toBe(0);
});

// Dev-flagged source-view surface (EXC-583). With the flag on, the plan renders
// as line-numbered markdown source through the @pierre/diffs wrapper instead of
// the legacy plan view + contents rail. Read-only milestone: no annotation
// gutter, no ToC — but approve and request-changes still round-trip. The view
// instance must survive the 2s poll with no scroll reset.

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

  // The legacy surface is absent: no rendered-HTML article, no contents rail.
  await expect(page.locator("article.plan")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Plan contents" })).toHaveCount(0);
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

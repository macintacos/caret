// Smoke: a seeded plan renders on the source view — heading lines, the contents
// pane, and body content are all visible.

import { expect, test } from "./support/fixtures.ts";

test("a seeded plan renders headings, contents pane, and body content", async ({
  daemon,
  page,
}) => {
  await daemon.seed();
  await page.goto("/");

  const plan = page.locator(".diff-plan");
  await expect(plan).toBeVisible();

  // Heading and body lines show as markdown source (Playwright pierces the
  // library's shadow root for text).
  await expect(plan.getByText("Widget Cache Refactor")).toBeVisible();
  await expect(plan.getByText("Background")).toBeVisible();
  await expect(plan.getByText("warm copy of each manifest")).toBeVisible();

  // The contents pane lists the plan's headings.
  const pane = page.getByRole("navigation", { name: "Plan contents" });
  await expect(pane).toBeVisible();
  await expect(pane.getByText("Approach")).toBeVisible();
  await expect(pane.getByText("Verification")).toBeVisible();
});

// Smoke: a seeded plan renders on the source view — heading lines, the heading
// breadcrumbs bar, and body content are all visible.

import { expect, test } from "@test/e2e/support/fixtures.ts";

test("a seeded plan renders headings, the breadcrumbs bar, and body content", async ({
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

  // The breadcrumbs bar places the reader in the plan (EXC-949 made it the only
  // heading-navigation surface, so the smoke check moved here from the rail).
  const bar = page.getByRole("navigation", { name: "Plan location" });
  await expect(bar).toBeVisible();
  await expect(bar.locator("button.crumb").first()).toHaveText("Widget Cache Refactor");
});

// Smoke: a seeded plan renders on the source view — heading lines, the heading
// breadcrumbs bar, and body content are all visible.
//
// A plain render assertion, so it is technically unit-able — and it stays here
// deliberately. This is the suite's harness canary: it is the one test whose
// failure says the fixture, the spawned daemon, the built ui/dist, and the page
// load are working at all, which no mounted-component unit can tell you. The
// component-level half of the same claim is ui/src/components/DiffPlanView.test.ts
// ("renders the plan source text into the source view").

import { expect, test } from "@test/e2e/support/fixtures.ts";
import { planSurface } from "@test/e2e/support/source-view.ts";

test("a seeded plan renders headings, the breadcrumbs bar, and body content", async ({
  daemon,
  page,
}) => {
  await daemon.seed();
  await page.goto("/");

  const plan = await planSurface(page);

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

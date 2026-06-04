// Review lifecycle: the switcher shows the right plan across two pending
// reviews, ?review=<id> deep-links directly, and a review POSTed while the
// page is open appears via the 2s poll without a reload.
//
// Multi-review seeds rely on the fixture's per-call UUID sessionId default:
// the daemon SUPERSEDES a same-session pending review, so sharing a session
// would silently collapse two seeds into one.

import { SECOND_PLAN } from "./support/fixture-plan.ts";
import { expect, test } from "./support/fixtures.ts";

test("switching between two pending reviews shows the right plan", async ({ daemon, page }) => {
  await daemon.seed();
  await daemon.seed({ plan: SECOND_PLAN });
  await page.goto("/");

  // Oldest-first: the first seed is active.
  const h1 = page.locator("article.plan h1");
  await expect(h1).toHaveText("Widget Cache Refactor");

  // The switcher carries both ("2" badge); pick the other review.
  const switcher = page.locator(".switcher");
  await expect(switcher.getByText("2", { exact: true })).toBeVisible();
  await switcher.getByRole("button", { name: /Widget Cache Refactor/ }).click();
  await page.getByRole("option", { name: /Gadget Renderer Cleanup/ }).click();
  await expect(h1).toHaveText("Gadget Renderer Cleanup");
});

test("?review=<id> deep-links directly to that review", async ({ daemon, page }) => {
  await daemon.seed();
  const second = await daemon.seed({ plan: SECOND_PLAN });
  await page.goto(`/?review=${encodeURIComponent(second)}`);

  // Without the deep link the oldest review would win; the param overrides.
  await expect(page.locator("article.plan h1")).toHaveText("Gadget Renderer Cleanup");
});

test("a review posted while the page is open appears without a reload", async ({
  daemon,
  page,
}) => {
  await daemon.seed();
  await page.goto("/");
  await expect(page.locator("article.plan h1")).toHaveText("Widget Cache Refactor");

  // Seed through the API while the page is open: the 2s poll must pick it up.
  await daemon.seed({ plan: SECOND_PLAN });

  // The switcher badge flips to 2 with no reload; generous auto-retry timeout
  // covers the poll interval (never a fixed sleep).
  await expect(page.locator(".switcher").getByText("2", { exact: true })).toBeVisible({
    timeout: 5_000,
  });
});

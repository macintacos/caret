// Review lifecycle: the switcher shows the right plan across two pending
// reviews, ?review=<id> deep-links directly, and a review POSTed while the
// page is open appears via the 2s poll without a reload.
//
// Multi-review seeds rely on the fixture's per-call UUID sessionId default:
// the daemon SUPERSEDES a same-session pending review, so sharing a session
// would silently collapse two seeds into one.
//
// Everything here needs a real browser. The deep link is a real navigation whose
// query string the app reads at boot, and the unprompted arrival is the 2s
// decision poll against a live daemon — both e2e concerns per
// doc/agents/browser-testing.md, not something a mounted component can show.

import { SECOND_PLAN } from "@test/e2e/support/fixture-plan.ts";
import { expect, test } from "@test/e2e/support/fixtures.ts";
import { PLAN_SURFACE } from "@test/e2e/support/source-view.ts";

test("switching between two pending reviews shows the right plan", async ({ daemon, page }) => {
  await daemon.seed();
  await daemon.seed({ plan: SECOND_PLAN });
  await page.goto("/");

  // Oldest-first: the first seed is active. The heading shows as source text in
  // the source view; scope to the view so the switcher's copy doesn't collide.
  const plan = page.locator(PLAN_SURFACE);
  await expect(plan.getByText("Widget Cache Refactor")).toBeVisible();

  // The switcher (a shadcn DropdownMenu since EXC-760) carries both — count "2";
  // open it and pick the other review from the menu.
  const trigger = page.locator(".switcher-trigger");
  await expect(trigger.locator(".count")).toHaveText("2");
  await trigger.click();
  await page.getByRole("menuitem", { name: /Gadget Renderer Cleanup/ }).click();
  await expect(plan.getByText("Gadget Renderer Cleanup")).toBeVisible();
});

test("?review=<id> deep-links directly to that review", async ({ daemon, page }) => {
  await daemon.seed();
  const second = await daemon.seed({ plan: SECOND_PLAN });
  await page.goto(`/?review=${encodeURIComponent(second)}`);

  // Without the deep link the oldest review would win; the param overrides.
  await expect(page.locator(PLAN_SURFACE).getByText("Gadget Renderer Cleanup")).toBeVisible();
});

test("a review posted while the page is open appears without a reload", async ({
  daemon,
  page,
}) => {
  await daemon.seed();
  await page.goto("/");
  await expect(page.locator(PLAN_SURFACE).getByText("Widget Cache Refactor")).toBeVisible();

  // Seed through the API while the page is open: the 2s poll must pick it up.
  await daemon.seed({ plan: SECOND_PLAN });

  // The switcher's count Badge flips to 2 with no reload; the suite's assertion
  // budget absorbs the poll interval (never a fixed sleep). The trigger itself
  // only appears once there's a second review, so this also waits for the
  // single→multiple switch.
  await expect(page.locator(".switcher-trigger").locator(".count")).toHaveText("2");
});

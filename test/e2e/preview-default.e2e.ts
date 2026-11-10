// The one-time move to the preview default and its notice on the Source button. Each
// browser history is seeded on the first load only, so a reload shows what the app stored.
// A real browser is needed for reload persistence, the popover's placement, and its
// stacking under modals; the pure decision lives in ui/src/lib/previewDefault.test.ts.

import type { Page } from "@playwright/test";

import { sourceToggle } from "@test/e2e/support/chrome.ts";
import { expect, test, waitPastSafeModeGrace } from "@test/e2e/support/fixtures.ts";
import {
  composer,
  PLAN_PREVIEW,
  PLAN_SURFACE,
  planSurface,
} from "@test/e2e/support/source-view.ts";

test.use({ pinPlanView: false });

const PLAN = "# Plan\n\nBody.\n";
const COPY =
  "Preview is now the default. Press S or click Source to see the plan's markdown. (P no longer toggles.)";

/** Seed localStorage on the first load of this tab only. */
async function seedOnce(page: Page, entries: Record<string, string>): Promise<void> {
  await page.addInitScript((seed) => {
    if (sessionStorage.getItem("e2e.seeded") !== null) return;
    sessionStorage.setItem("e2e.seeded", "1");
    for (const [key, value] of Object.entries(seed)) localStorage.setItem(key, value);
  }, entries);
}

const notice = (page: Page) => page.getByRole("dialog", { name: "Preview is now the default" });
const preview = (page: Page) => page.locator(`${PLAN_SURFACE} ${PLAN_PREVIEW}`);

/** Ready for keys on either view; the shared helper waits for source rows. */
async function ready(page: Page): Promise<void> {
  await planSurface(page);
  await waitPastSafeModeGrace(page);
}

async function openPlan(page: Page): Promise<void> {
  await page.goto("/");
  await ready(page);
}

test("a new browser opens in preview with no notice, before and after a reload", async ({
  page,
  daemon,
}) => {
  await daemon.seed({ plan: PLAN });
  await openPlan(page);
  await expect(preview(page)).toBeVisible();
  await expect(sourceToggle(page)).toHaveAttribute("aria-pressed", "false");
  await expect(notice(page)).toHaveCount(0);

  await page.reload();
  await ready(page);
  await expect(notice(page)).toHaveCount(0);
});

test("a browser that chose source is moved to preview and told once", async ({ page, daemon }) => {
  await seedOnce(page, { "caret.planView": "source", "caret.onboarded": "1" });
  await daemon.seed({ plan: PLAN });
  await openPlan(page);
  await expect(preview(page)).toBeVisible();
  await expect(notice(page)).toContainText(COPY);
  const toggleBox = await sourceToggle(page).boundingBox();
  await expect
    .poll(async () => (await notice(page).boundingBox())?.y ?? 0)
    .toBeGreaterThan(toggleBox?.y ?? Number.POSITIVE_INFINITY);
  const nubBox = await notice(page).locator("[data-slot=popover-arrow]").boundingBox();
  const panelBox = await notice(page).boundingBox();
  if (!(toggleBox && nubBox && panelBox)) throw new Error("notice, nub or Source has no box");
  const nubCentre = nubBox.x + nubBox.width / 2;
  expect(nubCentre).toBeGreaterThan(toggleBox.x);
  expect(nubCentre).toBeLessThan(toggleBox.x + toggleBox.width);
  expect(nubBox.y).toBeGreaterThanOrEqual(toggleBox.y + toggleBox.height);
  expect(nubBox.y + nubBox.height).toBeLessThanOrEqual(panelBox.y + 0.5);

  await page.reload();
  await ready(page);
  await expect(notice(page)).toBeVisible();

  await page.getByRole("button", { name: "Got it" }).click();
  await expect(notice(page)).toHaveCount(0);
  await page.reload();
  await ready(page);
  await expect(preview(page)).toBeVisible();
  await expect(notice(page)).toHaveCount(0);

  await sourceToggle(page).click();
  await expect(preview(page)).toHaveCount(0);
  await page.reload();
  await ready(page);
  await expect(sourceToggle(page)).toHaveAttribute("aria-pressed", "true");
});

test("pressing s ends the notice for good", async ({ page, daemon }) => {
  await seedOnce(page, { "caret.planView": "preview", "caret.onboarded": "1" });
  await daemon.seed({ plan: PLAN });
  await openPlan(page);
  await expect(notice(page)).toBeVisible();

  await page.keyboard.press("s");
  await expect(notice(page)).toHaveCount(0);
  await expect(sourceToggle(page)).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await ready(page);
  await expect(notice(page)).toHaveCount(0);
});

test("the notice outlasts an outside click and Escape, which still closes a search", async ({
  page,
  daemon,
}) => {
  await seedOnce(page, { "caret.planView": "source", "caret.onboarded": "1" });
  await daemon.seed({ plan: PLAN });
  await openPlan(page);
  await expect(notice(page)).toBeVisible();

  await preview(page).click();
  await page.keyboard.press("Escape");
  await expect(notice(page)).toBeVisible();

  await page.keyboard.press("/");
  await page.keyboard.type("Body");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("search")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("search")).toHaveCount(0);
  await expect(notice(page)).toBeVisible();
});

test("a browser already moved keeps its source choice and sees no notice", async ({
  page,
  daemon,
}) => {
  await seedOnce(page, {
    "caret.planView": "source",
    "caret.previewDefault.moved": "1",
    "caret.previewDefault.noticeSeen": "1",
    "caret.onboarded": "1",
  });
  await daemon.seed({ plan: PLAN });
  await openPlan(page);
  await expect(sourceToggle(page)).toHaveAttribute("aria-pressed", "true");
  await expect(notice(page)).toHaveCount(0);
});

test("the notice waits behind the onboarding dialog", async ({ page, daemon }) => {
  await page.addInitScript(() => {
    (window as { Notification: unknown }).Notification = {
      permission: "default",
      requestPermission: () => Promise.resolve("default"),
    };
  });
  await seedOnce(page, { "caret.lastSeenVersion": "0.0.1" });
  await daemon.seed({ plan: PLAN });
  await page.goto("/");

  const later = page.getByRole("button", { name: "Maybe later" });
  await expect(later).toBeVisible();
  await expect(notice(page)).toHaveCount(0);
  await later.click();
  await expect(notice(page)).toBeVisible();
});

test("the notice hides while comparing and returns on leaving compare", async ({
  page,
  daemon,
}) => {
  await seedOnce(page, { "caret.planView": "source", "caret.onboarded": "1" });
  await daemon.seedVersions(2, ["# Plan\n\nOne.\n", "# Plan\n\nTwo.\n"]);
  await openPlan(page);
  await expect(notice(page)).toBeVisible();

  await page.keyboard.press("d");
  await expect(sourceToggle(page)).toHaveCount(0);
  await expect(notice(page)).toHaveCount(0);
  await page.keyboard.press("d");
  await expect(notice(page)).toBeVisible();
});

test("s typed in a comment does not flip the view, and p is unbound", async ({ page, daemon }) => {
  await seedOnce(page, {
    "caret.planView": "source",
    "caret.previewDefault.moved": "1",
    "caret.previewDefault.noticeSeen": "1",
    "caret.onboarded": "1",
  });
  await daemon.seed({ plan: PLAN });
  await openPlan(page);

  await page.keyboard.press("p");
  await expect(sourceToggle(page)).toHaveAttribute("aria-pressed", "true");

  const field = await composer(page, 3);
  await field.pressSequentially("s");
  await expect(sourceToggle(page)).toHaveAttribute("aria-pressed", "true");
});

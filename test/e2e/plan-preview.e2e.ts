// The plan view's Preview toggle (EXC-2012): a button beside Versions swaps the
// single-version source view for the rendered preview, the browser remembers the
// choice, and compare mode hides the toggle and shows source until it hands the
// remembered view back.
//
// What needs a real browser here: focus staying on the toggle across a flip,
// persistence across a real page.reload(), a long paragraph's layout wrap
// (scrollWidth against clientWidth), the `indeterminate` property a live DOM sets,
// the `?heading=` deep link held across a preview mount and honored on the first
// source mount, and scroll position across a live daemon.addVersion. The pure half
// stays units: the preference and surface table in ui/src/lib/planView.test.ts, the
// mount in ui/src/components/PlanPreview.test.ts, and the toggle's wiring in
// ui/src/components/DiffPlanView.test.ts.

import type { Page } from "@playwright/test";

import { expect, test } from "@test/e2e/support/fixtures.ts";
import { PLAN_SURFACE, planSurface } from "@test/e2e/support/source-view.ts";

const PREVIEW = ".plan-preview";
const CRUMB = ".plan-breadcrumbs button.crumb";

const toggle = (page: Page) => page.getByRole("button", { name: "Preview", exact: true });

const body = (tag: string) =>
  Array.from({ length: 30 }, (_, i) => `${tag} paragraph ${i + 1} of the plan body.`).join("\n\n");

const LONG_WORD = "x".repeat(600);
const TASK_PLAN = `# Plan\n\n- [/] half-done task\n- [x] done task\n\n${LONG_WORD}\n`;
const SECTIONED = `# Alpha\n\n${body("alpha")}\n\n## Bravo\n\n${body("bravo")}\n\n## Echo\n\n${body("echo")}\n`;

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
  const fits = await preview
    .locator("p", { hasText: LONG_WORD })
    .evaluate((el) => el.scrollWidth <= el.clientWidth);
  expect(fits).toBe(true);
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
  await expect(page.locator(CRUMB).first()).toHaveText("Alpha");
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
  await expect(page.locator(CRUMB).last()).toHaveText("Echo");
});

test("a new version re-renders the preview without losing scroll", async ({ daemon, page }) => {
  const id = await daemon.seed({ plan: SECTIONED });
  await page.goto("/");
  const plan = await planSurface(page);
  await turnPreviewOn(page);

  await page.locator(PREVIEW).hover();
  await page.mouse.wheel(0, 600);
  await expect.poll(() => plan.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

  await daemon.addVersion(id, SECTIONED.replace("bravo paragraph 1 ", "revised bravo text "));

  await expect(page.locator(PREVIEW).getByText("revised bravo text")).toBeVisible();
  await expect
    .poll(() => page.locator(PLAN_SURFACE).evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
});

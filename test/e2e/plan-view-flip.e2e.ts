// Flipping between the source view and the preview fades the arriving view in. The fade is
// a CSS animation, which only a real browser runs. The toggle's wiring — the button, `p`,
// and compare mode switching `p` off — is unit-tested in
// ui/src/components/DiffPlanView.test.ts.

import type { Page } from "@playwright/test";

import { expect, test } from "@test/e2e/support/fixtures.ts";
import { openPlanForKeys, PLAN_PREVIEW, PLAN_SURFACE } from "@test/e2e/support/source-view.ts";

/** How many animations the plan surface has started since the page loaded. */
function fades(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __fades: number }).__fades);
}

test("each flip fades the arriving view in, and the first paint does not", async ({
  page,
  daemon,
}) => {
  await page.addInitScript((surface) => {
    const w = window as unknown as { __fades: number };
    w.__fades = 0;
    window.addEventListener(
      "animationstart",
      (e) => {
        if ((e.target as Element).matches(surface)) w.__fades++;
      },
      { capture: true },
    );
  }, PLAN_SURFACE);
  await openPlanForKeys(page, daemon, "# Plan\n\nBody.\n");
  expect(await fades(page)).toBe(0);

  await page.keyboard.press("p");
  await expect(page.locator(PLAN_PREVIEW)).toBeVisible();
  await expect.poll(() => fades(page)).toBe(1);

  await page.keyboard.press("p");
  await expect(page.locator(PLAN_PREVIEW)).toHaveCount(0);
  await expect.poll(() => fades(page)).toBe(2);
});

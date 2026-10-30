// The tactile kit's one structural invariant: every rubber cap sits in a well. A cap's
// tray usually lives in a parent component (TopBar's .actions holds SplitButton), so no
// single .svelte file can show it; the rendered DOM can.

import type { Page } from "@playwright/test";

import { expect, test } from "@test/e2e/support/fixtures.ts";
import { seedAndOpen } from "@test/e2e/support/source-view.ts";

/** The rendered caps, and an outline of each that sits outside any tray. */
function capsOutsideTrays(page: Page): Promise<{ total: number; outside: string[] }> {
  return page.evaluate(() => {
    const all = [...document.querySelectorAll<HTMLElement>("button.float-chip, .cap")].filter(
      (el) => el.getClientRects().length > 0,
    );
    return {
      total: all.length,
      outside: all.filter((el) => !el.closest(".tray")).map((el) => el.outerHTML.slice(0, 120)),
    };
  });
}

test("every rubber cap on the review page sits in a tray", async ({ daemon, page }) => {
  await seedAndOpen(page, daemon);
  const caps = await capsOutsideTrays(page);
  expect(caps.total).toBeGreaterThan(0);
  expect(caps.outside).toEqual([]);
});

test("the plan search's caps sit in a tray", async ({ daemon, page }) => {
  await seedAndOpen(page, daemon);
  await page.keyboard.press("/");
  await expect(page.getByRole("search")).toBeVisible();
  expect((await capsOutsideTrays(page)).outside).toEqual([]);
});

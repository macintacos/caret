import type { Page } from "@playwright/test";

import { fileRefCount, settleDrawer } from "@test/e2e/support/file-refs.ts";
import { expect } from "@test/e2e/support/fixtures.ts";
import { planSurface } from "@test/e2e/support/source-view.ts";
import { NARROW_WIDTH_PX } from "@ui/src/lib/layout.ts";

/** A viewport wide enough that the drawer docks right. */
export const WIDE = { width: NARROW_WIDTH_PX + 440, height: 900 };

export const CACHE_TS = Array.from(
  { length: 300 },
  (_, i) => `const line${i + 1} = ${i + 1};`,
).join("\n");

export const ROWS_PROSE =
  "Rows paragraph opens with alpha words that set the scene for the reviewer to read carefully, " +
  "then continues with bravo words describing the middle of the change in plain detail, " +
  "and closes with charlie words that wrap past the end of a stored line.";

/** Open the preview for the first resolved reference in the plan, and wait out
 * the lane's opening slide so every rect below is measured where it settles. */
export async function openPreview(page: Page): Promise<void> {
  await planSurface(page);
  await expect.poll(() => fileRefCount(page)).toBeGreaterThan(0);
  await page.locator("[data-file-ref]").first().click();
  await expect(page.locator("[data-file-drawer]")).toBeVisible();
  await expect(page.locator("[data-file-preview]")).toBeVisible();
  await settleDrawer(page);
}

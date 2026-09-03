// The focused-line cursor (EXC-788, EXC-790): SourceView tags the focused row's content
// cell data-caret-cursor.

import type { Page } from "@playwright/test";

import { expect } from "@test/e2e/support/fixtures.ts";

/** The cursor marker's content cell. Playwright's CSS engine pierces the library's
 * open shadow root, so a plain descendant selector reaches it. */
export const cursor = (page: Page) =>
  page.locator(".diffview [data-content] [data-line][data-caret-cursor]");

const lineOf = async (page: Page): Promise<number> =>
  Number((await cursor(page).getAttribute("data-line")) ?? -1);

/** Assert the cursor rests on an exact line, web-first (auto-retries until the effect
 * flush settles the marker). */
export async function expectCursorLine(page: Page, line: number): Promise<void> {
  await expect(cursor(page)).toHaveAttribute("data-line", String(line));
}

/** Read the cursor line once it has settled to a value other than `notLine` — so a
 * relative capture waits out the effect flush instead of racing it. Defaults to -1
 * (wait for the marker to exist and carry any line). */
export async function readCursorLine(page: Page, notLine = -1): Promise<number> {
  await expect.poll(() => lineOf(page)).not.toBe(notLine);
  return lineOf(page);
}

/** Press gg (go to top) and confirm the cursor landed on line 1 — the entry point
 * nearly every motion spec starts from. */
export async function goToTop(page: Page): Promise<void> {
  await page.keyboard.press("g");
  await page.keyboard.press("g");
  await expectCursorLine(page, 1);
}

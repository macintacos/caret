// The keyboard cursor's markers, and the keystrokes that drive it: SourceView tags the
// focused row's content cell data-caret-cursor (EXC-788, EXC-790); the preview draws a
// band carrying the cursor's source line.

import type { Page } from "@playwright/test";

import { expect } from "@test/e2e/support/fixtures.ts";
import { PLAN_SURFACE } from "@test/e2e/support/source-view.ts";

/** The cursor marker's content cell. Playwright's CSS engine pierces the library's
 * open shadow root, so a plain descendant selector reaches it. */
export const cursor = (page: Page) =>
  page.locator(".diffview [data-content] [data-line][data-caret-cursor]");

/** The preview's cursor band, an overlay sibling of `.plan-preview` carrying the
 * cursor's source line as data-line. */
export const PREVIEW_BAND = `${PLAN_SURFACE} [data-caret-preview-cursor]`;

export const previewCursor = (page: Page) => page.locator(PREVIEW_BAND);

/** The library's amber selection band, one content cell per selected line. */
export const selectedLines = (page: Page) =>
  page.locator(".diffview [data-content] [data-line][data-selected-line]");

/** Presses each of `keys` in turn. */
export async function press(page: Page, ...keys: string[]): Promise<void> {
  for (const key of keys) await page.keyboard.press(key);
}

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

/** gg, then `steps` presses of j; returns the line the cursor lands on. Each j is one
 * synchronous step in its keydown, so only the landing needs waiting for. */
export async function walkCursor(page: Page, steps: number): Promise<number> {
  await goToTop(page);
  for (let i = 0; i < steps; i++) await page.keyboard.press("j");
  await expectCursorLine(page, 1 + steps);
  return 1 + steps;
}

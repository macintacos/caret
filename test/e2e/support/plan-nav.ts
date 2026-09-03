// Shared arrange/assert helpers for the plan's heading-navigation surfaces — the
// breadcrumbs bar (plan-breadcrumbs.e2e.ts) and the table-of-contents popup
// (plan-toc.e2e.ts) — where both specs independently reach for the same check
// (typescript-rules.md § Shared-helper policy).

import type { Locator, Page } from "@playwright/test";

import { expect, pastKeyRepeatDelay, walkVisits } from "@test/e2e/support/fixtures.ts";
import { PLAN_SURFACE } from "@test/e2e/support/source-view.ts";

/** Whether `row` sits inside `list`'s visible box — the claim a unit mount cannot
 * make, since happy-dom lays nothing out.
 *
 * Throws rather than returning false when either box is unmeasurable: a caller
 * asserting this is FALSE wants proof the list really scrolls, and a
 * false-on-null would let "not measurable" pass as "correctly out of view".
 * `expect.poll` fails on a throw exactly as it should. */
export async function isWithinBox(row: Locator, list: Locator): Promise<boolean> {
  const rowBox = await row.boundingBox();
  const listBox = await list.boundingBox();
  if (rowBox === null || listBox === null) throw new Error("row or list has no bounding box");
  return rowBox.y >= listBox.y - 1 && rowBox.y + rowBox.height <= listBox.y + listBox.height + 1;
}

/** Hold `key` through `visits` moves of the walk, release, and confirm it stopped
 * where it stopped — settled rather than merely paused, since nothing moves again
 * once the key-repeat window a run would have ticked in has passed. */
export async function holdAndSettle(
  page: Page,
  key: string,
  read: () => Promise<string>,
  visits: number,
): Promise<void> {
  await page.keyboard.down(key);
  await walkVisits(read, visits);
  await page.keyboard.up(key);

  const stopped = await read();
  expect(stopped).not.toBe("");
  await pastKeyRepeatDelay(page);
  expect(await read()).toBe(stopped);
}

/** A real outside click below `panel`'s own box, on the plan surface: the popover
 * typically hangs off chrome near the top of the plan, so a click on the first rows
 * would land on the dismiss layer instead of outside it. */
export async function clickBelowPanel(page: Page, panel: Locator): Promise<void> {
  const panelBox = await panel.boundingBox();
  const planBox = await page.locator(PLAN_SURFACE).boundingBox();
  if (panelBox === null || planBox === null) throw new Error("panel or plan has no bounding box");
  await page.mouse.click(planBox.x + planBox.width / 2, panelBox.y + panelBox.height + 40);
}

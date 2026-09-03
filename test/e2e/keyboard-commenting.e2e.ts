// Keyboard commenting on the focused line (EXC-790). `c` opens the comment
// composer on the cursor's line; `V` enters a visual line-select mode where
// `j`/`k` extend the selection, `c` comments the range, and `Esc` exits without
// commenting. These are real-browser keyboard/composer/selection behaviors, so
// they live here rather than in a unit (browser-testing.md). Every gesture is
// driven with REAL keystrokes — the composer text is typed, `⌘Enter` submits —
// and the cursor line is read from the stable data-caret-cursor marker.
//
// The plan is reflowed on ingest, so line numbers shift; the spec asserts
// RELATIVE motion (gg then j) and reads the cursor line from the DOM rather than
// hardcoding it. `openPlanForKeys` waits past the safe-mode grace window before
// returning, which is mandatory before the first keystroke.

import type { Locator, Page } from "@playwright/test";

import { cursor, expectCursorLine, goToTop, readCursorLine } from "@test/e2e/support/cursor.ts";
import { headedFillerPlan } from "@test/e2e/support/fixture-plan.ts";
import { expect, test } from "@test/e2e/support/fixtures.ts";
import { expectSingleAnnotation } from "@test/e2e/support/review-state.ts";
import { awaitPlanReadyForKeys, openPlanForKeys } from "@test/e2e/support/source-view.ts";

// Tall enough that the cursor has room to move, with three headings so the plan
// reflows to a stable multi-line shape.
const PLAN = headedFillerPlan(10);
// A distinct second version so a two-version review can enter compare mode.
const PLAN_V2 = PLAN.replace("# Alpha", "# Alpha revised");

// The library's amber selection band, one cell per selected content line.
const selectedLines = (page: Page) =>
  page.locator(".diffview [data-content] [data-line][data-selected-line]");
// The inline composer and its CodeMirror editing surface (aria-label "Comment").
const composerOf = (page: Page): Locator => page.getByRole("dialog", { name: "Add a comment" });
const composerInput = (composer: Locator): Locator =>
  composer.getByRole("textbox", { name: "Comment" });

// Place the cursor a couple of lines below the top by real keystrokes (gg then
// j×n), returning the settled cursor line read from the DOM.
async function placeCursorBelowTop(page: Page, steps: number): Promise<number> {
  await goToTop(page);
  for (let i = 0; i < steps; i++) await page.keyboard.press("j");
  return readCursorLine(page, 1);
}

// From the top, enter visual line-select mode and extend the selection down
// `steps` lines with j.
async function enterVisualMode(page: Page, steps: number): Promise<void> {
  await goToTop(page);
  await page.keyboard.press("V");
  for (let i = 0; i < steps; i++) await page.keyboard.press("j");
}

test("c opens the composer on the cursor line and ⌘Enter submits a line comment", async ({
  daemon,
  page,
}) => {
  const id = await openPlanForKeys(page, daemon, PLAN);

  const line = await placeCursorBelowTop(page, 2);

  // c opens the composer anchored to the cursor line (no gutter click needed).
  await page.keyboard.press("c");
  const composer = composerOf(page);
  await expect(composer).toBeVisible();
  await expect(composer.locator(".label")).toHaveText(`Line ${line}`);

  const input = composerInput(composer);
  await expect(input).toBeFocused();
  await page.keyboard.type("Comment from the keyboard.");
  await expect(input).toContainText("Comment from the keyboard."); // CM input is async
  await page.keyboard.press("ControlOrMeta+Enter");

  await expect(composer).toHaveCount(0);
  await expectSingleAnnotation(daemon, id, {
    startLine: line,
    endLine: line,
    comment: "Comment from the keyboard.",
  });
});

test("V + j selects a line range that c comments and ⌘Enter submits", async ({ daemon, page }) => {
  const id = await openPlanForKeys(page, daemon, PLAN);

  // From the top, enter visual mode and extend the selection down two lines, so
  // the anchored range spans lines 1–3 (gg=1, then two j steps).
  await enterVisualMode(page, 2);
  await expectCursorLine(page, 3);
  await expect(selectedLines(page)).toHaveCount(3);
  // The aria-live range readout announces the span (keyboard parity with the
  // mouse-drag readout).
  await expect(page.locator(".drag-readout")).toHaveText("Lines 1–3");

  await page.keyboard.press("c");
  const composer = composerOf(page);
  await expect(composer).toBeVisible();
  await expect(composer.locator(".label")).toHaveText("Lines 1–3");
  // Committing the range exits visual mode, so the affordance hint is gone.
  await expect(page.locator(".visual-hint")).toHaveCount(0);

  const input = composerInput(composer);
  await expect(input).toBeFocused();
  await page.keyboard.type("Range note.");
  await expect(input).toContainText("Range note.");
  await page.keyboard.press("ControlOrMeta+Enter");

  await expect(composer).toHaveCount(0);
  await expectSingleAnnotation(daemon, id, { startLine: 1, endLine: 3, comment: "Range note." });
});

test("Esc in visual mode clears the selection without commenting and keeps the cursor", async ({
  daemon,
  page,
}) => {
  await openPlanForKeys(page, daemon, PLAN);

  await enterVisualMode(page, 1);
  await expectCursorLine(page, 2);
  await expect(selectedLines(page)).toHaveCount(2);
  // The visual-mode affordance hint is up, its two keys rendered as Kbd keycaps.
  const hint = page.locator(".visual-hint");
  await expect(hint).toBeVisible();
  await expect(hint.locator("[data-slot='kbd']")).toHaveCount(2);

  // Esc exits visual mode: the selection band and the hint clear, no composer
  // opens, and the cursor stays where it was. A second Esc has nothing to clear,
  // so it leaves the cursor exactly where it is (EXC-834).
  await page.keyboard.press("Escape");
  await expect(selectedLines(page)).toHaveCount(0);
  await expect(hint).toHaveCount(0);
  await expect(composerOf(page)).toHaveCount(0);
  await expectCursorLine(page, 2);
  await page.keyboard.press("Escape");
  await expectCursorLine(page, 2);
});

test("V again toggles out of visual line-select without commenting", async ({ daemon, page }) => {
  await openPlanForKeys(page, daemon, PLAN);

  await enterVisualMode(page, 1);
  await expect(selectedLines(page)).toHaveCount(2);

  // A second V exits visual mode (vim parity): the selection clears, no composer
  // opens, and the cursor stays put.
  await page.keyboard.press("V");
  await expect(selectedLines(page)).toHaveCount(0);
  await expect(composerOf(page)).toHaveCount(0);
  await expectCursorLine(page, 2);
});

test("commenting keys are inert in compare (read-only) mode", async ({ daemon, page }) => {
  await daemon.seedVersions(2, [PLAN, PLAN_V2]);
  await page.goto("/");
  await awaitPlanReadyForKeys(page);

  // Enter compare mode; the Target-version control is compare-only, so its
  // presence confirms the read-only diff is up.
  await page.getByRole("button", { name: "Versions" }).click();
  await expect(page.getByLabel("Target version")).toBeVisible();

  // Neither the cursor motions nor the commenting keys are registered here, so
  // none of them place a cursor, select a range, or open a composer.
  for (const key of ["g", "g", "j", "c", "V"]) await page.keyboard.press(key);
  await expect(cursor(page)).toHaveCount(0);
  await expect(selectedLines(page)).toHaveCount(0);
  await expect(composerOf(page)).toHaveCount(0);
});

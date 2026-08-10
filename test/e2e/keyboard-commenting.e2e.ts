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
// hardcoding it. waitPastSafeModeGrace is mandatory before the first keystroke.

import type { Locator, Page } from "@playwright/test";

import { expect, test, waitPastSafeModeGrace } from "@test/e2e/support/fixtures.ts";
import { planSurface } from "@test/e2e/support/source-view.ts";

// Tall enough that the cursor has room to move, with three headings so the plan
// reflows to a stable multi-line shape.
const filler = (label: string) =>
  Array.from({ length: 10 }, (_, i) => `${label} body line ${i + 1}.`).join("\n\n");
const PLAN = [
  "# Alpha",
  filler("Alpha"),
  "## Bravo",
  filler("Bravo"),
  "## Charlie",
  filler("Charlie"),
  "",
].join("\n\n");
// A distinct second version so a two-version review can enter compare mode.
const PLAN_V2 = PLAN.replace("# Alpha", "# Alpha revised");

// The cursor marker: SourceView tags the focused row's content cell
// data-caret-cursor (it carries data-line). Playwright's CSS engine pierces the
// library's open shadow root, so a plain descendant selector reaches it.
const cursor = (page: Page) =>
  page.locator(".diffview [data-content] [data-line][data-caret-cursor]");
// The library's amber selection band, one cell per selected content line.
const selectedLines = (page: Page) =>
  page.locator(".diffview [data-content] [data-line][data-selected-line]");
// The inline composer and its CodeMirror editing surface (aria-label "Comment").
const composerOf = (page: Page): Locator => page.getByRole("dialog", { name: "Add a comment" });
const composerInput = (composer: Locator): Locator =>
  composer.getByRole("textbox", { name: "Comment" });

const lineOf = async (page: Page): Promise<number> =>
  Number((await cursor(page).getAttribute("data-line")) ?? -1);

async function expectCursorLine(page: Page, line: number): Promise<void> {
  await expect(cursor(page)).toHaveAttribute("data-line", String(line));
}

// Read the cursor line once it has settled to a value other than `notLine`, so a
// relative capture waits out the effect flush instead of racing it.
async function readCursorLine(page: Page, notLine = -1): Promise<number> {
  await expect.poll(() => lineOf(page)).not.toBe(notLine);
  return lineOf(page);
}

async function loadPlan(page: Page): Promise<void> {
  await planSurface(page);
  await expect(page.locator(".diffview [data-content] [data-line]").first()).toBeVisible();
  await waitPastSafeModeGrace(page);
}

// Place the cursor a couple of lines below the top by real keystrokes (gg then
// j×n), returning the settled cursor line read from the DOM.
async function placeCursorBelowTop(page: Page, steps: number): Promise<number> {
  await page.keyboard.press("g");
  await page.keyboard.press("g");
  await expectCursorLine(page, 1);
  for (let i = 0; i < steps; i++) await page.keyboard.press("j");
  return readCursorLine(page, 1);
}

test("c opens the composer on the cursor line and ⌘Enter submits a line comment", async ({
  daemon,
  page,
}) => {
  const id = await daemon.seed({ plan: PLAN });
  await page.goto("/");
  await loadPlan(page);

  const line = await placeCursorBelowTop(page, 2);

  // c opens the composer anchored to the cursor line (no gutter click needed).
  await page.keyboard.press("c");
  const composer = composerOf(page);
  await expect(composer).toBeVisible();
  await expect(composer.locator(".label")).toHaveText(`Line ${line}`);

  // Type real keystrokes into the autofocused editor, then submit with ⌘Enter.
  const input = composerInput(composer);
  await expect(input).toBeFocused();
  await page.keyboard.type("Comment from the keyboard.");
  await expect(input).toContainText("Comment from the keyboard."); // CM input is async
  await page.keyboard.press("ControlOrMeta+Enter");

  await expect(composer).toHaveCount(0);
  await expect
    .poll(async () => (await daemon.getReview(id)).body?.annotations?.length ?? 0)
    .toBe(1);
  const ann = (await daemon.getReview(id)).body?.annotations?.[0];
  expect(ann).toMatchObject({
    startLine: line,
    endLine: line,
    comment: "Comment from the keyboard.",
  });
});

test("V + j selects a line range that c comments and ⌘Enter submits", async ({ daemon, page }) => {
  const id = await daemon.seed({ plan: PLAN });
  await page.goto("/");
  await loadPlan(page);

  // From the top, enter visual mode and extend the selection down two lines, so
  // the anchored range spans lines 1–3 (gg=1, then two j steps).
  await page.keyboard.press("g");
  await page.keyboard.press("g");
  await expectCursorLine(page, 1);
  await page.keyboard.press("V");
  await page.keyboard.press("j");
  await page.keyboard.press("j");
  await expectCursorLine(page, 3);
  // The visual selection mirrors into the amber band: three selected rows.
  await expect(selectedLines(page)).toHaveCount(3);
  // The aria-live range readout announces the span (keyboard parity with the
  // mouse-drag readout).
  await expect(page.locator(".drag-readout")).toHaveText("Lines 1–3");

  // c opens a range composer over the selection; its label reads the span.
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
  await expect
    .poll(async () => (await daemon.getReview(id)).body?.annotations?.length ?? 0)
    .toBe(1);
  const ann = (await daemon.getReview(id)).body?.annotations?.[0];
  expect(ann).toMatchObject({ startLine: 1, endLine: 3, comment: "Range note." });
});

test("Esc in visual mode clears the selection without commenting and keeps the cursor", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: PLAN });
  await page.goto("/");
  await loadPlan(page);

  await page.keyboard.press("g");
  await page.keyboard.press("g");
  await expectCursorLine(page, 1);
  await page.keyboard.press("V");
  await page.keyboard.press("j");
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
  await daemon.seed({ plan: PLAN });
  await page.goto("/");
  await loadPlan(page);

  await page.keyboard.press("g");
  await page.keyboard.press("g");
  await expectCursorLine(page, 1);
  await page.keyboard.press("V");
  await page.keyboard.press("j");
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
  await loadPlan(page);

  // Enter compare mode; the Target-version control is compare-only, so its
  // presence confirms the read-only diff is up.
  await page.getByRole("button", { name: "Compare versions" }).click();
  await expect(page.getByLabel("Target version")).toBeVisible();

  // Neither the cursor motions nor the commenting keys are registered here, so
  // none of them place a cursor, select a range, or open a composer.
  for (const key of ["g", "g", "j", "c", "V"]) await page.keyboard.press(key);
  await expect(cursor(page)).toHaveCount(0);
  await expect(selectedLines(page)).toHaveCount(0);
  await expect(composerOf(page)).toHaveCount(0);
});

// Focused-line cursor + vim motion in the plan (EXC-788). The cursor, its
// motion (j/k, Ctrl+d/u, gg/G, ]]/[[, }/{), click-to-relocate, Esc-to-clear, and
// scroll-into-view are all real-browser keyboard/scroll behavior, so they live
// here rather than in a unit (browser-testing.md). Every motion is driven with a
// REAL keystroke — never fill()/click() shortcuts — and the cursor line is read
// from a stable marker (data-caret-cursor on the focused shadow row).
//
// The plan is reflowed on ingest, so heading line numbers shift; the spec
// asserts RELATIVE motion and reads line numbers from the DOM, never hardcoding
// them. waitPastSafeModeGrace is mandatory before the first keystroke (a key
// inside the post-mount grace window is swallowed by Safe Mode).

import type { Page } from "@playwright/test";

import { expect, test, waitPastSafeModeGrace } from "./support/fixtures.ts";

// Tall enough that G and the half-page jump actually scroll, with three headings
// so ]]/[[ have distinct targets.
const filler = (label: string) =>
  Array.from({ length: 14 }, (_, i) => `${label} body line ${i + 1}.`).join("\n\n");
const PLAN = [
  "# Alpha",
  filler("Alpha"),
  "## Bravo",
  filler("Bravo"),
  "## Charlie",
  filler("Charlie"),
  "",
].join("\n\n");

// The cursor marker: SourceView tags the focused content row data-caret-cursor.
// Playwright's CSS engine pierces the library's open shadow root, so a plain
// descendant selector reaches it.
const cursor = (page: Page) => page.locator(".diffview [data-caret-cursor]");

const lineOf = async (page: Page): Promise<number> =>
  Number((await cursor(page).getAttribute("data-line")) ?? -1);

// Assert the cursor rests on an exact line, web-first (auto-retries until the
// effect flush settles the marker).
async function expectCursorLine(page: Page, line: number): Promise<void> {
  await expect(cursor(page)).toHaveAttribute("data-line", String(line));
}

// Read the cursor line once it has settled to a value other than `notLine` — so
// a relative capture waits out the effect flush instead of racing it. Defaults
// to -1 (i.e. wait for the marker to exist and carry any line).
async function readCursorLine(page: Page, notLine = -1): Promise<number> {
  await expect.poll(() => lineOf(page)).not.toBe(notLine);
  return lineOf(page);
}

async function loadPlan(page: Page): Promise<void> {
  await expect(page.locator(".diff-plan")).toBeVisible();
  // The rows paint asynchronously; wait for one before driving motion so the
  // cursor lands on a real row (and topVisibleLine has something to seed from).
  await expect(page.locator(".diffview [data-content] [data-line]").first()).toBeVisible();
  await waitPastSafeModeGrace(page);
}

test("j/k place and step the cursor, it reads as distinct, and Esc clears it", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: PLAN });
  await page.goto("/");
  await loadPlan(page);

  // No cursor until a motion places it.
  await expect(cursor(page)).toHaveCount(0);

  // j reveals the cursor at the reading position; the marker carries its line.
  await page.keyboard.press("j");
  await expect(cursor(page)).toHaveCount(1);
  const start = await readCursorLine(page);

  // j steps down one line, k steps back to where it was.
  await page.keyboard.press("j");
  await expectCursorLine(page, start + 1);
  await page.keyboard.press("k");
  await expectCursorLine(page, start);

  // The cursor row carries the left-bar treatment (a box-shadow the plain and
  // hovered rows never get) — the visual distinction from the hover-+.
  const boxShadow = await cursor(page).evaluate((el) => getComputedStyle(el).boxShadow);
  expect(boxShadow).not.toBe("none");

  // Esc clears the cursor (no composer open, so the global clear fires).
  await page.keyboard.press("Escape");
  await expect(cursor(page)).toHaveCount(0);
});

test("gg/G and half-page motions move the cursor and scroll it into view", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: PLAN });
  await page.goto("/");
  await loadPlan(page);

  // gg goes to the top.
  await page.keyboard.press("g");
  await page.keyboard.press("g");
  await expectCursorLine(page, 1);

  // G goes to the last rendered line and scrolls it into view.
  const last = Number(
    await page.locator(".diffview [data-content] [data-line]").last().getAttribute("data-line"),
  );
  await page.keyboard.press("G"); // uppercase key holds Shift → event.key "G"
  await expectCursorLine(page, last);
  await expect(cursor(page)).toBeInViewport();

  // Ctrl+d jumps down more than one line from the top; Ctrl+u brings it back up.
  await page.keyboard.press("g");
  await page.keyboard.press("g");
  await expectCursorLine(page, 1);
  await page.keyboard.press("Control+d");
  const afterHalf = await readCursorLine(page, 1);
  expect(afterHalf).toBeGreaterThan(2);
  await page.keyboard.press("Control+u");
  const afterUp = await readCursorLine(page, afterHalf);
  expect(afterUp).toBeLessThan(afterHalf);
});

test("]] and [[ jump between headings, and a line click relocates the cursor", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: PLAN });
  await page.goto("/");
  await loadPlan(page);

  // From the top (heading Alpha), ]] advances to the next heading (Bravo), then
  // to Charlie; [[ steps back to Bravo. Line numbers come from the DOM.
  await page.keyboard.press("g");
  await page.keyboard.press("g");
  await expectCursorLine(page, 1);
  await page.keyboard.press("]");
  await page.keyboard.press("]");
  const bravo = await readCursorLine(page, 1);
  expect(bravo).toBeGreaterThan(1);

  await page.keyboard.press("]");
  await page.keyboard.press("]");
  const charlie = await readCursorLine(page, bravo);
  expect(charlie).toBeGreaterThan(bravo);

  await page.keyboard.press("[");
  await page.keyboard.press("[");
  await expectCursorLine(page, bravo);

  // A line click relocates the cursor to the clicked line (keyboard + mouse stay
  // coherent). Clicking a line also opens its composer; the cursor tracks it.
  await page.locator('.diffview [data-content] [data-line="3"]').click();
  await expectCursorLine(page, 3);
});

test("} and { jump the cursor between blank (paragraph-boundary) lines", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: PLAN });
  await page.goto("/");
  await loadPlan(page);

  // From the top, } advances to the next blank line, then to a later one. Line
  // numbers come from the DOM (the plan is reflowed on ingest). "}" is a shifted
  // key; press("}") holds Shift → event.key "}" (as press("G") does for G).
  await page.keyboard.press("g");
  await page.keyboard.press("g");
  await expectCursorLine(page, 1);
  await page.keyboard.press("}");
  const firstBlank = await readCursorLine(page, 1);
  expect(firstBlank).toBeGreaterThan(1);

  await page.keyboard.press("}");
  const secondBlank = await readCursorLine(page, firstBlank);
  expect(secondBlank).toBeGreaterThan(firstBlank);

  // { steps back to the previous blank line (the two } jumps are consecutive
  // blanks, so the reverse lands on the first).
  await page.keyboard.press("{");
  await expectCursorLine(page, firstBlank);
});

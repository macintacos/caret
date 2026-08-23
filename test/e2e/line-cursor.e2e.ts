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
//
// Where the two scrolls PARK the row is covered here for the same reason: ]]/[[
// take the top-parked shared jump and j the scrolloff follow, so the difference
// is a measurement against a real box — a laid-out row's top as a fraction of
// the scroller's height, which happy-dom has no layout to report.

import type { Page } from "@playwright/test";

import { expect, test, waitPastSafeModeGrace } from "@test/e2e/support/fixtures.ts";
import { PLAN_SURFACE, planSurface } from "@test/e2e/support/source-view.ts";

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

// A plan with a fenced code block. The fence and its lines join with single
// newlines (one string) so reflow on ingest keeps them a contiguous block; the
// block is inset into the plan with the usual blank-line separators.
const CODE_BLOCK = [
  "```ts",
  ...Array.from({ length: 6 }, (_, i) => `const value${i + 1} = compute(${i + 1});`),
  "```",
].join("\n");
const PLAN_WITH_CODE = [
  "# Alpha",
  filler("Alpha"),
  "## Bravo",
  CODE_BLOCK,
  filler("Bravo"),
  "",
].join("\n\n");

// The cursor marker: SourceView tags BOTH cells of the focused row
// data-caret-cursor — the content cell and its gutter cell. Read the line from
// the content cell (it carries data-line); the gutter cell carries the bar.
// Playwright's CSS engine pierces the library's open shadow root, so a plain
// descendant selector reaches them.
const cursor = (page: Page) =>
  page.locator(".diffview [data-content] [data-line][data-caret-cursor]");
const cursorBar = (page: Page) =>
  page.locator(".diffview [data-gutter] [data-column-number][data-caret-cursor]");

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

// Where a scroll PARKED the cursor row: its top as a fraction of the scroller's
// height. This is what tells the top-parked shared jump (]]/[[, the breadcrumb
// and ToC picks) from the scrolloff follow (j), which leaves the row riding in
// the lower band instead.
const relTop = (page: Page) =>
  cursor(page).evaluate((el, surface) => {
    const row = el.getBoundingClientRect();
    const view = document.querySelector(surface)!.getBoundingClientRect();
    return (row.top - view.top) / view.height;
  }, PLAN_SURFACE);

/** Waits for the plan's scroll position to stop moving. The jump is animated, so
 * a rect read on the frame after the keystroke measures the flight rather than
 * where it parked; two identical non-zero reads mean it has landed. Only usable
 * where the jump lands somewhere OTHER than the top — a zero landing is
 * indistinguishable from "has not started", so it would poll until the deadline. */
async function settleScroll(page: Page): Promise<void> {
  let previous = -1;
  await expect
    .poll(async () => {
      const now = await page.locator(PLAN_SURFACE).evaluate((el) => el.scrollTop);
      const landed = now > 0 && now === previous;
      previous = now;
      return landed;
    })
    .toBe(true);
}

async function loadPlan(page: Page): Promise<void> {
  await planSurface(page);
  // The rows paint asynchronously; wait for one before driving motion so the
  // cursor lands on a real row (and topVisibleLine has something to seed from).
  await expect(page.locator(".diffview [data-content] [data-line]").first()).toBeVisible();
  await waitPastSafeModeGrace(page);
}

test("j/k place and step the cursor, it reads as distinct, and Esc leaves it placed", async ({
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

  // The cursor's gutter cell carries the left-bar treatment (a box-shadow the
  // plain and hovered rows never get) — the visual distinction from the hover-+.
  const boxShadow = await cursorBar(page).evaluate((el) => getComputedStyle(el).boxShadow);
  expect(boxShadow).not.toBe("none");

  // Esc never clears the cursor (EXC-834): with no composer open and no visual
  // selection there is nothing to clear, so the reader keeps their place. Mash it.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expectCursorLine(page, start);
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

  // Charlie is well past the fold, so reaching it scrolled — and the jump parks
  // it near the TOP of the scroller. The mirror of the scrolloff follow's
  // relTop > 0.4 below: a `j` crossing rides the lower band, a heading jump does
  // not, which is the whole difference between the two scrolls.
  await settleScroll(page);
  expect(await relTop(page)).toBeLessThan(0.2);

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

test("holding j keeps the cursor on-screen and follows it, never yanking it to the top", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: PLAN });
  await page.goto("/");
  await loadPlan(page);

  await page.keyboard.press("g");
  await page.keyboard.press("g");
  await expectCursorLine(page, 1);

  // Step far past the first viewport. The cursor must stay on-screen at EVERY
  // step — the old behavior parked it at the very top once it crossed the fold.
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("j");
    await expect(cursor(page)).toBeInViewport();
  }

  // It rides in the lower part of the scroller (the scrolloff band), not parked
  // at the top: the view scrolls WITH the cursor instead of jumping it upward.
  expect(await relTop(page)).toBeGreaterThan(0.4);
});

// The seam-fill strip, as Chromium serializes it: a shadow layer pulled left by the two
// insets, with no blur and no spread. Matching the negative offset rather than "not none"
// is what keeps this pointed at the strip — since EXC-1145 every code row carries a lift
// as well, so a resting row's box-shadow is no longer the empty string's stand-in.
const SEAM_STRIP = /-[\d.]+px 0px 0px 0px/;

test("the focused-line cursor band paints the code row, not just its gutter", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: PLAN_WITH_CODE });
  await page.goto("/");
  await loadPlan(page);

  // The fenced code rows (data-code-line is applied after render).
  const codeCells = page.locator(".diffview [data-content] [data-line][data-code-line]");
  await expect(codeCells.first()).toBeAttached();
  const codeLines = new Set<number>();
  for (const cell of await codeCells.all()) {
    const n = Number(await cell.getAttribute("data-line"));
    if (Number.isFinite(n)) codeLines.add(n);
  }
  expect(codeLines.size).toBeGreaterThan(1);

  // Walk the cursor down by keyboard only (so it is NEVER selected — selection is
  // amber and would mask the neutral cursor band) until it lands on a code line.
  // The plan is reflowed, so line numbers come from the DOM.
  await page.keyboard.press("g");
  await page.keyboard.press("g");
  let onCode = -1;
  for (let i = 0; i < 300 && onCode < 0; i++) {
    const line = Number(await cursor(page).getAttribute("data-line"));
    if (codeLines.has(line)) onCode = line;
    else await page.keyboard.press("j");
  }
  expect(codeLines.has(onCode)).toBe(true);

  // The cursor'd code row's content cell carries a band DISTINCT from a plain
  // code row's panel fill — the highlight reaches the code, not just the gutter.
  // A value comparison (not a fixed color) so a palette change doesn't churn it.
  const other = [...codeLines].find((n) => n !== onCode) ?? onCode;
  const bandBg = await page
    .locator(`.diffview [data-content] [data-line="${onCode}"]`)
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  const panelBg = await page
    .locator(`.diffview [data-content] [data-line="${other}"]`)
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bandBg).not.toBe(panelBg);

  // The gutter half matches the content band — the row is banded across BOTH
  // columns, not just the content (the "band dies at the gutter" report).
  const gutterBg = await page
    .locator(`.diffview [data-gutter] [data-column-number="${onCode}"]`)
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(gutterBg).toBe(bandBg);

  // …and the gutter→content SEAM between them is filled (a left box-shadow paints
  // the strip the panel inset would otherwise leave dark), so the band reads
  // continuous across the join like a non-code row — a plain code row has no strip.
  const shadowOf = (line: number) =>
    page
      .locator(`.diffview [data-content] [data-line="${line}"]`)
      .evaluate((el) => getComputedStyle(el).boxShadow);
  const banded = await shadowOf(onCode);
  const plain = await shadowOf(other);
  expect(banded).toMatch(SEAM_STRIP);
  expect(plain).not.toMatch(SEAM_STRIP);
  // The strip is IN FRONT OF the lift both code rows carry, not instead of it: this
  // rule's box-shadow replaces the base row's outright (EXC-1145).
  expect(banded).toContain(plain);
});

test("hovering a code row bands both columns, consistent with the cursor", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: PLAN_WITH_CODE });
  await page.goto("/");
  await loadPlan(page);

  const codeCells = page.locator(".diffview [data-content] [data-line][data-code-line]");
  await expect(codeCells.first()).toBeAttached();
  const codeLines: number[] = [];
  for (const cell of await codeCells.all()) {
    const n = Number(await cell.getAttribute("data-line"));
    if (Number.isFinite(n)) codeLines.push(n);
  }
  expect(codeLines.length).toBeGreaterThan(1);
  const hovered = codeLines[Math.floor(codeLines.length / 2)];
  const plain = codeLines.find((n) => n !== hovered) ?? hovered;

  const bgOf = (sel: string) =>
    page.locator(sel).evaluate((el) => getComputedStyle(el).backgroundColor);
  const panelBg = await bgOf(`.diffview [data-content] [data-line="${plain}"]`);

  await page.locator(`.diffview [data-content] [data-line="${hovered}"]`).hover();
  // Web-first: wait for the library to flag the row hovered before reading colors.
  await expect(
    page.locator(`.diffview [data-content] [data-line="${hovered}"][data-hovered]`),
  ).toBeAttached();

  // Content shows a band (not the flat panel fill) AND the gutter matches it — the
  // same both-columns band the cursor gets, so hover and cursor read consistently.
  const contentBg = await bgOf(`.diffview [data-content] [data-line="${hovered}"]`);
  const gutterBg = await bgOf(`.diffview [data-gutter] [data-column-number="${hovered}"]`);
  expect(contentBg).not.toBe(panelBg);
  expect(gutterBg).toBe(contentBg);

  // The gutter→content seam is filled the same way it is for the cursor (a left
  // box-shadow), so the hovered code row's band is continuous across the join — and
  // the lift stays under it, as above.
  const shadowOf = (sel: string) =>
    page.locator(sel).evaluate((el) => getComputedStyle(el).boxShadow);
  const bandedShadow = await shadowOf(`.diffview [data-content] [data-line="${hovered}"]`);
  const plainShadow = await shadowOf(`.diffview [data-content] [data-line="${plain}"]`);
  expect(bandedShadow).toMatch(SEAM_STRIP);
  expect(plainShadow).not.toMatch(SEAM_STRIP);
  expect(bandedShadow).toContain(plainShadow);
});

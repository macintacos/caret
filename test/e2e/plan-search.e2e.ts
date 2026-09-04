// Vim-style `/` search over the plan text (EXC-832). Match highlighting is painted
// through the CSS Custom Highlight API, which can't run in happy-dom, and every action
// is a REAL keystroke, so this lives here rather than in a unit (browser-testing.md).
// Line numbers are read from the DOM (the plan is reflowed on ingest), never hardcoded.

import type { Page } from "@playwright/test";

import { cursor, expectCursorLine, readCursorLine } from "@test/e2e/support/cursor.ts";
import { expect, test } from "@test/e2e/support/fixtures.ts";
import { openPlanForKeys } from "@test/e2e/support/source-view.ts";

const filler = (label: string) =>
  Array.from({ length: 8 }, (_, i) => `${label} filler line ${i + 1}.`).join("\n\n");

// A plan with the word "widget" in mixed case across distinct short paragraphs (each
// stays one line through reflow). Lowercase "widget" (smartcase-insensitive) matches
// all five; "Widget" (an uppercase letter → case-sensitive) matches only the three
// capitalized ones.
const PLAN = [
  "# Widget overview", // Widget
  filler("Intro"),
  "The widget hums along quietly.", // widget
  "A Widget stands apart from the others.", // Widget
  filler("Middle"),
  "Every widget counts in this plan.", // widget
  "One more Widget to review here.", // Widget
  filler("Tail"),
  "",
].join("\n\n");

const pill = (page: Page) => page.getByRole("search");
const field = (page: Page) => page.locator("input[aria-label='Search plan']");

// The pill's tabular "n / total" counter, parsed.
async function counter(page: Page): Promise<{ current: number; total: number }> {
  const raw = (await page.locator(".search-count").textContent()) ?? "";
  const [current, total] = raw.replace(/\s+/g, "").split("/").map(Number);
  return { current: current ?? 0, total: total ?? 0 };
}

// Range counts in each registered custom highlight — proof the matches painted.
async function highlightSizes(page: Page): Promise<{ current: number; all: number }> {
  return page.evaluate(() => ({
    current: CSS.highlights.get("caret-search-current")?.size ?? 0,
    all: CSS.highlights.get("caret-search")?.size ?? 0,
  }));
}

/** Open the search pill, type "widget", and commit — the arrange several specs below
 * share before diverging into their own checks on the landed cursor. */
async function commitWidgetSearch(page: Page): Promise<void> {
  await page.keyboard.press("/");
  await page.keyboard.type("widget");
  await expect.poll(async () => (await counter(page)).total).toBeGreaterThan(1);
  await page.keyboard.press("Enter");
  await expect(cursor(page)).toHaveCount(1);
}

/** Escape a committed search and confirm it is gone, highlights cleared with it. */
async function dismissSearch(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(pill(page)).toHaveCount(0);
  await expect.poll(async () => (await highlightSizes(page)).all).toBe(0);
}

test("/ opens the pill, focuses it, and typing paints live match highlights", async ({
  daemon,
  page,
}) => {
  await openPlanForKeys(page, daemon, PLAN);

  await expect(pill(page)).toHaveCount(0);

  await page.keyboard.press("/");
  await expect(pill(page)).toBeVisible();
  await expect(field(page)).toBeFocused();

  await page.keyboard.type("widget");

  await expect.poll(async () => (await counter(page)).total).toBeGreaterThan(1);
  await expect.poll(async () => (await highlightSizes(page)).current).toBe(1);
  expect((await highlightSizes(page)).all).toBeGreaterThanOrEqual(1);
});

test("Enter commits: the cursor lands on a match and the pill persists as a HUD", async ({
  daemon,
  page,
}) => {
  await openPlanForKeys(page, daemon, PLAN);
  await commitWidgetSearch(page);

  // The field is blurred so n/N fire globally, and read-only in the committed HUD so a
  // click can't desync the counter (re-edit via /).
  expect(((await cursor(page).textContent()) ?? "").toLowerCase()).toContain("widget");
  await expect(pill(page)).toBeVisible();
  await expect(field(page)).not.toBeFocused();
  await expect(field(page)).toHaveJSProperty("readOnly", true);
});

test("n / N cycle matches, wrapping back to the start after a full loop", async ({
  daemon,
  page,
}) => {
  await openPlanForKeys(page, daemon, PLAN);
  await commitWidgetSearch(page);
  const { total } = await counter(page);
  const start = await readCursorLine(page);

  await page.keyboard.press("n");
  await expect(cursor(page)).not.toHaveAttribute("data-line", String(start));
  await page.keyboard.press("N");
  await expectCursorLine(page, start);

  // A full loop of n wraps back to the start line.
  for (let i = 0; i < total; i++) await page.keyboard.press("n");
  await expectCursorLine(page, start);
});

test("/ reopens the previous committed search, prefilled and selected", async ({
  daemon,
  page,
}) => {
  await openPlanForKeys(page, daemon, PLAN);
  await commitWidgetSearch(page);
  await expect(field(page)).not.toBeFocused();

  // The whole value comes back selected, so typing replaces it the way a browser find
  // does. Escaping without committing does NOT remember — see smartcase below.
  await page.keyboard.press("/");
  await expect(field(page)).toBeFocused();
  await expect(field(page)).toHaveValue("widget");
  await expect(field(page)).toHaveJSProperty("readOnly", false);
  const selection = await field(page).evaluate((el: HTMLInputElement) => [
    el.selectionStart,
    el.selectionEnd,
  ]);
  expect(selection).toEqual([0, "widget".length]);
});

test("n resumes a closed search from the cursor, reopening the pill as a HUD", async ({
  daemon,
  page,
}) => {
  await openPlanForKeys(page, daemon, PLAN);

  await commitWidgetSearch(page);
  const committed = await readCursorLine(page);
  await dismissSearch(page);

  // With the pill closed, n resumes the remembered search from where the cursor sat.
  // The pill returns as a HUD with the field NOT refocused, so bare keys keep flowing.
  await page.keyboard.press("n");
  await expect(pill(page)).toBeVisible();
  await expect(field(page)).not.toBeFocused();
  await expect(cursor(page)).toHaveCount(1);
  await expect(cursor(page)).not.toHaveAttribute("data-line", String(committed));
  await expect.poll(async () => (await highlightSizes(page)).current).toBe(1);
});

test("the '/ to search' hint shows with hints on, and / swaps it for the pill", async ({
  daemon,
  page,
}) => {
  await openPlanForKeys(page, daemon, PLAN);

  // Show Hints is on by default.
  const hint = page.locator(".search-hint");
  await expect(hint).toBeVisible();
  await expect(hint).toContainText("/");
  await expect(hint).toContainText("to search");
  await expect(pill(page)).toHaveCount(0);

  await page.keyboard.press("/");
  await expect(pill(page)).toBeVisible();
  await expect(hint).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(pill(page)).toHaveCount(0);
  await expect(hint).toBeVisible();
});

test("the hint is hidden when Show Hints is off, but / still opens search", async ({
  daemon,
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("caret.shortcutHints", "off"));
  await openPlanForKeys(page, daemon, PLAN);

  await expect(page.locator(".search-hint")).toHaveCount(0);
  await page.keyboard.press("/");
  await expect(pill(page)).toBeVisible();
});

test("smartcase: an uppercase letter narrows the match set", async ({ daemon, page }) => {
  await openPlanForKeys(page, daemon, PLAN);

  // Lowercase query is case-insensitive.
  await page.keyboard.press("/");
  await page.keyboard.type("widget");
  await expect.poll(async () => (await counter(page)).total).toBeGreaterThan(1);
  const lower = (await counter(page)).total;
  await page.keyboard.press("Escape");
  await expect(pill(page)).toHaveCount(0);

  // An uppercase letter flips it case-sensitive, matching fewer.
  await page.keyboard.press("/");
  await page.keyboard.type("Widget");
  await expect.poll(async () => (await counter(page)).total).toBeGreaterThan(0);
  const upper = (await counter(page)).total;
  expect(upper).toBeLessThan(lower);
});

test("Esc dismisses from the field and from a committed search, clearing highlights", async ({
  daemon,
  page,
}) => {
  await openPlanForKeys(page, daemon, PLAN);

  // From the focused field.
  await page.keyboard.press("/");
  await page.keyboard.type("widget");
  await expect.poll(async () => (await highlightSizes(page)).current).toBe(1);
  await dismissSearch(page);

  // From a committed search, field blurred.
  await commitWidgetSearch(page);
  await expect(field(page)).not.toBeFocused();
  await page.keyboard.press("Escape");
  await expect(pill(page)).toHaveCount(0);
});

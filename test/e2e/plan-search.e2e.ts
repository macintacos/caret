// Vim-style `/` search over the plan text (EXC-832). Opening the pill, live match
// highlighting (painted via the CSS Custom Highlight API, which can't run in
// happy-dom), Enter-commit moving the line cursor, n/N cycling with wrap, smartcase,
// Esc-to-dismiss, remembering the last committed query (reopening prefilled/selected),
// resuming a closed search with n/N from the cursor, and the "/ to search" discovery
// hint chip are all real-browser keyboard/highlight behavior, so they live here rather
// than in a unit (browser-testing.md). Every action is a REAL keystroke; line numbers
// are read from the DOM (the plan is reflowed on ingest), never hardcoded.
// waitPastSafeModeGrace is mandatory before the first keystroke.

import type { Page } from "@playwright/test";

import { expect, test, waitPastSafeModeGrace } from "@test/e2e/support/fixtures.ts";
import { planSurface } from "@test/e2e/support/source-view.ts";

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

const pill = (page: Page) => page.locator(".plan-search");
const field = (page: Page) => page.locator("input[aria-label='Search plan']");
const cursor = (page: Page) =>
  page.locator(".diffview [data-content] [data-line][data-caret-cursor]");

async function loadPlan(page: Page): Promise<void> {
  await planSurface(page);
  await expect(page.locator(".diffview [data-content] [data-line]").first()).toBeVisible();
  await waitPastSafeModeGrace(page);
}

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

const cursorLine = async (page: Page): Promise<number> =>
  Number((await cursor(page).getAttribute("data-line")) ?? -1);

test("/ opens the pill, focuses it, and typing paints live match highlights", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: PLAN });
  await page.goto("/");
  await loadPlan(page);

  // No pill until / opens it.
  await expect(pill(page)).toHaveCount(0);

  await page.keyboard.press("/");
  await expect(pill(page)).toBeVisible();
  await expect(field(page)).toBeFocused();

  await page.keyboard.type("widget");

  // The counter reads the match total; the current match is highlighted distinctly
  // from the rest (one current range, the others in the underlay).
  await expect.poll(async () => (await counter(page)).total).toBeGreaterThan(1);
  await expect.poll(async () => (await highlightSizes(page)).current).toBe(1);
  expect((await highlightSizes(page)).all).toBeGreaterThanOrEqual(1);
});

test("Enter commits: the cursor lands on a match and the pill persists as a HUD", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: PLAN });
  await page.goto("/");
  await loadPlan(page);

  await page.keyboard.press("/");
  await page.keyboard.type("widget");
  await expect.poll(async () => (await counter(page)).total).toBeGreaterThan(1);

  await page.keyboard.press("Enter");

  // The line cursor lands on a row containing the query; the pill stays as a HUD and
  // focus returns to the plan (the field is blurred so n/N fire globally). The field is
  // read-only in the committed HUD so a click can't desync the counter (re-edit via /).
  await expect(cursor(page)).toHaveCount(1);
  expect(((await cursor(page).textContent()) ?? "").toLowerCase()).toContain("widget");
  await expect(pill(page)).toBeVisible();
  await expect(field(page)).not.toBeFocused();
  await expect(field(page)).toHaveJSProperty("readOnly", true);
});

test("n / N cycle matches, wrapping back to the start after a full loop", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: PLAN });
  await page.goto("/");
  await loadPlan(page);

  await page.keyboard.press("/");
  await page.keyboard.type("widget");
  await expect.poll(async () => (await counter(page)).total).toBeGreaterThan(1);
  const { total } = await counter(page);
  await page.keyboard.press("Enter");
  await expect(cursor(page)).toHaveCount(1);
  const start = await cursorLine(page);

  // n advances to a different match line; N steps back to the start.
  await page.keyboard.press("n");
  await expect(cursor(page)).not.toHaveAttribute("data-line", String(start));
  await page.keyboard.press("N");
  await expect(cursor(page)).toHaveAttribute("data-line", String(start));

  // A full loop of n (total steps) wraps back to the start line.
  for (let i = 0; i < total; i++) await page.keyboard.press("n");
  await expect(cursor(page)).toHaveAttribute("data-line", String(start));
});

test("/ reopens the previous committed search, prefilled and selected", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: PLAN });
  await page.goto("/");
  await loadPlan(page);

  await page.keyboard.press("/");
  await page.keyboard.type("widget");
  await page.keyboard.press("Enter");
  await expect(field(page)).not.toBeFocused();

  // Committing remembers the query: reopening with / brings it back focused, prefilled
  // with "widget", and with the whole value selected so typing replaces it (like a
  // browser find). Escaping (never committing) does NOT remember — see smartcase below.
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
  await daemon.seed({ plan: PLAN });
  await page.goto("/");
  await loadPlan(page);

  // Commit a search, then Esc to dismiss the pill entirely.
  await page.keyboard.press("/");
  await page.keyboard.type("widget");
  await expect.poll(async () => (await counter(page)).total).toBeGreaterThan(1);
  await page.keyboard.press("Enter");
  await expect(cursor(page)).toHaveCount(1);
  const committed = await cursorLine(page);
  await page.keyboard.press("Escape");
  await expect(pill(page)).toHaveCount(0);
  await expect.poll(async () => (await highlightSizes(page)).all).toBe(0);

  // With the pill closed, n resumes the remembered search: the pill returns as a HUD
  // (field NOT refocused, so bare keys keep flowing), the highlights repaint, and the
  // cursor advances to the next match from where it sat.
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
  await daemon.seed({ plan: PLAN });
  await page.goto("/");
  await loadPlan(page);

  // Show Hints is on by default: the discovery chip sits in the dock, naming the key.
  const hint = page.locator(".search-hint");
  await expect(hint).toBeVisible();
  await expect(hint).toContainText("/");
  await expect(hint).toContainText("to search");
  await expect(pill(page)).toHaveCount(0);

  // Pressing / swaps the chip for the search pill; Esc swaps it back.
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
  await daemon.seed({ plan: PLAN });
  await page.goto("/");
  await loadPlan(page);

  await expect(page.locator(".search-hint")).toHaveCount(0);
  await page.keyboard.press("/");
  await expect(pill(page)).toBeVisible();
});

test("smartcase: an uppercase letter narrows the match set", async ({ daemon, page }) => {
  await daemon.seed({ plan: PLAN });
  await page.goto("/");
  await loadPlan(page);

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
  await daemon.seed({ plan: PLAN });
  await page.goto("/");
  await loadPlan(page);

  // From the focused field: Esc closes and clears the highlights.
  await page.keyboard.press("/");
  await page.keyboard.type("widget");
  await expect.poll(async () => (await highlightSizes(page)).current).toBe(1);
  await page.keyboard.press("Escape");
  await expect(pill(page)).toHaveCount(0);
  await expect.poll(async () => (await highlightSizes(page)).all).toBe(0);

  // From a committed search (field blurred, cursor placed): Esc still closes.
  await page.keyboard.press("/");
  await page.keyboard.type("widget");
  await page.keyboard.press("Enter");
  await expect(field(page)).not.toBeFocused();
  await page.keyboard.press("Escape");
  await expect(pill(page)).toHaveCount(0);
});

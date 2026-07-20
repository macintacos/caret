// Vim-style `/` search over the plan text (EXC-832). Opening the pill, live match
// highlighting (painted via the CSS Custom Highlight API, which can't run in
// happy-dom), Enter-commit moving the line cursor, n/N cycling with wrap, smartcase,
// and Esc-to-dismiss are all real-browser keyboard/highlight behavior, so they live
// here rather than in a unit (browser-testing.md). Every action is a REAL keystroke;
// line numbers are read from the DOM (the plan is reflowed on ingest), never
// hardcoded. waitPastSafeModeGrace is mandatory before the first keystroke.

import type { Page } from "@playwright/test";

import { expect, test, waitPastSafeModeGrace } from "./support/fixtures.ts";

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
  await expect(page.locator(".diff-plan")).toBeVisible();
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
  // focus returns to the plan (the field is blurred so n/N fire globally).
  await expect(cursor(page)).toHaveCount(1);
  expect(((await cursor(page).textContent()) ?? "").toLowerCase()).toContain("widget");
  await expect(pill(page)).toBeVisible();
  await expect(field(page)).not.toBeFocused();
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

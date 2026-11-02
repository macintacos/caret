// Vim-style `/` search over the plan text (EXC-832). Match highlighting is painted
// through the CSS Custom Highlight API, which can't run in happy-dom, every action is a
// REAL keystroke, and where the find row lands in the plan header and how it moves are a
// laid-out box and the engine's own animations, so this lives here rather than in a unit
// (browser-testing.md). The row's own render is ui/src/components/PlanSearch.test.ts.
// Line numbers are read from the DOM (the plan is reflowed on ingest), never hardcoded.

import type { Page } from "@playwright/test";

import { cursor, expectCursorLine, readCursorLine } from "@test/e2e/support/cursor.ts";
import { fileRefCount, makeProject } from "@test/e2e/support/file-refs.ts";
import { expect, motionToken, test, waitPastSafeModeGrace } from "@test/e2e/support/fixtures.ts";
import { openPlanForKeys, planSurface } from "@test/e2e/support/source-view.ts";

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
  // A blank counter (no query) and "No matches" both count nothing.
  if (!raw.includes("/")) return { current: 0, total: 0 };
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

  // The query is stamped and the field gone, so nothing in the sheet can take focus and
  // swallow the bare n / N (re-edit via /).
  expect(((await cursor(page).textContent()) ?? "").toLowerCase()).toContain("widget");
  await expect(pill(page)).toBeVisible();
  await expect(field(page)).toHaveCount(0);
  await expect(page.locator(".search-stamp")).toHaveText(/\/\s*widget/);
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

  // The whole value comes back selected, so typing replaces it the way a browser find
  // does. Escaping without committing does NOT remember — see smartcase below.
  await page.keyboard.press("/");
  await expect(field(page)).toBeFocused();
  await expect(field(page)).toHaveValue("widget");
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
  // The pill returns stamped, with no field to take focus, so bare keys keep flowing.
  await page.keyboard.press("n");
  await expect(pill(page)).toBeVisible();
  await expect(page.locator(".search-stamp")).toBeVisible();
  await expect(cursor(page)).toHaveCount(1);
  await expect(cursor(page)).not.toHaveAttribute("data-line", String(committed));
  await expect.poll(async () => (await highlightSizes(page)).current).toBe(1);
});

test("the '/ to search' hint shows with hints on, and / covers it with the pill", async ({
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

  // The row covers the hint along with the crumbs, which keep their boxes under it.
  await page.keyboard.press("/");
  await expect(pill(page)).toBeVisible();
  await expect(hint).toBeHidden();
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

  // From a committed search, stamped.
  await commitWidgetSearch(page);
  await expect(page.locator(".search-stamp")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(pill(page)).toHaveCount(0);
});

// The find row stands over an open file the way the outline's float does: Escape closes
// whichever was opened last.
test("Esc closes the find row before the file beside the plan, and the next Esc the file", async ({
  daemon,
  page,
}) => {
  const proj = await makeProject({ "src/widget.ts": "export const widget = 1;\n" });
  try {
    await daemon.seed({
      cwd: proj.dir,
      plan: "# Widgets\n\nThe widget lives in `src/widget.ts`.\n",
    });
    await page.goto("/");
    await planSurface(page);
    await waitPastSafeModeGrace(page);
    await expect.poll(() => fileRefCount(page)).toBe(1);
    await page.locator("[data-file-ref]").first().click();
    const drawer = page.locator("[data-file-drawer]");
    await expect(drawer).toBeVisible();

    await page.keyboard.press("/");
    await page.keyboard.type("widget");
    await page.keyboard.press("Escape");
    await expect(pill(page)).toHaveCount(0);
    await expect(drawer).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
  } finally {
    await proj.cleanup();
  }
});

// The find row drops over the crumbs inside the plan header: where it lands is a laid-out
// box, and the crumbs keeping theirs under it is a computed visibility.
test("the find row covers the crumbs in the plan header, and the crumbs keep their box", async ({
  daemon,
  page,
}) => {
  await openPlanForKeys(page, daemon, PLAN);
  const crumbs = page.locator(".plan-header .plan-breadcrumbs");
  await expect(crumbs).toBeVisible();
  const before = await crumbs.boundingBox();

  await page.keyboard.press("/");
  const row = page.locator(".plan-header").getByRole("search");
  await expect(row).toBeVisible();
  // Measured where it lands, not mid-drop.
  await row.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  await expect(crumbs).toHaveCSS("visibility", "hidden");
  expect(await crumbs.boundingBox()).toEqual(before);

  // Inside the header, ending before the view keys, which stay.
  const header = await page.locator(".plan-header").boundingBox();
  const box = await row.boundingBox();
  const versions = await page.getByRole("button", { name: /^Versions/ }).boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(header!.y);
  expect(box!.y + box!.height).toBeLessThanOrEqual(header!.y + header!.height + 0.5);
  expect(box!.x + box!.width).toBeLessThanOrEqual(versions!.x);
});

test("closing tucks the find row up as the crumbs fade back in, on the state duration", async ({
  daemon,
  page,
}) => {
  await openPlanForKeys(page, daemon, PLAN);
  await page.keyboard.press("/");
  await expect(pill(page)).toBeVisible();

  await page.keyboard.press("Escape");
  const motion = await page.evaluate(() =>
    document.getAnimations().flatMap((a) => {
      const target = (a.effect as KeyframeEffect | null)?.target;
      if (!(target instanceof Element)) return [];
      const what = target.matches(".plan-search")
        ? "row"
        : target.matches(".plan-breadcrumbs")
          ? "crumbs"
          : null;
      if (what === null) return [];
      const name =
        a instanceof CSSAnimation ? a.animationName : (a as CSSTransition).transitionProperty;
      return [{ what, name, ms: Number(a.effect?.getComputedTiming().duration) }];
    }),
  );
  const stateMs = (await motionToken(page, "--dur-state")) * 1000;
  expect(motion.find((m) => m.what === "row")).toEqual({
    what: "row",
    name: expect.stringMatching(/search-tuck$/),
    ms: stateMs,
  });
  expect(motion.find((m) => m.what === "crumbs")).toEqual({
    what: "crumbs",
    name: "opacity",
    ms: stateMs,
  });
  await expect(pill(page)).toHaveCount(0);
});

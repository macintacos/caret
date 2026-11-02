// Vim-style `/` search over the plan text (EXC-832). Match highlighting is painted
// through the CSS Custom Highlight API, which can't run in happy-dom, every action is
// real input, a keystroke or a click, and where the find row lands in the plan header and how it moves are a
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
const searchEntry = (page: Page) =>
  page.locator(".plan-header").getByRole("button", { name: "Search", exact: true });
const closeKey = (page: Page) => pill(page).getByRole("button", { name: "Close search" });

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

test("the Search entry wears its / cap, and a click opens the find row with its field focused", async ({
  daemon,
  page,
}) => {
  await openPlanForKeys(page, daemon, PLAN);

  // Show Hints is on by default.
  const entry = searchEntry(page);
  await expect(entry).toHaveAttribute("aria-keyshortcuts", "/");
  await expect(entry.locator("[data-slot='kbd']")).toHaveText("/");
  await expect(pill(page)).toHaveCount(0);

  // The row covers the entry along with the crumbs, and closing gives it back.
  await entry.click();
  await expect(pill(page)).toBeVisible();
  await expect(field(page)).toBeFocused();
  await expect(entry).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(pill(page)).toHaveCount(0);
  await expect(entry).toBeVisible();
});

// The press echo marks the entry while `/` plays its press, and the mark must dimple it as
// a click does. Svelte drops a selector for an attribute only script sets unless it is global.
test("the / key's press echo dimples the Search entry", async ({ daemon, page }) => {
  await openPlanForKeys(page, daemon, PLAN);
  const entry = searchEntry(page);
  const shadow = () => entry.evaluate((el) => getComputedStyle(el).boxShadow);
  const rest = await shadow();
  await entry.evaluate((el) => el.setAttribute("data-key-pressed", ""));
  await expect.poll(shadow).not.toBe(rest);
});

test("Enter on the Search entry opens the find row, as / does", async ({ daemon, page }) => {
  await openPlanForKeys(page, daemon, PLAN);
  const entry = searchEntry(page);
  await expect(entry).toHaveJSProperty("tabIndex", 0);

  await entry.focus();
  await page.keyboard.press("Enter");
  await expect(pill(page)).toBeVisible();
  await expect(field(page)).toBeFocused();
});

test("with Show Hints off, the Search entry is a magnifier and its word, and a click opens search", async ({
  daemon,
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("caret.shortcutHints", "off"));
  await openPlanForKeys(page, daemon, PLAN);

  const entry = searchEntry(page);
  await expect(entry.locator("[data-icon='search']")).toBeVisible();
  await expect(entry.locator("[data-slot='kbd']")).toHaveCount(0);
  await entry.click();
  await expect(pill(page)).toBeVisible();
  await expect(field(page)).toBeFocused();

  // The way out keeps its word with the hints gone.
  await expect(closeKey(page)).toHaveText("Close");
  await expect(closeKey(page).locator("[data-slot='kbd']")).toHaveCount(0);
  await closeKey(page).click();
  await expect(pill(page)).toHaveCount(0);
});

/** Wait out the find row's own animations. */
const rowSettled = (page: Page) =>
  page
    .locator(".plan-header .plan-search")
    .evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));

test("Close stands where the Search entry stood, wears its Esc cap, and a click closes the row", async ({
  daemon,
  page,
}) => {
  await openPlanForKeys(page, daemon, PLAN);
  await layoutStill(page);
  const entry = (await searchEntry(page).boundingBox())!;
  await searchEntry(page).click();
  await expect(pill(page)).toBeVisible();
  await rowSettled(page);

  await expect(closeKey(page).locator("[data-slot='kbd']")).toHaveText(/^esc$/i);
  const tray = (await page.locator(".plan-search .search-close-tray").boundingBox())!;
  expect(Math.abs(tray.x + tray.width - (entry.x + entry.width))).toBeLessThan(1);
  await closeKey(page).click();
  await expect(pill(page)).toHaveCount(0);
  await expect(searchEntry(page)).toBeVisible();
});

// The row starts past the slot's end, where focusing its field would scroll the plan's
// body sideways to bring it into view.
test("opening the find row never scrolls the plan sideways", async ({ daemon, page }) => {
  await openPlanForKeys(page, daemon, PLAN);
  await layoutStill(page);
  await page.evaluate(() => {
    const w = window as unknown as { __scrolls: number };
    w.__scrolls = 0;
    document.querySelector(".plan-body")?.addEventListener("scroll", () => w.__scrolls++);
  });
  await searchEntry(page).click();
  await expect(field(page)).toBeFocused();
  await rowSettled(page);
  const scrolls = await page.evaluate(() => (window as unknown as { __scrolls: number }).__scrolls);
  expect(scrolls).toBe(0);
});

interface Frame {
  left: number;
  top: number;
}

/** Start logging the find row's box each frame, whenever it is mounted. */
async function sampleRow(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __frames: Frame[]; __sampling: boolean };
    w.__frames = [];
    w.__sampling = true;
    const sample = () => {
      const row = document.querySelector(".plan-header .plan-search");
      if (row !== null) {
        const box = row.getBoundingClientRect();
        w.__frames.push({ left: box.left, top: box.top });
      }
      if (w.__sampling) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

/** Stop the log, and return it. */
async function sampledRow(page: Page): Promise<Frame[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __frames: Frame[]; __sampling: boolean };
    w.__sampling = false;
    return w.__frames;
  });
}

/** The row only ever stood level with the header, and never left of where it rests. */
function expectLevelSlide(frames: Frame[], rest: { x: number; y: number }): void {
  expect(Math.min(...frames.map((f) => f.left)), "left of its rest").toBeGreaterThan(rest.x - 0.5);
  expect(Math.max(...frames.map((f) => Math.abs(f.top - rest.y))), "off the header").toBeLessThan(
    0.5,
  );
}

/** Wait out the layout's own slides, such as the outline column standing as the page loads. */
async function layoutStill(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      !document
        .querySelector(".plan-body")
        ?.getAnimations({ subtree: true })
        .some((a) => a instanceof CSSTransition),
  );
}

// Where the row stands each frame is the engine's own animation, laid out.
test("the find row slides open from the Search entry and tucks back into it, level with the header", async ({
  daemon,
  page,
}) => {
  await openPlanForKeys(page, daemon, PLAN);
  const entry = searchEntry(page);
  const row = page.locator(".plan-header .plan-search");
  await layoutStill(page);

  await sampleRow(page);
  await entry.click();
  await expect(pill(page)).toBeVisible();
  await row.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  const rest = (await row.boundingBox())!;
  const opening = await sampledRow(page);

  // It arrives from the entry's end of the header.
  expect(opening[0]!.left).toBeGreaterThan(rest.x + 1);
  expectLevelSlide(opening, rest);

  await sampleRow(page);
  await page.keyboard.press("Escape");
  await expect(pill(page)).toHaveCount(0);
  const closing = await sampledRow(page);

  // It leaves the way it came, toward the entry, which is back in its place.
  expect(closing.at(-1)!.left).toBeGreaterThan(rest.x + 1);
  expectLevelSlide(closing, rest);
  await expect(entry).toBeVisible();
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

// The find row covers the crumbs inside the plan header: where it lands is a laid-out
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
  // Measured where it lands, not mid-slide.
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

interface Start {
  what: "row" | "crumbs";
  name: string;
  ms: number;
}

/** Log each animation that starts on the find row and each transition on the crumbs, with
 * its duration, as it starts: the row may finish, or leave the page, before a later read. */
async function armStartLog(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __starts: Start[] };
    w.__starts = [];
    const log = (e: AnimationEvent | TransitionEvent) => {
      const target = e.target as Element;
      const what = target.matches(".plan-search")
        ? "row"
        : target.matches(".plan-breadcrumbs")
          ? "crumbs"
          : null;
      if (what === null) return;
      const name = e instanceof AnimationEvent ? e.animationName : e.propertyName;
      const motion = target
        .getAnimations()
        .find((a) =>
          a instanceof CSSAnimation
            ? a.animationName === name
            : (a as CSSTransition).transitionProperty === name,
        );
      w.__starts.push({ what, name, ms: Number(motion?.effect?.getComputedTiming().duration) });
    };
    addEventListener("animationstart", log, { capture: true });
    addEventListener("transitionrun", log, { capture: true });
  });
}

/** The logged starts, once `until` holds of them, emptying the log. */
async function loggedStarts(page: Page, until: (starts: Start[]) => boolean): Promise<Start[]> {
  const read = () => page.evaluate(() => (window as unknown as { __starts: Start[] }).__starts);
  await expect.poll(async () => until(await read())).toBe(true);
  return page.evaluate(() => (window as unknown as { __starts: Start[] }).__starts.splice(0));
}

// A slide across the header is a pane's move, so it arrives on the pane's duration and
// leaves on the state's, as the outline column does.
test("the find row opens on the pane duration and tucks back on the state duration as the crumbs fade in", async ({
  daemon,
  page,
}) => {
  await openPlanForKeys(page, daemon, PLAN);
  await armStartLog(page);
  const [paneMs, stateMs] = [
    (await motionToken(page, "--dur-pane")) * 1000,
    (await motionToken(page, "--dur-state")) * 1000,
  ];

  await page.keyboard.press("/");
  const opening = await loggedStarts(page, (starts) => starts.some((s) => s.what === "row"));
  expect(opening.filter((s) => s.what === "row")).toEqual([
    { what: "row", name: expect.stringMatching(/search-open$/), ms: paneMs },
  ]);

  await page.keyboard.press("Escape");
  const tuck = (s: Start) => s.what === "row" && /search-tuck$/.test(s.name);
  const fade = (s: Start) => s.what === "crumbs" && s.name === "opacity";
  const closing = await loggedStarts(page, (starts) => starts.some(tuck) && starts.some(fade));
  expect(closing.find(tuck)?.ms).toBe(stateMs);
  expect(closing.find(fade)?.ms).toBe(stateMs);
  await expect(pill(page)).toHaveCount(0);
});

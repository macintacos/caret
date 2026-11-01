// Vim `/` search on the plan preview, over its rendered text. The CSS Custom Highlight API,
// visual lines at a real width and real keystrokes need a browser; the match space itself
// (whitespace collapse, block bounds, source-line coordinates) is unit-tested in
// ui/src/lib/previewSearch.test.ts and its wiring in ui/src/components/DiffPlanView.test.ts.
//
// The daemon reflows the plan through rumdl at 90 columns, so LONG is written as rumdl
// emits it and the wrap the specs lean on is asserted from the source rows first.

import type { Page } from "@playwright/test";

import { previewToggle } from "@test/e2e/support/chrome.ts";
import { PREVIEW_BAND, previewCursor } from "@test/e2e/support/cursor.ts";
import { expect, test } from "@test/e2e/support/fixtures.ts";
import {
  awaitPlanReadyForKeys,
  lineOf,
  openPlanForKeys,
  PLAN_PREVIEW,
} from "@test/e2e/support/source-view.ts";

const LONG = [
  "Marmalade reviewers read the plan from top to bottom and stop wherever a step looks wrong,",
  "so the preview keeps every paragraph readable at any width while the cursor walks a gadget",
  "past each line. A migration touches the schema first, then backfills old rows in small",
  "batches, and only after that flips the reader over to the harbor lantern column. Rollback",
  "drops the flag, keeps the column, and leaves cleanup for a later release once dashboards",
  "confirm nothing queries it.",
];

const TOKEN = "quokkaTotal";

const PLAN = [
  "# Search fixture",
  "Read the [launch notes](https://example.com/zebrafish) before **starting** work.",
  "- kumquat ripens",
  "A Gadget opens the list.",
  LONG.join("\n"),
  "Another gadget closes it.",
  ["```ts", `const ${TOKEN}: number = 42;`, "```"].join("\n"),
  "",
].join("\n\n");

const pill = (page: Page) => page.getByRole("search");

async function counter(page: Page): Promise<{ current: number; total: number }> {
  const raw = (await page.locator(".search-count").textContent()) ?? "";
  // A blank counter (no query) and "No matches" both count nothing.
  if (!raw.includes("/")) return { current: 0, total: 0 };
  const [current, total] = raw.replace(/\s+/g, "").split("/").map(Number);
  return { current: current ?? 0, total: total ?? 0 };
}

const total = async (page: Page) => (await counter(page)).total;

const highlightTexts = (page: Page, name: string): Promise<string[]> =>
  page.evaluate((n) => [...(CSS.highlights.get(n) ?? [])].map((r) => r.toString()), name);

const current = async (page: Page) =>
  (await highlightTexts(page, "caret-preview-search-current"))[0];

/** Open the pill, type `query`, and return once the count settles on `expected`. */
async function search(page: Page, query: string, expected: number): Promise<void> {
  await page.keyboard.press("/");
  await expect(pill(page)).toBeVisible();
  await page.keyboard.type(query);
  await expect.poll(() => total(page)).toBe(expected);
}

async function dismiss(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(pill(page)).toHaveCount(0);
}

async function flip(page: Page, to: "preview" | "source"): Promise<void> {
  await previewToggle(page).click();
  if (to === "preview") await expect(page.locator(PLAN_PREVIEW)).toBeVisible();
  else await awaitPlanReadyForKeys(page);
}

async function openPreview(page: Page, daemon: Parameters<typeof openPlanForKeys>[1]) {
  await openPlanForKeys(page, daemon, PLAN);
  await flip(page, "preview");
}

/** The current match's first client rect's vertical middle, and its offset into the
 * preview's raw text (which tells two matches apart). */
const currentSpot = (page: Page) =>
  page.evaluate((root) => {
    const range = [...(CSS.highlights.get("caret-preview-search-current") ?? [])][0] as
      | Range
      | undefined;
    if (!range) return null;
    const rect = range.getClientRects()[0]!;
    const before = document.createRange();
    before.setStart(document.querySelector(root)!, 0);
    before.setEnd(range.startContainer, range.startOffset);
    return { mid: rect.top + rect.height / 2, at: before.toString().length };
  }, PLAN_PREVIEW);

test("/ on the preview searches its rendered text, not the markdown source", async ({
  daemon,
  page,
}) => {
  // The source view conceals a link's URL, so markup the source shows proves the contrast.
  await openPlanForKeys(page, daemon, PLAN);
  await search(page, "**", 2);
  await dismiss(page);
  await search(page, "- kumquat", 1);
  await dismiss(page);

  await flip(page, "preview");
  await search(page, "zebrafish", 0);
  await dismiss(page);
  await search(page, "**", 0);
  await dismiss(page);
  await search(page, "- kumquat", 0);
  await dismiss(page);
  await search(page, "launch notes", 1);
});

test("a phrase across a soft wrap is one match on the preview", async ({ daemon, page }) => {
  await openPlanForKeys(page, daemon, PLAN);
  const before = await lineOf(page, LONG[2]!);
  expect(await lineOf(page, LONG[3]!)).toBe(before + 1);
  expect(LONG[2]!.endsWith(" small") && LONG[3]!.startsWith("batches")).toBe(true);
  await search(page, "small batches", 0);
  await dismiss(page);

  await flip(page, "preview");
  await search(page, "small batches", 1);
  await page.keyboard.press("Enter");
  await expect.poll(() => current(page)).toContain("\n");
});

test("every match is highlighted and the current one apart", async ({ daemon, page }) => {
  await openPreview(page, daemon);
  await search(page, "gadget", 3);
  await page.keyboard.press("Enter");

  await expect
    .poll(async () => (await highlightTexts(page, "caret-preview-search")).length)
    .toBe(2);
  await expect
    .poll(async () => (await highlightTexts(page, "caret-preview-search-current")).length)
    .toBe(1);

  const first = (await currentSpot(page))!.at;
  await page.keyboard.press("n");
  await expect.poll(async () => (await currentSpot(page))?.at).not.toBe(first);
});

test("n / N land the band on the match's visual line, with smartcase", async ({ daemon, page }) => {
  await page.setViewportSize({ width: 420, height: 900 });
  await openPlanForKeys(page, daemon, PLAN);
  const gadgetLines = [
    await lineOf(page, "A Gadget opens the list."),
    await lineOf(page, LONG[1]!),
    await lineOf(page, "Another gadget closes it."),
  ];
  await flip(page, "preview");

  await search(page, "Gadget", 1);
  await dismiss(page);
  await search(page, "gadget", 3);
  await page.keyboard.press("Enter");

  const expectBandOnCurrent = async () => {
    const { current: index } = await counter(page);
    await expect(previewCursor(page)).toHaveAttribute("data-line", String(gadgetLines[index - 1]));
    await expect
      .poll(async () => {
        const spot = await currentSpot(page);
        const band = await page.locator(PREVIEW_BAND).boundingBox();
        return !!spot && !!band && spot.mid > band.y && spot.mid < band.y + band.height;
      })
      .toBe(true);
  };

  await expectBandOnCurrent();
  await page.keyboard.press("n");
  await expect.poll(async () => (await counter(page)).current).toBe(2);
  // The second match ends a 90-column source line, so at 420px it sits on that line's
  // second visual line rather than on the visual line its marker starts.
  const markerBottom = await page.evaluate(
    ([root, line]) =>
      document.querySelector(`${root} [data-source-line="${line}"]`)!.getBoundingClientRect()
        .bottom,
    [PLAN_PREVIEW, gadgetLines[1]] as const,
  );
  await expect.poll(async () => (await currentSpot(page))!.mid).toBeGreaterThan(markerBottom);
  await expectBandOnCurrent();
  await page.keyboard.press("n");
  await expect.poll(async () => (await counter(page)).current).toBe(3);
  await expectBandOnCurrent();
  await page.keyboard.press("N");
  await expect.poll(async () => (await counter(page)).current).toBe(2);
  await expectBandOnCurrent();
});

test("a code match still resolves to its token after the highlighter runs", async ({
  daemon,
  page,
}) => {
  await openPreview(page, daemon);
  await expect
    .poll(() =>
      page
        .locator(`${PLAN_PREVIEW} pre code`)
        .last()
        .evaluate((code) => code.childElementCount),
    )
    .toBeGreaterThan(0);
  await search(page, TOKEN, 1);
  await page.keyboard.press("Enter");
  await expect.poll(() => current(page)).toBe(TOKEN);
});

test("Esc closes a committed search on the preview", async ({ daemon, page }) => {
  await openPreview(page, daemon);
  await search(page, "gadget", 3);
  await page.keyboard.press("Enter");
  await expect(page.locator(".search-stamp")).toBeVisible();
  await dismiss(page);
  await expect.poll(() => highlightTexts(page, "caret-preview-search-current")).toEqual([]);
});

test("a flip re-seats the committed match on the new surface", async ({ daemon, page }) => {
  await openPreview(page, daemon);
  await search(page, "small batches", 1);
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await counter(page)).current).toBe(1);

  await flip(page, "source");
  await expect.poll(() => counter(page)).toEqual({ current: 0, total: 0 });
  await expect.poll(() => highlightTexts(page, "caret-preview-search")).toEqual([]);
  await expect.poll(() => highlightTexts(page, "caret-preview-search-current")).toEqual([]);

  await flip(page, "preview");
  await expect.poll(() => counter(page)).toEqual({ current: 1, total: 1 });
});

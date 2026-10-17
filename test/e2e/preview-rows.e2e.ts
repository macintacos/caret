// The preview's rows: the hover band over the visual line under the pointer and the "+"
// beside it, a comment drag's band over the rows it crosses and the bar down the "+" lane,
// what a click, a drag or the "+" cites — every source line with text on those rows — the
// rows' reach to the plan's right edge, and the column's wrap, which holds the same words
// on each row at any root font size or window width so a row's citation never moves.
//
// What needs a real browser here: wrapping, the pointer and wheel driving the bands, a
// real drag, the sideways scroll of a window narrower than the column, and the rows a
// reader sees, read from live text rects. The pure half stays units: the row under a
// height, a row's band and the rows' text in ui/src/lib/previewLines.test.ts, the click
// and drag reporting in ui/src/components/PlanPreview.test.ts, and the gates and slot
// boxes in ui/src/lib/previewComments.test.ts.

import type { Page } from "@playwright/test";

import { previewToggle } from "@test/e2e/support/chrome.ts";
import { type Daemon, expect, test, waitPastSafeModeGrace } from "@test/e2e/support/fixtures.ts";
import {
  glideCounter,
  linesOnRow,
  PLAN_PREVIEW,
  PLAN_SURFACE,
  PREVIEW_DRAG,
  PREVIEW_DRAG_BAR,
  PREVIEW_HOVER,
  planSurface,
  rowLabel,
} from "@test/e2e/support/source-view.ts";

const PROSE =
  "Rows paragraph opens with alpha words that set the scene for the reviewer to read carefully, " +
  "then continues with bravo words describing the middle of the change in plain detail, " +
  "and closes with charlie words that wrap past the end of a stored line.";
const filler = Array.from({ length: 30 }, (_, i) => `Filler paragraph ${i + 1}.`).join("\n\n");
const PLAN = [
  "# Preview rows",
  PROSE,
  ["- item one", "- item two", "- item three"].join("\n"),
  filler,
].join("\n\n");

/** Seeds the plan, opens it on the preview, and returns the stored lines PROSE and the
 * list start on. */
async function openRows(daemon: Daemon, page: Page): Promise<{ prose: number; list: number }> {
  const id = await daemon.seed({ plan: PLAN });
  // The daemon reflows the plan on ingest, so lines come from the stored text.
  const lines = ((await daemon.getReview(id)).body?.currentPlan ?? "").split("\n");
  await page.goto("/");
  await planSurface(page);
  await waitPastSafeModeGrace(page);
  await previewToggle(page).click();
  await expect(page.locator(PLAN_PREVIEW)).toBeVisible();
  const start = (prefix: string) => lines.findIndex((l) => l.startsWith(prefix)) + 1;
  return { prose: start("Rows paragraph"), list: start("- item one") };
}

/** The vertical middle of each visual row of the block holding source `line`, read from its
 * text alone. */
function rowsOf(page: Page, line: number): Promise<number[]> {
  return page.evaluate(
    ({ line, preview }) => {
      const block = [
        ...document.querySelectorAll<HTMLElement>(`${preview} > [data-source-start]`),
      ].find((b) => Number(b.dataset.sourceStart) <= line && line <= Number(b.dataset.sourceEnd));
      const rects: DOMRect[] = [];
      const walker = document.createTreeWalker(block as Node, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const range = document.createRange();
        range.selectNodeContents(node);
        rects.push(...range.getClientRects());
      }
      const mids = rects
        .filter((r) => r.width > 0)
        .map((r) => Math.round((r.top + r.bottom) / 2))
        .sort((a, b) => a - b);
      return [...new Set(mids)].filter((m, i, all) => i === 0 || m - (all[i - 1] as number) > 4);
    },
    { line, preview: PLAN_PREVIEW },
  );
}

/** The first row of the block holding `line` with prose from more than one source line. */
async function mixedRow(page: Page, line: number): Promise<number> {
  for (const y of await rowsOf(page, line)) if ((await linesOnRow(page, y)).length > 1) return y;
  throw new Error(`no row of line ${line}'s block holds two source lines`);
}

/** An x inside the preview's text column. */
const textX = async (page: Page) =>
  (await page
    .locator(PLAN_PREVIEW)
    .boundingBox()
    .then((b) => (b?.x ?? 0) + 200)) as number;

/** An x right of the preview's text column, inside the plan. */
async function besideX(page: Page): Promise<number> {
  const [x, column] = await Promise.all([
    page
      .locator(PLAN_SURFACE)
      .evaluate((el) => el.getBoundingClientRect().left + el.clientWidth - 24),
    columnBox(page),
  ]);
  if (x <= column.right) throw new Error("the plan leaves no room right of the column");
  return x;
}

/** The text column's viewport box: the box of the preview's first block. */
const columnBox = (page: Page) =>
  page
    .locator(`${PLAN_PREVIEW} > [data-source-start]`)
    .first()
    .evaluate((el) => el.getBoundingClientRect().toJSON() as DOMRect);

/** Whether the hover band spans the preview root's width over a row holding `y`. */
function bandHolds(page: Page, y: number): Promise<boolean> {
  return page.evaluate(
    ({ y, band, preview }) => {
      const b = document.querySelector(band)?.getBoundingClientRect();
      const root = document.querySelector(preview)?.getBoundingClientRect();
      if (!b || !root) return false;
      const across = Math.abs(b.left - root.left) < 0.5 && Math.abs(b.right - root.right) < 0.5;
      return across && b.top <= y && y < b.bottom;
    },
    { y, band: PREVIEW_HOVER, preview: PLAN_PREVIEW },
  );
}

const composerLabel = (page: Page) =>
  page.getByRole("dialog", { name: "Add a comment" }).locator(".label");

const plusButton = (page: Page) =>
  page.locator(PLAN_SURFACE).getByRole("button", { name: "Add a comment" });

/** The first word of each visual row of the block holding `line`. */
function rowStarts(page: Page, line: number): Promise<string[]> {
  return page.evaluate(
    ({ line, preview }) => {
      const block = [
        ...document.querySelectorAll<HTMLElement>(`${preview} > [data-source-start]`),
      ].find((b) => Number(b.dataset.sourceStart) <= line && line <= Number(b.dataset.sourceEnd));
      const starts: string[] = [];
      let lastTop = Number.NEGATIVE_INFINITY;
      const walker = document.createTreeWalker(block as Node, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        for (const m of (node.textContent ?? "").matchAll(/\S+/g)) {
          const range = document.createRange();
          range.setStart(node, m.index);
          range.setEnd(node, m.index + 1);
          const top = range.getBoundingClientRect().top;
          if (top - lastTop > 4) starts.push(m[0]);
          lastTop = Math.max(lastTop, top);
        }
      }
      return starts;
    },
    { line, preview: PLAN_PREVIEW },
  );
}

test("the hover band follows the pointer from row to row and under a wheel scroll", async ({
  daemon,
  page,
}) => {
  const { prose } = await openRows(daemon, page);
  const [first, second] = await rowsOf(page, prose);
  if (first === undefined || second === undefined) throw new Error("PROSE renders one row");
  const x = await textX(page);

  for (const y of [first, second]) {
    await page.mouse.move(x, y);
    await expect.poll(() => bandHolds(page, y)).toBe(true);
    await expect(page.locator(PREVIEW_HOVER)).toHaveAttribute(
      "data-line",
      String((await linesOnRow(page, y))[0]),
    );
  }

  const y = second;
  await page.mouse.wheel(0, 90);
  await expect
    .poll(() => page.locator(PLAN_SURFACE).evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
  await expect.poll(() => bandHolds(page, y)).toBe(true);
});

test("the hover band glides between neighbouring rows, a heading's and a paragraph's alike", async ({
  daemon,
  page,
}) => {
  const { prose } = await openRows(daemon, page);
  const [heading] = await rowsOf(page, 1);
  const [first] = await rowsOf(page, prose);
  if (heading === undefined || first === undefined) throw new Error("the plan did not render");
  const x = await textX(page);
  await page.mouse.move(x, heading);
  await expect.poll(() => bandHolds(page, heading)).toBe(true);

  const glides = await glideCounter(page, PREVIEW_HOVER);
  for (const y of [first, heading]) {
    await page.mouse.move(x, y);
    await expect.poll(() => bandHolds(page, y)).toBe(true);
  }
  expect(await glides()).toBe(2);
});

test("a click on a row holding two stored lines comments on both", async ({ daemon, page }) => {
  const { prose } = await openRows(daemon, page);
  const y = await mixedRow(page, prose);
  const lines = await linesOnRow(page, y);

  await page.mouse.click(await textX(page), y);

  await expect(composerLabel(page)).toHaveText(rowLabel(lines));
});

test("a drag from beside the column paints one band over its rows, a bar down the + lane and the + on the pointer's row, and comments on every line on them", async ({
  daemon,
  page,
}) => {
  // The bands are measured mid-drag, so they land rather than glide.
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { prose, list } = await openRows(daemon, page);
  const [from] = await rowsOf(page, prose);
  const [to] = await rowsOf(page, list);
  if (from === undefined || to === undefined) throw new Error("the rows did not render");
  const x = await besideX(page);
  const cited = [...(await linesOnRow(page, from)), ...(await linesOnRow(page, to))];

  await page.mouse.move(x, from);
  await page.mouse.down();
  await page.mouse.move(x - 60, to, { steps: 12 });

  const band = page.locator(PREVIEW_DRAG);
  await expect(band).toHaveCount(1);
  const root = await page.locator(PLAN_PREVIEW).boundingBox();
  const box = await band.boundingBox();
  if (!root || !box) throw new Error("the drag band did not render");
  expect(Math.abs(box.x - root.x)).toBeLessThan(0.5);
  expect(Math.abs(box.width - root.width)).toBeLessThan(0.5);
  expect(box.y <= from && to < box.y + box.height).toBe(true);

  const bar = await page.locator(PREVIEW_DRAG_BAR).boundingBox();
  const column = await columnBox(page);
  if (!bar) throw new Error("the drag bar did not render");
  expect(root.x <= bar.x && bar.x + bar.width <= column.left).toBe(true);
  expect(bar.y <= from && to <= bar.y + bar.height).toBe(true);
  const plus = await plusButton(page).boundingBox();
  expect((plus?.y ?? 0) <= to && to < (plus?.y ?? 0) + (plus?.height ?? 0)).toBe(true);
  expect(await page.evaluate(() => String(document.getSelection()))).toBe("");

  await page.mouse.up();
  await expect(composerLabel(page)).toHaveText(rowLabel(cited));
});

test("while its comment is drafted, a drag's rows keep the band and bar until the composer closes", async ({
  daemon,
  page,
}) => {
  const { prose, list } = await openRows(daemon, page);
  const [from] = await rowsOf(page, prose);
  const [to] = await rowsOf(page, list);
  if (from === undefined || to === undefined) throw new Error("the rows did not render");
  const x = await besideX(page);

  await page.mouse.move(x, from);
  await page.mouse.down();
  await page.mouse.move(x, to, { steps: 12 });
  await page.mouse.up();
  const composer = page.getByRole("dialog", { name: "Add a comment" });
  await expect(composer).toBeVisible();
  // Off the plan, so no hover band stands in for the drafted rows.
  await page.mouse.move(1, 1);

  const band = page.locator(PREVIEW_DRAG);
  await expect(band).toHaveCount(1);
  const root = await page.locator(PLAN_PREVIEW).boundingBox();
  const box = await band.boundingBox();
  if (!root || !box) throw new Error("the drafted rows' band did not render");
  expect(Math.abs(box.x - root.x)).toBeLessThan(0.5);
  expect(Math.abs(box.width - root.width)).toBeLessThan(0.5);
  expect(box.y <= from && to < box.y + box.height).toBe(true);
  const bar = await page.locator(PREVIEW_DRAG_BAR).boundingBox();
  if (!bar) throw new Error("the drafted rows' bar did not render");
  expect(bar.y <= from && to <= bar.y + bar.height).toBe(true);

  await composer.getByRole("button", { name: "Discard" }).click();
  await expect(composer).toHaveCount(0);
  await expect(band).toHaveCount(0);
  await expect(page.locator(PREVIEW_DRAG_BAR)).toHaveCount(0);
});

test("a row runs to the plan's right edge: its band spans the plan and a click there comments on it", async ({
  daemon,
  page,
}) => {
  const { prose } = await openRows(daemon, page);
  const y = await mixedRow(page, prose);
  const x = await besideX(page);

  await page.mouse.move(x, y);
  await expect.poll(() => bandHolds(page, y)).toBe(true);
  const [band, plan] = await Promise.all([
    page.locator(PREVIEW_HOVER).evaluate((el) => el.getBoundingClientRect().right),
    page.locator(PLAN_SURFACE).evaluate((el) => el.getBoundingClientRect().left + el.clientWidth),
  ]);
  expect(Math.abs(band - plan)).toBeLessThan(0.5);
  await page.mouse.click(x, y);

  await expect(composerLabel(page)).toHaveText(rowLabel(await linesOnRow(page, y)));
});

test("a Shift click selects text rather than commenting on its row", async ({ daemon, page }) => {
  const { prose } = await openRows(daemon, page);
  const y = await mixedRow(page, prose);

  const x = await textX(page);

  await page.keyboard.down("Shift");
  await page.mouse.click(x, y);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 120, y, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up("Shift");

  await expect.poll(() => page.evaluate(() => String(document.getSelection()).trim())).not.toBe("");
  await expect(page.getByRole("dialog", { name: "Add a comment" })).toHaveCount(0);
});

test("a row shows the pointer cursor, and the text cursor while Shift is held", async ({
  daemon,
  page,
}) => {
  const { prose } = await openRows(daemon, page);
  const y = await mixedRow(page, prose);
  const x = await textX(page);
  await page.mouse.move(x, y);
  const cursor = () =>
    page.evaluate(
      ({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        return el ? getComputedStyle(el).cursor : null;
      },
      { x, y },
    );

  const plain = await cursor();
  await page.keyboard.down("Shift");
  await expect.poll(cursor).toBe("text");
  await page.keyboard.up("Shift");

  expect(plain).toBe("pointer");
  await expect.poll(cursor).toBe("pointer");
});

test("a click opens the composer right under the row clicked, inside its paragraph, and the sent comment stays there", async ({
  daemon,
  page,
}) => {
  const { prose } = await openRows(daemon, page);
  const [first, second] = await rowsOf(page, prose);
  if (first === undefined || second === undefined) throw new Error("the paragraph did not wrap");
  // The row ends a few words into the second stored line it cites, which runs on below it.
  expect(await linesOnRow(page, first)).toHaveLength(2);

  await page.mouse.click(await textX(page), first);
  const composer = page.getByRole("dialog", { name: "Add a comment" });
  await expect(composer).toBeVisible();
  await page.mouse.move(1, 1);

  // Right under the band, once the slot is placed.
  const under = async () => {
    const [band, at] = await Promise.all([
      page.locator(PREVIEW_DRAG).boundingBox(),
      composer.boundingBox(),
    ]);
    const gap = band && at ? at.y - (band.y + band.height) : Number.NaN;
    return gap > -1 && gap < 24;
  };
  await expect.poll(under).toBe(true);
  const box = await composer.boundingBox();
  if (!box) throw new Error("the composer did not render");
  // The clicked row alone sits above it; the paragraph runs on under it.
  const rows = await rowsOf(page, prose);
  expect(rows.filter((y) => y < box.y)).toHaveLength(1);
  expect(rows.filter((y) => y > box.y + box.height).length).toBeGreaterThan(0);

  await composer.getByRole("textbox", { name: "Comment" }).fill("right here");
  await composer.getByRole("button", { name: "Comment" }).click();
  const card = page.locator("[data-annotation-card]");
  await expect(card).toBeVisible();
  await expect
    .poll(async () => Math.abs(((await card.boundingBox())?.y ?? 0) - box.y))
    .toBeLessThan(2);
});

test("a click's composer, discarded, leaves the text it cited unmarked", async ({
  daemon,
  page,
}) => {
  const { prose } = await openRows(daemon, page);
  const [first] = await rowsOf(page, prose);
  if (first === undefined) throw new Error("the paragraph did not render");
  const composer = page.getByRole("dialog", { name: "Add a comment" });

  await page.mouse.click(await textX(page), first);
  await composer.getByRole("button", { name: "Discard" }).click();
  await expect(composer).toHaveCount(0);
  await page.mouse.move(1, 1);
  await expect
    .poll(() =>
      page.evaluate(() => ({
        highlight: CSS.highlights.get("caret-comment-span")?.size ?? 0,
        selected: document.getSelection()?.toString() ?? "",
      })),
    )
    .toEqual({ highlight: 0, selected: "" });
});

test("a click on a list item opens the composer between it and the next", async ({
  daemon,
  page,
}) => {
  const { list } = await openRows(daemon, page);
  const [one, two] = await rowsOf(page, list);
  if (one === undefined || two === undefined) throw new Error("the list did not render");

  await page.mouse.click(await textX(page), one);
  const composer = page.getByRole("dialog", { name: "Add a comment" });
  await expect(composer).toBeVisible();

  const item = (text: string) =>
    page.locator(`${PLAN_PREVIEW} li`, { hasText: text }).boundingBox();
  const between = async () => {
    const [box, first, second] = await Promise.all([
      composer.boundingBox(),
      item("item one"),
      item("item two"),
    ]);
    if (!box || !first || !second) return false;
    return box.y >= first.y + first.height - 1 && second.y > box.y + box.height - 1;
  };
  await expect.poll(between).toBe(true);
});

test("beside a comment, either side, is the comment's rather than a row's", async ({
  daemon,
  page,
}) => {
  const { prose, list } = await openRows(daemon, page);
  await page.mouse.click(await textX(page), await mixedRow(page, prose));
  const composer = await page.getByRole("dialog", { name: "Add a comment" }).boundingBox();
  const root = await page.locator(PLAN_PREVIEW).boundingBox();
  if (!composer || !root) throw new Error("the composer did not open");
  // A row off the cursor's, whose own band the hover yields to.
  const [y] = await rowsOf(page, list);
  if (y === undefined) throw new Error("the list did not render");
  const hover = page.locator(PREVIEW_HOVER);

  for (const x of [await besideX(page), root.x + 8]) {
    await page.mouse.move(x, y);
    await expect(hover).toHaveCount(1);
    await page.mouse.move(x, composer.y + composer.height / 2);
    await expect(hover).toHaveCount(0);
  }
});

test("the + beside a hovered row opens the composer on what a click there cites", async ({
  daemon,
  page,
}) => {
  const { prose } = await openRows(daemon, page);
  const y = await mixedRow(page, prose);
  await page.mouse.move(await textX(page), y);

  const plus = plusButton(page);
  await expect(plus).toBeVisible();
  const box = await plus.boundingBox();
  expect((box?.y ?? 0) <= y && y < (box?.y ?? 0) + (box?.height ?? 0)).toBe(true);
  await plus.click();

  await expect(composerLabel(page)).toHaveText(rowLabel(await linesOnRow(page, y)));
});

test("each row holds the same words under page zoom and in a window narrower than the column", async ({
  daemon,
  page,
}) => {
  const { prose } = await openRows(daemon, page);
  const starts = () => rowStarts(page, prose);
  const width = async () => (await columnBox(page)).width;
  const base = await starts();
  const baseWidth = await width();
  expect(base.length).toBeGreaterThan(1);

  // CSS zoom on the root scales the page as the browser's zoom does.
  await page.evaluate(() => {
    document.documentElement.style.zoom = "1.25";
  });
  await expect.poll(width).toBeGreaterThan(baseWidth);
  expect(await starts()).toEqual(base);

  await page.evaluate(() => document.documentElement.style.removeProperty("zoom"));
  await page.setViewportSize({ width: 640, height: 900 });
  await expect
    .poll(() => page.locator(PLAN_SURFACE).evaluate((el) => el.clientWidth))
    .toBeLessThan(baseWidth);
  expect(await starts()).toEqual(base);
});

test("the column scales with its text, so each row holds its words at another root font size", async ({
  daemon,
  page,
}) => {
  const { prose } = await openRows(daemon, page);
  // A text-size preference changes the root font size alone. macOS's system font respaces
  // its glyphs by point size, which no CSS turns off, so a face whose advances scale
  // linearly isolates what the column's own units promise.
  await page.addStyleTag({ content: `${PLAN_PREVIEW} { font-family: Arial, sans-serif; }` });
  const starts = () => rowStarts(page, prose);
  const width = async () => (await columnBox(page)).width;
  const base = await starts();
  const baseWidth = await width();
  expect(base.length).toBeGreaterThan(1);

  await page.evaluate(() => {
    document.documentElement.style.fontSize = "20px";
  });

  await expect.poll(width).toBeGreaterThan(baseWidth);
  expect(await starts()).toEqual(base);
});

test("a window narrower than the column scrolls it sideways, and the band and + stay on their row", async ({
  daemon,
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 900 });
  const { prose } = await openRows(daemon, page);
  const scroller = page.locator(PLAN_SURFACE);
  const y = await mixedRow(page, prose);
  await page.mouse.move(300, y);
  await expect.poll(() => bandHolds(page, y)).toBe(true);

  await page.mouse.wheel(150, 0);

  await expect.poll(() => scroller.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  await expect.poll(() => bandHolds(page, y)).toBe(true);
  const plus = plusButton(page);
  await expect(plus).toBeInViewport();
  const [plusBox, plan] = [await plus.boundingBox(), await scroller.boundingBox()];
  expect((plusBox?.x ?? -1) >= (plan?.x ?? 0)).toBe(true);
  expect((plusBox?.y ?? 0) <= y && y < (plusBox?.y ?? 0) + (plusBox?.height ?? 0)).toBe(true);
});

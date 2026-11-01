// A fenced code block's frame: a bezel of the window's body round a pane sunk into it, in
// both plan views. Every block is carded (codeBlockScroll.ts), and the card draws the frame
// with its own border, backgrounds and inset shadows (coreStyles.ts). What needs a browser
// is resolved layout and paint: that the bezel shows evenly on all four sides and holds a
// wide block's scrollbar inside the pane rather than over the line below; that the bezel and
// the pane's edges stay put while the code scrolls under them; that the card's border, which
// lands in the subgrid's first row track, leaves every line number on its line and the hover
// "+" centred on it; that the copy and wrap tray steps inside the pane; and that re-carding
// after a composer opens moves nothing. The declarations themselves are pinned in
// ui/src/lib/diffview/coreStyles.test.ts.
//
// Playwright's headless Chromium hides scrollbars by default, so a scrollbar would take no
// room here and its lane could never be measured. This spec runs with them shown.

import type { Locator, Page } from "@playwright/test";

import { previewToggle } from "@test/e2e/support/chrome.ts";
import { type Daemon, expect, test } from "@test/e2e/support/fixtures.ts";
import {
  lineOf,
  openPlan,
  PLAN_PREVIEW,
  probeColor,
  revealGutterPlus,
} from "@test/e2e/support/source-view.ts";

test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

// A block that fits, one far wider than the reading width, and a three-line one. The tail
// is scroll room for the composer spec.
const BEZEL_PLAN = `# Bezel plan

Prose above the blocks.

\`\`\`ts
export function drain(queue: Queue): number {
  return queue.size;
}
\`\`\`

Prose between the first and second blocks.

\`\`\`text
caret-tasks replay --from parked/2026-10-30T14:02:11Z --decoder v2 ${"--verify-checksums ".repeat(8)}
caret-tasks relay open
\`\`\`

Prose between the second and third blocks.

\`\`\`toml
green_streak = 2
\`\`\`

${Array.from({ length: 60 }, (_, i) => `- tail item ${i + 1}`).join("\n")}
`;

const BLOCKS = 3;

function cardCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (document.querySelector(".diffview") as HTMLElement)?.shadowRoot?.querySelectorAll(
        "[data-content] > [data-code-card]",
      ).length ?? -1,
  );
}

async function openBezelPlan(page: Page, daemon: Daemon): Promise<void> {
  await openPlan(page, daemon, BEZEL_PLAN);
  await expect.poll(() => cardCount(page)).toBe(BLOCKS);
}

/** Each card's box, border widths, fills and scroll metrics, the summed heights of the rows
 * it holds, and the top of whatever follows it in the content column. */
function cardBoxes(page: Page) {
  return page.evaluate(() => {
    const sh = (document.querySelector(".diffview") as HTMLElement).shadowRoot as ShadowRoot;
    return [...sh.querySelectorAll<HTMLElement>("[data-content] > [data-code-card]")].map(
      (card) => {
        const s = getComputedStyle(card);
        const r = card.getBoundingClientRect();
        return {
          start: Number(card.getAttribute("data-code-card")),
          top: r.top,
          right: r.right,
          bottom: r.bottom,
          left: r.left,
          height: r.height,
          borders: [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth],
          fill: s.backgroundColor,
          image: s.backgroundImage,
          scrollWidth: card.scrollWidth,
          clientWidth: card.clientWidth,
          clientHeight: card.clientHeight,
          offsetHeight: card.offsetHeight,
          rows: [...card.children].reduce(
            (sum, row) => sum + row.getBoundingClientRect().height,
            0,
          ),
          nextTop: (card.nextElementSibling as HTMLElement).getBoundingClientRect().top,
        };
      },
    );
  });
}

/** The pointer off the plan and no row banded, so a screenshot shows the frame at rest. */
async function restPointer(page: Page): Promise<void> {
  await page.mouse.move(0, 0);
  await expect(page.locator(".diffview [data-hovered]")).toHaveCount(0);
}

/** The chrome box belonging to the block opening at `start`. */
const chromeFor = (page: Page, start: number): Locator =>
  page
    .locator(".code-chrome")
    .filter({ has: page.getByRole("button", { name: `Copy code from line ${start}` }) });

test("every block sits in an even bezel round its pane, a wide one's scrollbar inside it", async ({
  page,
  daemon,
}) => {
  await openBezelPlan(page, daemon);
  const [body, floor] = await Promise.all([
    probeColor(page, "--body"),
    probeColor(page, "--table-floor"),
  ]);
  const cards = await cardBoxes(page);
  const bezel = Number.parseFloat(cards[0]?.borders[0] ?? "");
  expect(bezel).toBeGreaterThan(0);

  for (const card of cards) {
    const label = `block at line ${card.start}`;
    expect(card.borders, label).toEqual(Array(4).fill(`${bezel}px`));
    // The body shows through the border, round the floor clipped to the pane.
    expect(card.fill, label).toBe(body);
    expect(card.image, label).toContain(floor);
    // Whatever sits below the block starts at or below its bezel: nothing hangs over it.
    expect(card.nextTop, label).toBeGreaterThanOrEqual(card.bottom - 0.5);
  }

  const [fits, wide, short] = cards as [(typeof cards)[0], (typeof cards)[0], (typeof cards)[0]];
  expect(fits.scrollWidth).toBe(fits.clientWidth);
  expect(wide.scrollWidth).toBeGreaterThan(wide.clientWidth);
  // A block grows by its bezel alone, and a fitting one has no scrollbar lane.
  for (const card of [fits, short]) {
    expect(card.offsetHeight - card.clientHeight, `block at line ${card.start}`).toBeCloseTo(
      2 * bezel,
      0,
    );
    expect(card.height - card.rows, `block at line ${card.start}`).toBeCloseTo(2 * bezel, 0);
  }
  // A wide block's scrollbar takes a lane of its own inside the bezel, below its rows.
  const lane = wide.offsetHeight - wide.clientHeight - 2 * bezel;
  expect(lane).toBeGreaterThan(0);
  expect(wide.height - wide.rows).toBeCloseTo(2 * bezel + lane, 0);
});

test("a wide block's bezel and pane edges stay put while its code scrolls", async ({
  page,
  daemon,
}) => {
  await openBezelPlan(page, daemon);
  const card = page.locator(".diffview [data-content] > [data-code-card]").nth(1);
  await card.scrollIntoViewIfNeeded();
  await restPointer(page);
  const box = (await cardBoxes(page))[1] as Awaited<ReturnType<typeof cardBoxes>>[0];
  const bezel = Number.parseFloat(box.borders[0] ?? "");
  // Whole pixels clear of the rounded corners: the bezel down each side, and the bezel with
  // the pane's 1px edge along the top and the bottom. The side edges are left out, because a
  // glyph scrolled to the scrollport's edge antialiases over them.
  const inner = { left: Math.ceil(box.left), right: Math.floor(box.right) };
  const span = { top: Math.ceil(box.top) + 12, bottom: Math.floor(box.bottom) - 12 };
  const strips = () =>
    Promise.all([
      page.screenshot({
        clip: {
          x: inner.left,
          y: span.top,
          width: Math.floor(box.left + bezel) - inner.left,
          height: span.bottom - span.top,
        },
      }),
      page.screenshot({
        clip: {
          x: Math.ceil(box.right - bezel),
          y: span.top,
          width: inner.right - Math.ceil(box.right - bezel),
          height: span.bottom - span.top,
        },
      }),
      page.screenshot({
        clip: {
          x: inner.left + 12,
          y: Math.ceil(box.top),
          width: inner.right - inner.left - 24,
          height: bezel + 1,
        },
      }),
      page.screenshot({
        clip: {
          x: inner.left + 12,
          y: Math.floor(box.bottom) - bezel - 1,
          width: inner.right - inner.left - 24,
          height: bezel + 1,
        },
      }),
    ]);
  const firstGlyphX = () =>
    card.evaluate((el) => {
      const row = el.querySelector("[data-line]:nth-child(2) span") as HTMLElement;
      return row.getBoundingClientRect().left;
    });
  const atRest = await strips();
  const glyphAtRest = await firstGlyphX();

  await card.hover();
  await page.mouse.wheel(240, 0);
  await expect.poll(() => card.evaluate((el) => el.scrollLeft)).toBeGreaterThan(100);
  let previous = -1;
  await expect
    .poll(async () => {
      const now = await card.evaluate((el) => el.scrollLeft);
      const settled = now === previous;
      previous = now;
      return settled;
    })
    .toBe(true);
  await restPointer(page);

  // The code moved under the frame, and the frame did not move with it.
  expect(await firstGlyphX()).toBeLessThan(glyphAtRest - 100);
  const scrolled = await strips();
  for (const [i, side] of ["start", "end", "top", "bottom"].entries()) {
    expect(scrolled[i]?.equals(atRest[i] as Buffer), side).toBe(true);
  }
});

test("a line's gutter cell spans its row and no more, so a band is one height across both", async ({
  page,
  daemon,
}) => {
  // The bezel above a block's first line and below its last, and a wide block's scrollbar
  // lane, sit in those lines' row tracks. The gutter cells there clear them, or a hover,
  // cursor or selection band runs past its row into the frame on the gutter side.
  await openBezelPlan(page, daemon);
  const spans = await page.evaluate(() => {
    const sh = (document.querySelector(".diffview") as HTMLElement).shadowRoot as ShadowRoot;
    return [
      ...sh.querySelectorAll<HTMLElement>("[data-content] > [data-code-card] > [data-line]"),
    ].map((row) => {
      const line = row.getAttribute("data-line");
      const cell = sh.querySelector(`[data-gutter] [data-column-number="${line}"]`) as HTMLElement;
      const r = row.getBoundingClientRect();
      const c = cell.getBoundingClientRect();
      return { line, top: c.top - r.top, bottom: c.bottom - r.bottom };
    });
  });
  expect(spans.length).toBeGreaterThan(BLOCKS * 3);
  for (const { line, top, bottom } of spans) {
    expect(Math.abs(top), `line ${line} top`).toBeLessThanOrEqual(1);
    expect(Math.abs(bottom), `line ${line} bottom`).toBeLessThanOrEqual(1);
  }
});

test("every line number stays on its line, and the + stays centred on it", async ({
  page,
  daemon,
}) => {
  await openBezelPlan(page, daemon);
  const offsets = await page.evaluate(() => {
    const sh = (document.querySelector(".diffview") as HTMLElement).shadowRoot as ShadowRoot;
    return [
      ...sh.querySelectorAll<HTMLElement>("[data-content] > [data-code-card] > [data-line]"),
    ].map((row) => {
      const line = row.getAttribute("data-line");
      const number = sh.querySelector(
        `[data-gutter] [data-column-number="${line}"] [data-line-number-content]`,
      ) as HTMLElement;
      const textTop =
        row.getBoundingClientRect().top + Number.parseFloat(getComputedStyle(row).paddingTop);
      return { line, off: number.getBoundingClientRect().top - textTop };
    });
  });
  expect(offsets.length).toBeGreaterThan(BLOCKS * 3);
  for (const { line, off } of offsets) expect(Math.abs(off), `line ${line}`).toBeLessThanOrEqual(1);

  // The first line of each block is the one the bezel pushes down; an interior line is not.
  const starts = (await cardBoxes(page)).map((c) => c.start);
  for (const line of [...starts, (starts[0] ?? 0) + 1]) {
    await revealGutterPlus(page, line);
    const off = await page.evaluate((n) => {
      const sh = (document.querySelector(".diffview") as HTMLElement).shadowRoot as ShadowRoot;
      const mid = (el: Element) => {
        const r = el.getBoundingClientRect();
        return r.top + r.height / 2;
      };
      const cell = sh.querySelector(`[data-gutter] [data-column-number="${n}"]`) as HTMLElement;
      return (
        mid(sh.querySelector("[data-utility-button]") as Element) -
        mid(cell.querySelector("[data-line-number-content]") as Element)
      );
    }, line);
    expect(Math.abs(off), `line ${line}`).toBeLessThanOrEqual(1);
  }
});

test("the copy and wrap tray sits inside the pane, over the end of the first line", async ({
  page,
  daemon,
}) => {
  await openBezelPlan(page, daemon);
  // The tray floats 0.4rem in from the pane's corner, which is the bezel's width in from
  // the card's.
  const inset = await page.evaluate(
    () => Number.parseFloat(getComputedStyle(document.documentElement).fontSize) * 0.4,
  );
  const cards = await cardBoxes(page);
  for (const card of cards) {
    const bezel = Number.parseFloat(card.borders[0] ?? "");
    const tray = await chromeFor(page, card.start).boundingBox();
    expect(tray, `block at line ${card.start}`).not.toBeNull();
    expect(tray?.x ?? 0).toBeGreaterThan(card.left + bezel);
    expect((tray?.x ?? 0) + (tray?.width ?? 0)).toBeCloseTo(card.right - bezel - inset, 0);
    expect(tray?.y ?? 0).toBeCloseTo(card.top + bezel + inset, 0);
  }
});

test("the preview frames each block in the same bezel, its tray inside the pane", async ({
  page,
  daemon,
}) => {
  await openBezelPlan(page, daemon);
  await previewToggle(page).click();
  const pres = page.locator(`${PLAN_PREVIEW} [data-source-code] + pre`);
  await expect(pres).toHaveCount(BLOCKS);
  const body = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.backgroundColor = "var(--body)";
    document.body.append(probe);
    const resolved = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return resolved;
  });
  const boxes = await pres.evaluateAll((els) =>
    els.map((pre) => {
      const s = getComputedStyle(pre);
      const r = pre.getBoundingClientRect();
      return {
        // The marker carries the first code line; the block opens on the fence above it.
        start: Number(pre.previousElementSibling?.getAttribute("data-source-line")) - 1,
        top: r.top,
        right: r.right,
        borders: [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth],
        fill: s.backgroundColor,
        endPadding: s.paddingInlineEnd,
        rem: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
      };
    }),
  );
  for (const pre of boxes) {
    const label = `block at line ${pre.start}`;
    const bezel = Number.parseFloat(pre.borders[0] ?? "");
    expect(bezel, label).toBeGreaterThan(0);
    expect(pre.borders, label).toEqual(Array(4).fill(`${bezel}px`));
    expect(pre.fill, label).toBe(body);
    // The tray's lane at the end of the first line stays clear of code.
    expect(Number.parseFloat(pre.endPadding), label).toBeCloseTo(4.5 * pre.rem, 0);
    const tray = await chromeFor(page, pre.start).boundingBox();
    expect(tray, label).not.toBeNull();
    expect((tray?.x ?? 0) + (tray?.width ?? 0), label).toBeCloseTo(
      pre.right - bezel - 0.4 * pre.rem,
      0,
    );
    expect(tray?.y ?? 0, label).toBeCloseTo(pre.top + bezel + 0.4 * pre.rem, 0);
  }
});

test("opening a composer below the code blocks leaves its line where it was", async ({
  page,
  daemon,
}) => {
  // The composer's repaint flattens every card for a frame before the pass re-cards it, so
  // the flat frame has to hold the carded height, and no scroll anchor may be taken in it.
  await openBezelPlan(page, daemon);
  const line = await lineOf(page, "- tail item 40");
  const rowTop = () =>
    page.evaluate((ln) => {
      const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
      const row = sh?.querySelector(`[data-content] [data-line="${ln}"]`);
      return Math.round(row?.getBoundingClientRect().top ?? Number.NaN);
    }, line);
  await page.evaluate((ln) => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    sh?.querySelector(`[data-content] [data-line="${ln}"]`)?.scrollIntoView({ block: "center" });
  }, line);
  const plus = await revealGutterPlus(page, line);
  const before = await rowTop();

  await plus.click();
  await expect(page.getByRole("dialog", { name: "Add a comment" })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
        if (sh?.querySelector("[data-content] [data-line-annotation]") == null) return -1;
        return sh.querySelectorAll("[data-content] > [data-code-card]").length;
      }),
    )
    .toBe(BLOCKS);
  // A later repaint can flatten the cards again for a frame; a lasting shift still fails.
  await expect.poll(rowTop).toBe(before);
});

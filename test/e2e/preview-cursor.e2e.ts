// The keyboard cursor on the plan preview. It steps visual lines — each wrapped line on
// screen — so everything here is layout: line boxes that only exist at a real width, the
// follow scroll, the band's glide from row to row and the hover's off its row, and the
// band staying on its text across a resize, a comment card growing above it and a theme
// switch that rewraps it. happy-dom has no layout, so the pure half
// stays units: the motion resolution over fake rects in ui/src/lib/previewLines.test.ts and
// ui/src/state/previewCursor.test.ts, the registry wiring and band mount in
// ui/src/components/DiffPlanView.test.ts ("DiffPlanView preview cursor"), and the surface
// pin in ui/src/lib/planView.test.ts.
//
// The daemon reflows the plan on ingest, so text is located by content and line counts
// are read from the DOM.

import type { Page } from "@playwright/test";

import { previewToggle } from "@test/e2e/support/chrome.ts";
import {
  expectCursorLine,
  goToTop,
  PREVIEW_BAND,
  previewCursor,
} from "@test/e2e/support/cursor.ts";
import { expect, test } from "@test/e2e/support/fixtures.ts";
import {
  awaitPlanReadyForKeys,
  glideCounter,
  lineOf,
  openPlanForKeys,
  PLAN_PREVIEW,
  PLAN_SURFACE,
  PREVIEW_DRAG,
  PREVIEW_HOVER,
} from "@test/e2e/support/source-view.ts";
import { caretThemeVariant, selectThemeFile } from "@test/e2e/support/themes.ts";

// No phrase repeats, so text recorded under the band identifies one place.
const LONG = [
  "Marmalade reviewers read the plan from top to bottom and stop wherever a step looks wrong,",
  "so the preview has to keep every paragraph readable at any width while the cursor walks",
  "each wrapped line in turn without skipping text or landing between words. A migration",
  "touches the schema first, then backfills old rows in small batches, and only after that",
  "flips the reader over to the new column. Rollback drops the flag, keeps the column, and",
  "leaves cleanup for a later release once dashboards confirm nothing still queries it.",
  "Owners sign off on each stage in the channel, and the runbook lists who to page when a",
  "batch stalls overnight or the replica lag climbs past its alert threshold again.",
].join(" ");

const PLAN = [
  "# Overview",
  "A short opening paragraph.",
  LONG,
  "## Details",
  "Closing paragraph quokka.",
  "",
].join("\n\n");

const CODE = ["alpha = 1", "", "beta = 2", "gamma = 3"];

// Each table row pairs a short cell with one that wraps at a narrow width, so a
// middle-aligned short cell sits between the long cell's lines.
const SHAPES = [
  "# Shapes",
  "Tablestart paragraph.",
  [
    "| Step | Note |",
    "| --- | --- |",
    "| one | Backfill the orders table in batches of five hundred rows while the old reader keeps serving traffic |",
    "| two | Flip reads to the new column behind a flag that rollback can drop without touching stored data at all |",
  ].join("\n"),
  "Liststart paragraph.",
  [
    "- kiwi",
    "- A list item long enough to wrap across several visual lines at a narrow preview width here",
    "- fig",
  ].join("\n"),
  "Fencestart paragraph.",
  ["```text", ...CODE, "```"].join("\n"),
  "Fenceend paragraph.",
  "",
].join("\n\n");

const press = async (page: Page, ...keys: string[]) => {
  for (const key of keys) await page.keyboard.press(key);
};

/** The band's top in `.diff-plan` content coordinates, which the follow scroll leaves still. */
const bandTop = (page: Page): Promise<number> =>
  previewCursor(page).evaluate((el) => (el as HTMLElement).offsetTop);

const bandLine = async (page: Page): Promise<number> =>
  Number(await previewCursor(page).getAttribute("data-line"));

/** The visual-line count of the preview `tag` element holding `word`. */
const textRows = (page: Page, tag: string, word: string) =>
  page.evaluate(
    ([root, t, w]) => {
      const holder = [...document.querySelectorAll(`${root} ${t}`)].find((el) =>
        el.textContent?.includes(w),
      );
      if (!holder) return -1;
      const range = document.createRange();
      range.selectNodeContents(holder);
      return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
    },
    [PLAN_PREVIEW, tag, word] as const,
  );

/** The preview's characters in text order with their vertical midpoints, and the band's
 * span, read in one frame so a follow scroll moves both alike. */
type Snapshot = { chars: { ch: string; mid: number }[]; band: { top: number; bottom: number } };

const snapshot = (page: Page): Promise<Snapshot> =>
  page.evaluate(
    ([root, bandSelector]) => {
      const chars: Snapshot["chars"] = [];
      const walker = document.createTreeWalker(document.querySelector(root)!, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = n.textContent ?? "";
        for (let i = 0; i < text.length; i++) {
          range.setStart(n, i);
          range.setEnd(n, i + 1);
          const r = range.getClientRects()[0];
          if (r && r.width > 0) chars.push({ ch: text[i]!, mid: r.top + r.height / 2 });
        }
      }
      const { top, bottom } = document.querySelector(bandSelector)!.getBoundingClientRect();
      return { chars, band: { top, bottom } };
    },
    [PLAN_PREVIEW, PREVIEW_BAND] as const,
  );

const underBand = ({ band }: Snapshot, mid: number) => mid > band.top && mid < band.bottom;

/** Whether the band's vertical span holds `text`'s first character. Whitespace is ignored:
 * the space a line wraps at lays out zero-wide, so the snapshot never holds it. */
const covers = (s: Snapshot, text: string) => {
  const chars = s.chars.filter((c) => c.ch.trim());
  const at = chars
    .map((c) => c.ch)
    .join("")
    .indexOf(text.replace(/\s/g, ""));
  return at >= 0 && underBand(s, chars[at]!.mid);
};

const bandCovers = async (page: Page, text: string) => covers(await snapshot(page), text);

/** The first dozen characters laid out under the band. */
const bandText = async (page: Page) => {
  const s = await snapshot(page);
  return s.chars
    .filter((c) => underBand(s, c.mid))
    .map((c) => c.ch)
    .join("")
    .slice(0, 12);
};

/** The visual lines a reader sees in the preview's `table` (each row as tall as its tallest
 * cell) or `ul` (each item's lines). */
const blockLines = (page: Page, block: "table" | "ul") =>
  page.evaluate(
    ([root, kind]) => {
      const lines = (el: Element) => {
        const tops = new Set<number>();
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        const range = document.createRange();
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          range.selectNodeContents(n);
          for (const r of range.getClientRects()) if (r.width > 0) tops.add(Math.round(r.top));
        }
        return tops.size;
      };
      const el = document.querySelector(`${root} ${kind}`)!;
      return kind === "table"
        ? [...el.querySelectorAll("tr")].reduce(
            (n, tr) => n + Math.max(...[...tr.cells].map(lines)),
            0,
          )
        : [...el.querySelectorAll("li")].reduce((n, li) => n + lines(li), 0);
    },
    [PLAN_PREVIEW, block] as const,
  );

/** Sets the preview column's width, which no window width changes, so the text wraps at
 * another measure. */
const setColumnWidth = (page: Page, width: number) =>
  page.locator(PLAN_PREVIEW).evaluate((el, w) => {
    (el as HTMLElement).style.setProperty("--column", `${w}px`);
  }, width);

async function openPreview(page: Page, daemon: Parameters<typeof openPlanForKeys>[1]) {
  await openPlanForKeys(page, daemon, PLAN);
  await previewToggle(page).click();
  await expect(page.locator(PLAN_PREVIEW)).toBeVisible();
}

/** gg then j onto the long paragraph's first visual line. */
async function toLongParagraph(page: Page): Promise<void> {
  await press(page, "g", "g");
  await expect.poll(() => bandCovers(page, "Overview")).toBe(true);
  await press(page, "j");
  await expect.poll(() => bandCovers(page, "A short")).toBe(true);
  await press(page, "j");
  await expect.poll(() => bandCovers(page, "Marmalade")).toBe(true);
}

/** Press `key` and wait for the band's top to move off `from`. */
async function stepFrom(page: Page, key: string, from: number): Promise<number> {
  await press(page, key);
  await expect.poll(() => bandTop(page)).not.toBe(from);
  return bandTop(page);
}

/** Presses j until the band covers `text`, asserting each press moves it down; returns a
 * snapshot per press. */
async function walkTo(page: Page, text: string): Promise<Snapshot[]> {
  let top = await bandTop(page);
  const steps: Snapshot[] = [];
  while (!(await bandCovers(page, text))) {
    const next = await stepFrom(page, "j", top);
    expect(next).toBeGreaterThan(top);
    top = next;
    steps.push(await snapshot(page));
    if (steps.length > 80) throw new Error(`j never reached ${text}`);
  }
  return steps;
}

/** Walks the long paragraph with j, returning how many presses reach the next block. */
const walkLong = async (page: Page) => (await walkTo(page, "Details")).length;

test.describe("preview cursor motion", () => {
  test("j and k glide the band a row, a heading's included, and a jump lands it", async ({
    page,
    daemon,
  }) => {
    await openPreview(page, daemon);
    await press(page, "g", "g");
    await expect.poll(() => bandCovers(page, "Overview")).toBe(true);

    const glides = await glideCounter(page, PREVIEW_BAND);
    await press(page, "j");
    await expect.poll(() => bandCovers(page, "A short")).toBe(true);
    await press(page, "k");
    await expect.poll(() => bandCovers(page, "Overview")).toBe(true);
    expect(await glides()).toBe(2);

    await press(page, "G");
    await expect.poll(() => bandCovers(page, "quokka")).toBe(true);
    expect(await glides()).toBe(2);
  });

  test("in visual mode, k glides the selection's band up a row", async ({ page, daemon }) => {
    await openPreview(page, daemon);
    await press(page, "g", "g", "j");
    await expect.poll(() => bandCovers(page, "A short")).toBe(true);
    await press(page, "V");
    await expect(page.locator(PREVIEW_DRAG)).toHaveCount(1);

    const glides = await glideCounter(page, PREVIEW_DRAG);
    await press(page, "k");
    await expect.poll(() => bandCovers(page, "Overview")).toBe(true);
    await expect.poll(glides).toBe(1);
  });

  test("the hover band glides off the cursor's row onto the next", async ({ page, daemon }) => {
    await openPreview(page, daemon);
    await press(page, "g", "g");
    await expect.poll(() => bandCovers(page, "Overview")).toBe(true);
    const cursorRow = await previewCursor(page).boundingBox();
    const next = await page.locator(`${PLAN_PREVIEW} p`).first().boundingBox();
    if (!cursorRow || !next) throw new Error("the preview did not render");
    const x = next.x + 100;
    await page.mouse.move(x, cursorRow.y + cursorRow.height / 2);

    const glides = await glideCounter(page, PREVIEW_HOVER);
    await page.mouse.move(x, next.y + next.height / 2);
    await expect.poll(glides).toBe(1);
  });
});

test.describe("preview keyboard cursor", () => {
  // Each step reads where the band comes to rest, so it lands rather than glides.
  test.use({ reducedMotion: "reduce" });

  test("j/k step one visual line, and the unit follows the width", async ({ page, daemon }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await openPreview(page, daemon);

    const counts: number[] = [];
    for (const width of [800, 420]) {
      await setColumnWidth(page, width);
      await toLongParagraph(page);
      await expect.poll(() => textRows(page, "p", "Marmalade")).toBeGreaterThan(0);
      const rows = await textRows(page, "p", "Marmalade");
      expect(await walkLong(page)).toBe(rows);
      counts.push(rows);

      let top = await bandTop(page);
      for (let i = 0; i < rows; i++) {
        const next = await stepFrom(page, "k", top);
        expect(next).toBeLessThan(top);
        top = next;
      }
      await expect.poll(() => bandCovers(page, "Marmalade")).toBe(true);
    }
    expect(counts[1]).toBeGreaterThan(counts[0]!);
  });

  test("every motion works on the preview", async ({ page, daemon }) => {
    await page.setViewportSize({ width: 420, height: 500 });
    await openPreview(page, daemon);
    await setColumnWidth(page, 420);

    await press(page, "g", "g");
    await expect.poll(() => bandCovers(page, "Overview")).toBe(true);

    await press(page, "G");
    await expect.poll(() => bandCovers(page, "quokka")).toBe(true);

    await press(page, "g", "g");
    await expect.poll(() => bandCovers(page, "Overview")).toBe(true);
    await press(page, "]", "]");
    await expect.poll(() => bandCovers(page, "Details")).toBe(true);
    // Parked at the top, or as near as the scroll range allows on a short plan.
    await expect
      .poll(() =>
        page.evaluate(
          ([root, surface]) => {
            const view = document.querySelector(surface)!;
            const h = [...document.querySelectorAll(`${root} h2`)].find((el) =>
              el.textContent?.includes("Details"),
            )!;
            const atMax = view.scrollTop >= view.scrollHeight - view.clientHeight - 1;
            const rel =
              (h.getBoundingClientRect().top - view.getBoundingClientRect().top) /
              view.clientHeight;
            return view.scrollTop > 0 && (atMax || rel < 0.25);
          },
          [PLAN_PREVIEW, PLAN_SURFACE] as const,
        ),
      )
      .toBe(true);
    await press(page, "[", "[");
    await expect.poll(() => bandCovers(page, "Overview")).toBe(true);

    await press(page, "j", "}");
    await expect.poll(() => bandCovers(page, "Marmalade")).toBe(true);
    await press(page, "{");
    await expect.poll(() => bandCovers(page, "A short")).toBe(true);

    await press(page, "j");
    await expect.poll(() => bandCovers(page, "Marmalade")).toBe(true);
    const start = await bandTop(page);
    await press(page, "Control+d");
    await expect.poll(() => bandTop(page)).not.toBe(start);
    // The band has already moved, so this cannot pass on a stale frame.
    await expect.poll(() => bandCovers(page, "Marmalade")).toBe(false);
    await press(page, "Control+u");
    await expect.poll(() => bandCovers(page, "Marmalade")).toBe(true);
  });

  test("the view follows the cursor", async ({ page, daemon }) => {
    await page.setViewportSize({ width: 420, height: 500 });
    await openPreview(page, daemon);
    await setColumnWidth(page, 420);
    await press(page, "g", "g");
    await expect.poll(() => bandCovers(page, "Overview")).toBe(true);

    const inView = () =>
      page.evaluate(
        ([surface, bandSelector]) => {
          const band = document.querySelector(bandSelector)!.getBoundingClientRect();
          const view = document.querySelector(surface)!.getBoundingClientRect();
          return band.top >= view.top && band.bottom <= view.bottom;
        },
        [PLAN_SURFACE, PREVIEW_BAND] as const,
      );

    let presses = 0;
    while (!(await bandCovers(page, "quokka"))) {
      await press(page, "j");
      await expect.poll(inView).toBe(true);
      if (++presses > 80) throw new Error("j never reached the end");
    }
    await expect
      .poll(() => page.locator(PLAN_SURFACE).evaluate((el) => el.scrollTop))
      .toBeGreaterThan(0);
  });

  test("j visits each table row, list line and code line once", async ({ page, daemon }) => {
    await page.setViewportSize({ width: 420, height: 900 });
    await openPlanForKeys(page, daemon, SHAPES);
    await previewToggle(page).click();
    await expect(page.locator(PLAN_PREVIEW)).toBeVisible();
    await setColumnWidth(page, 420);
    await press(page, "g", "g");
    await walkTo(page, "Tablestart");

    const table = await walkTo(page, "Liststart");
    expect(table.length).toBe((await blockLines(page, "table")) + 1);

    const list = await walkTo(page, "Fencestart");
    expect(list.length).toBe((await blockLines(page, "ul")) + 1);

    const fence = await walkTo(page, "Fenceend");
    for (const line of CODE) {
      if (line)
        expect(
          fence.some((s) => covers(s, line)),
          line,
        ).toBe(true);
    }
  });

  test("the cursor keeps its text across a resize and a comment card growing above it", async ({
    page,
    daemon,
  }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    const id = await daemon.seed({ plan: PLAN });
    const lines = ((await daemon.getReview(id)).body?.currentPlan ?? "").split("\n");
    const shortLine = lines.findIndex((l) => l.startsWith("A short")) + 1;
    await daemon.putDraft(id, {
      composerScratches: [{ startLine: shortLine, endLine: shortLine, text: "an unsent note" }],
    });
    await page.goto("/");
    await awaitPlanReadyForKeys(page);
    await previewToggle(page).click();
    await expect(page.locator(PLAN_PREVIEW)).toBeVisible();

    await toLongParagraph(page);
    let top = await stepFrom(page, "j", await bandTop(page));
    top = await stepFrom(page, "j", top);
    const recorded = await bandText(page);

    await setColumnWidth(page, 420);
    await expect.poll(() => bandCovers(page, recorded)).toBe(true);

    const before = await bandTop(page);
    await page.getByRole("button", { name: "Resume unsent comment" }).click();
    await expect(page.getByRole("dialog", { name: "Add a comment" })).toBeVisible();
    await expect.poll(() => bandTop(page)).toBeGreaterThan(before);
    await expect.poll(() => bandCovers(page, recorded)).toBe(true);
  });

  test("the cursor keeps its text when a theme switch rewraps its heading", async ({
    page,
    daemon,
  }) => {
    // Only the heading's weight and slant differ, and only the light theme's widen it.
    await selectThemeFile(
      page,
      daemon,
      caretThemeVariant("thin", "dark", {
        accent: "#ff0000",
        markdown: { heading1: { color: "#ff80bf" } },
      }),
    );
    await selectThemeFile(
      page,
      daemon,
      caretThemeVariant("heavy", "light", {
        accent: "#ff0000",
        markdown: { heading1: { color: "#ff80bf", fontStyle: ["bold", "italic"] } },
      }),
    );
    await page.emulateMedia({ colorScheme: "dark" });
    await page.setViewportSize({ width: 420, height: 900 });
    await openPlanForKeys(page, daemon, `# ${LONG}\n\nClosing paragraph quokka.\n`);
    await previewToggle(page).click();
    await expect(page.locator(PLAN_PREVIEW)).toBeVisible();
    await setColumnWidth(page, 420);

    await press(page, "g", "g");
    await expect.poll(() => bandCovers(page, "Marmalade")).toBe(true);
    let top = await stepFrom(page, "j", await bandTop(page));
    top = await stepFrom(page, "j", top);
    await stepFrom(page, "j", top);
    const recorded = await bandText(page);
    const rows = await textRows(page, "h1", "Marmalade");

    await page.emulateMedia({ colorScheme: "light" });
    await expect.poll(() => textRows(page, "h1", "Marmalade")).not.toBe(rows);
    await expect.poll(() => bandCovers(page, recorded)).toBe(true);
  });

  test("preview to source carries the cursor line", async ({ page, daemon }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await openPreview(page, daemon);
    await toLongParagraph(page);
    await stepFrom(page, "j", await bandTop(page));
    const line = await bandLine(page);

    await previewToggle(page).click();
    await expectCursorLine(page, line);
  });

  test("source to preview carries the cursor line", async ({ page, daemon }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await openPlanForKeys(page, daemon, PLAN);
    const closing = await lineOf(page, "Closing paragraph quokka.");
    await goToTop(page);
    for (let i = 1; i < closing; i++) await press(page, "j");
    await expectCursorLine(page, closing);

    await previewToggle(page).click();
    await expect(previewCursor(page)).toHaveAttribute("data-line", String(closing));
    await expect.poll(() => bandCovers(page, "Closing")).toBe(true);
  });
});

// The keyboard cursor on the plan preview. It steps visual lines — each wrapped line on
// screen — so everything here is layout: line boxes that only exist at a real width, the
// follow scroll, and the band staying on its text across a resize, a theme switch and a
// reflow. happy-dom has no layout, so the pure half — the motion resolution over fake
// rects — lives in ui/src/lib/previewLines.test.ts and ui/src/state/previewCursor.test.ts.
//
// The daemon reflows the plan on ingest, so text is located by content and line counts
// are read from the DOM.

import type { Page } from "@playwright/test";

import { previewToggle } from "@test/e2e/support/chrome.ts";
import { expectCursorLine, goToTop, previewCursor } from "@test/e2e/support/cursor.ts";
import { expect, test } from "@test/e2e/support/fixtures.ts";
import {
  lineOf,
  openPlanForKeys,
  PLAN_PREVIEW,
  PLAN_SURFACE,
} from "@test/e2e/support/source-view.ts";

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

const press = async (page: Page, ...keys: string[]) => {
  for (const key of keys) await page.keyboard.press(key);
};

const bandTop = async (page: Page): Promise<number> =>
  (await previewCursor(page).boundingBox())?.y ?? Number.NaN;

const bandLine = async (page: Page): Promise<number> =>
  Number(await previewCursor(page).getAttribute("data-line"));

/** The visual-line count of the preview paragraph holding `word`. */
const bandRows = (page: Page, word: string) =>
  page.evaluate(
    ([root, w]) => {
      const p = [...document.querySelectorAll(`${root} p`)].find((el) =>
        el.textContent?.includes(w),
      );
      if (!p) return -1;
      const range = document.createRange();
      range.selectNodeContents(p);
      return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
    },
    [PLAN_PREVIEW, word] as const,
  );

/** The preview's characters in text order, each with its vertical midpoint. */
const CHARS_SCRIPT = (root: string) => {
  const out: { ch: string; mid: number }[] = [];
  const walker = document.createTreeWalker(document.querySelector(root)!, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.textContent ?? "";
    for (let i = 0; i < text.length; i++) {
      range.setStart(n, i);
      range.setEnd(n, i + 1);
      const r = range.getClientRects()[0];
      if (r && r.width > 0) out.push({ ch: text[i]!, mid: r.top + r.height / 2 });
    }
  }
  return out;
};

/** The first dozen characters laid out under the band. */
const bandText = (page: Page) =>
  page.evaluate(
    ([root, script]) => {
      const chars = (new Function(`return (${script})`)() as typeof CHARS_SCRIPT)(root);
      const band = document.querySelector("[data-caret-preview-cursor]")!.getBoundingClientRect();
      return chars
        .filter((c) => c.mid > band.top && c.mid < band.bottom)
        .map((c) => c.ch)
        .join("")
        .slice(0, 12);
    },
    [PLAN_PREVIEW, CHARS_SCRIPT.toString()] as const,
  );

/** Whether the band's vertical span holds `text`'s first character. */
const bandCovers = (page: Page, text: string) =>
  page.evaluate(
    ([root, script, want]) => {
      const chars = (new Function(`return (${script})`)() as typeof CHARS_SCRIPT)(root);
      const at = chars
        .map((c) => c.ch)
        .join("")
        .indexOf(want);
      if (at < 0) return false;
      const band = document.querySelector("[data-caret-preview-cursor]")!.getBoundingClientRect();
      return chars[at]!.mid > band.top && chars[at]!.mid < band.bottom;
    },
    [PLAN_PREVIEW, CHARS_SCRIPT.toString(), text] as const,
  );

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

/** Walks the long paragraph with j, returning how many presses reach the next block. */
async function walkLong(page: Page): Promise<number> {
  let top = await bandTop(page);
  let presses = 0;
  while (!(await bandCovers(page, "Details"))) {
    const next = await stepFrom(page, "j", top);
    expect(next).toBeGreaterThan(top);
    top = next;
    presses++;
    if (presses > 50) throw new Error("j never reached the next heading");
  }
  return presses;
}

test.describe("preview keyboard cursor", () => {
  test("j/k step one visual line, and the unit follows the width", async ({ page, daemon }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await openPreview(page, daemon);

    const counts: number[] = [];
    for (const width of [1600, 420]) {
      await page.setViewportSize({ width, height: 900 });
      await toLongParagraph(page);
      const rows = await bandRows(page, "Marmalade");
      expect(await walkLong(page)).toBe(rows);
      counts.push(rows);

      let top = await bandTop(page);
      for (let i = 0; i < rows; i++) {
        const next = await stepFrom(page, "k", top);
        expect(next).toBeLessThan(top);
        top = next;
      }
      expect(await bandCovers(page, "Marmalade")).toBe(true);
    }
    expect(counts[1]).toBeGreaterThan(counts[0]!);
  });

  test("every motion works on the preview", async ({ page, daemon }) => {
    await page.setViewportSize({ width: 420, height: 500 });
    await openPreview(page, daemon);

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
    expect(await bandCovers(page, "Marmalade")).toBe(false);
    await press(page, "Control+u");
    await expect.poll(() => bandCovers(page, "Marmalade")).toBe(true);
  });

  test("the view follows the cursor", async ({ page, daemon }) => {
    await page.setViewportSize({ width: 420, height: 500 });
    await openPreview(page, daemon);
    await press(page, "g", "g");
    await expect.poll(() => bandCovers(page, "Overview")).toBe(true);

    const inView = () =>
      page.evaluate((surface) => {
        const band = document.querySelector("[data-caret-preview-cursor]")!.getBoundingClientRect();
        const view = document.querySelector(surface)!.getBoundingClientRect();
        return band.top >= view.top && band.bottom <= view.bottom;
      }, PLAN_SURFACE);

    let presses = 0;
    while (!(await bandCovers(page, "quokka"))) {
      await press(page, "j");
      await expect.poll(inView).toBe(true);
      if (++presses > 80) throw new Error("j never reached the end");
    }
    expect(await page.locator(PLAN_SURFACE).evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  });

  test("the cursor keeps its text across resize, theme and reflow", async ({ page, daemon }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await openPreview(page, daemon);
    await toLongParagraph(page);
    let top = await stepFrom(page, "j", await bandTop(page));
    top = await stepFrom(page, "j", top);
    const recorded = await bandText(page);

    await page.setViewportSize({ width: 420, height: 900 });
    await expect.poll(() => bandCovers(page, recorded)).toBe(true);

    await page.emulateMedia({ colorScheme: "light" });
    await expect.poll(() => bandCovers(page, recorded)).toBe(true);

    const before = await bandTop(page);
    await page.evaluate((root) => {
      const p = [...document.querySelectorAll(`${root} p`)].find((el) =>
        el.textContent?.includes("A short"),
      )!;
      const card = document.createElement("div");
      card.style.height = "200px";
      p.append(card);
    }, PLAN_PREVIEW);
    await expect.poll(() => bandTop(page)).toBeGreaterThan(before);
    expect(await bandCovers(page, recorded)).toBe(true);
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

// The keyboard cursor walks comment stops in the order they render, top to bottom: on the
// preview a card hangs under the visual row its comment ends on, often mid-paragraph, so
// j/k must cross it where it sits rather than after its whole block.
//
// What needs a real browser here: the preview's real wrapping, which decides where each
// card's gap opens, at two widths since a rewrap moves the gaps; the pure ranking and the
// cursor's stepping by point stay units in ui/src/lib/previewComments.test.ts and
// ui/src/state/previewCursor.test.ts.

import type { Locator, Page } from "@playwright/test";

import { sourceToggle } from "@test/e2e/support/chrome.ts";
import { cursor, previewCursor } from "@test/e2e/support/cursor.ts";
import { type Daemon, expect, test } from "@test/e2e/support/fixtures.ts";
import { awaitPlanReadyForKeys, PLAN_PREVIEW } from "@test/e2e/support/source-view.ts";

/** A paragraph of `count` words tagged `<tag>w<nn>`, so a reflowed line is found by a word
 * it holds. */
const words = (tag: string, count: number): string =>
  Array.from({ length: count }, (_, i) => `${tag}w${String(i + 1).padStart(2, "0")}`).join(" ");

const PLAN = [
  "# Visual stops",
  "",
  words("pa", 70),
  "",
  "## Lists and tables",
  "",
  `- ${words("la", 30)}`,
  `- ${words("lb", 30)}`,
  "",
  "| Column one | Column two |",
  "| ---------- | ---------- |",
  "| ta cell | tb cell |",
  "| tc cell | td cell |",
  "",
  words("pb", 60),
  "",
  "```ts",
  "const first = 1;",
  "const second = 2;",
  "```",
  "",
  "### Closing",
  "",
  words("pc", 50),
  "",
].join("\n");

type View = "source" | "preview";

/** The source line holding `word`, read off the source view's rows after the reflow. */
async function lineWith(page: Page, word: string): Promise<number> {
  const line = await page.evaluate((want) => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    const row = [...(sh?.querySelectorAll("[data-content] [data-line]") ?? [])].find((r) =>
      (r.textContent ?? "").split(/[\s|]+/).includes(want),
    );
    return row ? Number(row.getAttribute("data-line")) : null;
  }, word);
  if (line === null) throw new Error(`no rendered row holds ${JSON.stringify(word)}`);
  return line;
}

const note = (id: string, startLine: number, endLine = startLine) => ({
  id,
  startLine,
  endLine,
  comment: `note ${id}`,
});

/** Seed PLAN with a comment of every placement and a Resume marker, then open `view`. */
async function open(page: Page, daemon: Daemon, view: View): Promise<void> {
  const id = await daemon.seed({ plan: PLAN });
  await page.goto("/");
  await awaitPlanReadyForKeys(page);
  const pa = await lineWith(page, "paw10");
  const paEnd = await lineWith(page, "paw70");
  const pb = await lineWith(page, "pbw05");
  const code = await lineWith(page, "first");
  await daemon.putDraft(id, {
    annotations: [
      note("mid", pa),
      note("end", paEnd),
      note("pair-a", pb),
      note("pair-b", pb + 1),
      note("same-a", pb + 2),
      note("same-b", pb + 2),
      note("list", await lineWith(page, "law20")),
      note("table", await lineWith(page, "tc")),
      note("code", code, code + 1),
      note("last", await lineWith(page, "pcw50")),
    ],
    composerScratches: [{ startLine: pb + 3, endLine: pb + 3, text: "half a thought" }],
  });
  await page.reload();
  await awaitPlanReadyForKeys(page);
  if (view === "preview") {
    await sourceToggle(page).click();
    await expect(page.locator(PLAN_PREVIEW)).toBeVisible();
  }
}

const STOP = "[data-annotation-card].focused, [data-scratch-marker].focused";
const lineCursor = (page: Page, view: View): Locator =>
  view === "source" ? cursor(page) : previewCursor(page);

type Position = { key: string; top: number };

/** Where the cursor rests: the hovered card or marker, else the line cursor. */
async function position(page: Page, view: View): Promise<Position | null> {
  const stop = page.locator(STOP);
  if ((await stop.count()) === 1) {
    const key = (await stop.getAttribute("data-annotation-card")) ?? "marker";
    const box = await stop.boundingBox();
    return box && { key, top: Math.round(box.y) };
  }
  const band = lineCursor(page, view);
  if ((await band.count()) !== 1) return null;
  const box = await band.boundingBox();
  const line = await band.getAttribute("data-line");
  return box && { key: `line ${line} @${Math.round(box.y)}`, top: Math.round(box.y) };
}

const same = (a: Position | null, b: Position | null) => a?.key === b?.key && a?.top === b?.top;

/** Presses `key` (space-separated keys in turn) and returns where the cursor settles, or null when it does not move. */
async function step(page: Page, view: View, key: string): Promise<Position | null> {
  const from = await position(page, view);
  for (const k of key.split(" ")) await page.keyboard.press(k);
  let last = from;
  for (let i = 0; i < 20; i++) {
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    const now = await position(page, view);
    if (!same(now, from) && same(now, last)) return now;
    last = now;
  }
  return null;
}

/** Presses `key` until the cursor stops moving or `until` says stop, recording each
 * rest; a position it already rested on ends the walk, kept so the repeat shows. */
async function walk(
  page: Page,
  view: View,
  key: string,
  until: (seen: Position[], p: Position) => boolean = () => false,
): Promise<Position[]> {
  const seen = [(await position(page, view)) as Position];
  for (let i = 0; i < 200; i++) {
    const p = await step(page, view, key);
    if (p === null || until(seen, p)) break;
    if (seen.some((s) => same(s, p))) return [...seen, p];
    seen.push(p);
  }
  return seen;
}

/** Every card and the marker, top to bottom. */
async function stopsOnScreen(page: Page): Promise<Position[]> {
  const out: Position[] = [];
  for (const el of await page.locator("[data-annotation-card], [data-scratch-marker]").all()) {
    const key = (await el.getAttribute("data-annotation-card")) ?? "marker";
    const box = await el.boundingBox();
    if (box) out.push({ key, top: Math.round(box.y) });
  }
  return out.sort((a, b) => a.top - b.top);
}

const keys = (ps: readonly Position[]) => ps.map((p) => p.key);
const isStop = (p: Position) => !p.key.startsWith("line ");

for (const width of [1280, 760]) {
  for (const view of ["preview", "source"] as const) {
    test.describe(`on the ${view} at ${width}px`, () => {
      // Tall enough that nothing scrolls, so every top is in one frame.
      test.use({ viewport: { width, height: 4000 }, reducedMotion: "reduce" });

      test("j from the top visits every stop once, in the order they render", async ({
        daemon,
        page,
      }) => {
        await open(page, daemon, view);
        await page.keyboard.press("g");
        await page.keyboard.press("g");
        const down = await walk(page, view, "j");
        const stops = await stopsOnScreen(page);
        if (view === "preview") {
          // The "mid" card hangs inside its paragraph, not after it.
          const para = await page.locator(`${PLAN_PREVIEW} p`, { hasText: "paw01" }).boundingBox();
          const mid = stops.find((s) => s.key === "mid");
          expect(mid && para && mid.top < para.y + para.height).toBe(true);
        }

        const tops = down.map((p) => p.top);
        expect(tops).toEqual([...tops].sort((a, b) => a - b));
        expect(new Set(tops).size).toBe(tops.length);
        expect(keys(down.filter(isStop))).toEqual(keys(stops));
        for (let i = 1; i < down.length; i++) {
          const [a, b] = [down[i - 1] as Position, down[i] as Position];
          expect(stops.filter((s) => s.top > a.top && s.top < b.top)).toEqual([]);
        }
      });

      test("k from the bottom retraces the j walk", async ({ daemon, page }) => {
        await open(page, daemon, view);
        await page.keyboard.press("g");
        await page.keyboard.press("g");
        const down = await walk(page, view, "j");
        const up = await walk(page, view, "k");
        expect(keys(up)).toEqual(keys(down).reverse());
      });

      test("]c visits the comments top to bottom, and [c bottom to top", async ({
        daemon,
        page,
      }) => {
        await open(page, daemon, view);
        const comments = keys(await stopsOnScreen(page)).filter((k) => k !== "marker");
        await page.keyboard.press("g");
        await page.keyboard.press("g");
        const wrapped = (seen: Position[], p: Position) => seen.some((s) => s.key === p.key);
        const next = await walk(page, view, "] c", wrapped);
        expect(keys(next.slice(1))).toEqual(comments);
        const prev = await walk(page, view, "[ c", wrapped);
        // The ]c walk ends wrapped onto the first comment.
        expect(keys(prev)).toEqual([comments[0], ...comments.slice(1).reverse()]);
      });
    });
  }
}

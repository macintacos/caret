// The keyboard cursor walks comment stops in the order they render, top to bottom: on the
// preview a card hangs under the visual row its comment ends on, often mid-paragraph, so
// j/k must cross it where it sits rather than after its whole block.
//
// What needs a real browser here: the preview's real wrapping, which decides where each
// card's gap opens, at two widths since a rewrap moves the gaps; the source view, whose
// rows the daemon reflows to a fixed width, runs at one. The pure ranking and the cursor's
// stepping by point stay units in ui/src/lib/previewComments.test.ts and
// ui/src/state/previewCursor.test.ts.

import type { Page } from "@playwright/test";

import { sourceToggle } from "@test/e2e/support/chrome.ts";
import { PREVIEW_BAND, press } from "@test/e2e/support/cursor.ts";
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
  "---",
  "",
  words("pd", 10),
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
    const sh = document.querySelector(".diffview")?.shadowRoot;
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
  const sharedLine = await lineWith(page, "pbw35");
  const code = await lineWith(page, "first");
  await daemon.putDraft(id, {
    annotations: [
      note("mid", await lineWith(page, "paw10")),
      note("end", await lineWith(page, "paw70")),
      note("rule", await lineWith(page, "---")),
      note("pair-a", await lineWith(page, "pbw05")),
      note("pair-b", await lineWith(page, "pbw20")),
      note("same-a", sharedLine),
      note("same-b", sharedLine),
      note("list", await lineWith(page, "law20")),
      note("table", await lineWith(page, "tc")),
      note("code", code, code + 1),
      note("last", await lineWith(page, "pcw50")),
    ],
    composerScratches: [
      {
        startLine: await lineWith(page, "pbw50"),
        endLine: await lineWith(page, "pbw50"),
        text: "half a thought",
      },
    ],
  });
  await page.reload();
  await awaitPlanReadyForKeys(page);
  if (view === "preview") {
    await sourceToggle(page).click();
    await expect(page.locator(PLAN_PREVIEW)).toBeVisible();
  }
}

const STOP = "[data-annotation-card].focused, [data-scratch-marker].focused";
const SOURCE_CURSOR = "[data-content] [data-line][data-caret-cursor]";
/** The config's expect budget, so a stalled step fails as one rather than ending a walk. */
const STEP_BUDGET_MS = 15_000;

type Position = { key: string; top: number };

/** Reads where the cursor rests in one in-page pass — the focused card or marker, else the
 * line cursor — or, given `settleFrom`, waits frame by frame until it rests somewhere else
 * for two frames running, returning null once `budget` ms pass without that. */
function probe(page: Page, view: View, settleFrom?: Position): Promise<Position | null> {
  return page.evaluate(
    async ({ stop, band, inShadow, from, budget }) => {
      const sh = document.querySelector(".diffview")?.shadowRoot;
      const read = (): Position | null => {
        const [card, ...others] = [
          ...document.querySelectorAll(stop),
          ...(sh?.querySelectorAll(stop) ?? []),
        ];
        if (card && others.length === 0) {
          const top = Math.round(card.getBoundingClientRect().top);
          return { key: card.getAttribute("data-annotation-card") ?? "marker", top };
        }
        const bands = [...((inShadow ? sh : document)?.querySelectorAll(band) ?? [])];
        const [line] = bands;
        if (!line || bands.length !== 1) return null;
        const top = Math.round(line.getBoundingClientRect().top);
        return { key: `line ${line.getAttribute("data-line")} @${top}`, top };
      };
      if (!from) return read();
      const same = (a: Position | null, b: Position | null) =>
        a?.key === b?.key && a?.top === b?.top;
      const end = performance.now() + budget;
      let last: Position | null = from;
      while (performance.now() < end) {
        await new Promise(requestAnimationFrame);
        const now = read();
        if (!same(now, from) && same(now, last)) return now;
        last = now;
      }
      return null;
    },
    {
      stop: STOP,
      band: view === "source" ? SOURCE_CURSOR : PREVIEW_BAND,
      inShadow: view === "source",
      from: settleFrom ?? null,
      budget: STEP_BUDGET_MS,
    },
  );
}

/** Where the cursor rests once it has mounted. */
async function position(page: Page, view: View): Promise<Position> {
  await expect.poll(() => probe(page, view)).not.toBeNull();
  const at = await probe(page, view);
  if (!at) throw new Error("the cursor vanished after mounting");
  return at;
}

/** Presses `keys` in turn from `from` and returns where the cursor settles; throws when it
 * does not move within the step budget. */
async function step(page: Page, view: View, from: Position, keys: string[]): Promise<Position> {
  await press(page, ...keys);
  const to = await probe(page, view, from);
  if (!to) throw new Error(`${keys.join("")} did not move the cursor off ${from.key}`);
  return to;
}

/** Presses `keys` until `isEnd` says the rest it reached ends the walk, recording each
 * rest; a non-final rest it already visited ends the walk too, kept so the repeat shows. */
async function walk(
  page: Page,
  view: View,
  keys: string[],
  isEnd: (p: Position, seen: readonly Position[]) => boolean,
): Promise<Position[]> {
  let rest = await position(page, view);
  const seen = [rest];
  for (let i = 0; i < 200; i++) {
    rest = await step(page, view, rest, keys);
    const end = isEnd(rest, seen);
    const repeat = seen.some((s) => s.key === rest.key && s.top === rest.top);
    seen.push(rest);
    if (end || repeat) break;
  }
  return seen;
}

/** Every card and the marker, top to bottom. */
async function stopsOnScreen(page: Page): Promise<Position[]> {
  const out = await page
    .locator("[data-annotation-card], [data-scratch-marker]")
    .evaluateAll((els) =>
      els.map((el) => ({
        key: el.getAttribute("data-annotation-card") ?? "marker",
        top: Math.round(el.getBoundingClientRect().top),
      })),
    );
  return out.sort((a, b) => a.top - b.top);
}

const keysOf = (ps: readonly Position[]) => ps.map((p) => p.key);
const isStop = (p: Position) => !p.key.startsWith("line ");
const atLast = (p: Position) => p.key === "last";
const atTop = (p: Position) => p.key.startsWith("line 1 @");

const MATRIX: [number, View][] = [
  [1280, "preview"],
  [760, "preview"],
  [1280, "source"],
];

for (const [width, view] of MATRIX) {
  test.describe(`on the ${view} at ${width}px`, () => {
    // Tall enough that nothing scrolls, so every top is in one frame.
    test.use({ viewport: { width, height: 4000 }, reducedMotion: "reduce" });

    test("j from the top visits every stop once, in the order they render", async ({
      daemon,
      page,
    }) => {
      await open(page, daemon, view);
      await press(page, "g", "g");
      const down = await walk(page, view, ["j"], atLast);
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
      expect(keysOf(down.filter(isStop))).toEqual(keysOf(stops));
      let above = Number.NEGATIVE_INFINITY;
      for (const p of down) {
        expect(stops.filter((s) => s.top > above && s.top < p.top)).toEqual([]);
        above = p.top;
      }
    });

    test("k from the bottom retraces the j walk", async ({ daemon, page }) => {
      await open(page, daemon, view);
      await press(page, "g", "g");
      const down = await walk(page, view, ["j"], atLast);
      const up = await walk(page, view, ["k"], atTop);
      expect(keysOf(up)).toEqual(keysOf(down).reverse());
    });

    test("]c visits the comments top to bottom, and [c bottom to top", async ({ daemon, page }) => {
      await open(page, daemon, view);
      const comments = keysOf(await stopsOnScreen(page)).filter((k) => k !== "marker");
      await press(page, "g", "g");
      const wrapped = (p: Position, seen: readonly Position[]) => seen.some((s) => s.key === p.key);
      const next = await walk(page, view, ["]", "c"], wrapped);
      expect(keysOf(next.slice(1))).toEqual([...comments, comments[0]]);
      const prev = await walk(page, view, ["[", "c"], wrapped);
      expect(keysOf(prev)).toEqual([comments[0], ...comments.slice(1).reverse(), comments[0]]);
    });
  });
}

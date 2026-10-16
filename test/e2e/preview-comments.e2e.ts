// The plan preview's comments: saved threads and unsent-draft markers render in the
// reading flow after the block holding their anchor's end line, hovering or focusing a
// comment highlights exactly the rendered text its source lines produced, a card edits
// and deletes as it does in the source view, and a navigator pick scrolls the preview.
//
// What needs a real browser here: the Custom Highlight API's ranges over live text
// nodes, real hover, the slots' placement and the reveal's scroll geometry, the discard
// popover, the CodeMirror editor, and persistence through the daemon across surface
// flips. The pure half stays units: slot grouping, span ranges and slot boxes in
// ui/src/lib/previewComments.test.ts, the mount and its wiring in
// ui/src/components/DiffPlanView.test.ts, and the surface table in
// ui/src/lib/planView.test.ts.

import type { Locator, Page } from "@playwright/test";

import {
  commentNavigator,
  commentTally,
  discardConfirm,
  previewToggle,
} from "@test/e2e/support/chrome.ts";
import { type Daemon, expect, test, waitPastSafeModeGrace } from "@test/e2e/support/fixtures.ts";
import { PLAN_PREVIEW, PLAN_SURFACE, planSurface } from "@test/e2e/support/source-view.ts";
import { SCROLL_OFFSET_TOP } from "@ui/src/lib/layout.ts";

const NEAR =
  "Nearby paragraph opens with alpha words that set the scene for the reviewer to read carefully, " +
  "then continues with bravo words describing the middle of the change in plain detail, " +
  "and closes with charlie words.";
const FAR =
  "Distant paragraph opens with delta words that set the scene for the reviewer to read carefully, " +
  "then continues with echo words describing the middle of the change in plain detail, " +
  "and closes with foxtrot words.";
const filler = (tag: string) =>
  Array.from({ length: 25 }, (_, i) => `${tag} filler paragraph ${i + 1}.`).join("\n\n");

const PLAN = [
  "# Preview comments",
  NEAR,
  ["- item one", "- item two", "- item three", "- item four", "- item five"].join("\n"),
  ["```ts", "const answer = 42;", "```"].join("\n"),
  filler("upper"),
  FAR,
  filler("lower"),
].join("\n\n");

interface Seeded {
  id: string;
  lines: string[];
  near: number; // first stored line of NEAR (1-based)
  itemFour: number;
  code: number; // the `const answer` line
  far: number;
}

/** The 1-based stored line whose text starts with `prefix`. */
const lineStarting = (lines: string[], prefix: string) =>
  lines.findIndex((l) => l.startsWith(prefix)) + 1;

async function seedPreview(daemon: Daemon, page: Page): Promise<Seeded> {
  const id = await daemon.seed({ plan: PLAN });
  // The daemon reflows the plan on ingest, so every anchor comes from the stored text.
  const lines = ((await daemon.getReview(id)).body?.currentPlan ?? "").split("\n");
  const near = lineStarting(lines, "Nearby paragraph");
  const far = lineStarting(lines, "Distant paragraph");
  expect(lines[near + 2]).toBe(""); // NEAR spans exactly three stored lines
  expect(lines[near + 1]).not.toBe("");
  expect(lines[far + 2]).toBe("");
  expect(lines[far + 1]).not.toBe("");
  const seeded = {
    id,
    lines,
    near,
    itemFour: lineStarting(lines, "- item four"),
    code: lineStarting(lines, "const answer"),
    far,
  };
  await daemon.putDraft(id, {
    annotations: [
      { id: "ann-1", startLine: near + 1, endLine: near + 2, comment: "tighten these two lines" },
      {
        id: "ann-2",
        startLine: seeded.itemFour,
        endLine: seeded.itemFour,
        comment: "drop item four",
      },
      { id: "ann-3", startLine: far, endLine: far, comment: "first far thought" },
      { id: "ann-4", startLine: far + 2, endLine: far + 2, comment: "second far thought" },
    ],
    composerScratches: [
      { startLine: seeded.code, endLine: seeded.code, text: "an unsent code note" },
    ],
  });
  await page.goto("/");
  await planSurface(page);
  await waitPastSafeModeGrace(page);
  await showPreview(page);
  return seeded;
}

async function showPreview(page: Page): Promise<void> {
  await previewToggle(page).click();
  await expect(page.locator(PLAN_PREVIEW)).toBeVisible();
}

const card = (page: Page, id: string): Locator => page.locator(`[data-annotation-card="${id}"]`);

/** The slot holding `inner`, its rendered block's last text bottom, and the next
 * block's first text top. */
function slotAroundBlock(page: Page, line: number, id: string) {
  return page.evaluate(
    ({ line, id }) => {
      const blocks = [
        ...document.querySelectorAll<HTMLElement>(".plan-preview [data-source-start]"),
      ];
      const i = blocks.findIndex(
        (b) => Number(b.dataset.sourceStart) <= line && line <= Number(b.dataset.sourceEnd),
      );
      const textRect = (el: Element) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const rects = [...range.getClientRects()].filter((r) => r.height > 0);
        if (rects.length === 0) throw new Error("block has no rendered text");
        return rects;
      };
      const [ownBlock, nextBlock] = [blocks[i], blocks[i + 1]];
      if (!ownBlock || !nextBlock) throw new Error(`no block pair around line ${line}`);
      const own = textRect(ownBlock);
      const next = textRect(nextBlock);
      const slot = document
        .querySelector(`[data-annotation-card="${id}"]`)
        ?.closest("[data-preview-slot]")
        ?.getBoundingClientRect();
      return {
        blockBottom: Math.max(...own.map((r) => r.bottom)),
        nextTop: Math.min(...next.map((r) => r.top)),
        slotTop: slot?.top ?? Number.NaN,
        slotBottom: slot?.bottom ?? Number.NaN,
      };
    },
    { line, id },
  );
}

/** The comment highlight's ranges, joined and whitespace-collapsed. */
function highlighted(page: Page): Promise<string> {
  return page.evaluate(() =>
    [...(CSS.highlights.get("caret-comment-span") ?? [])]
      .map((r) => r.toString())
      .join(" ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

const joinLines = (lines: string[], from: number, to: number) =>
  lines
    .slice(from - 1, to)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

/** The card's top, measured from the plan scroller's top. */
function offsetInScroller(page: Page, id: string): Promise<number> {
  return page.evaluate(
    ({ id, scroller }) => {
      const top = document.querySelector(scroller)?.getBoundingClientRect().top ?? 0;
      const el = document.querySelector(`[data-annotation-card="${id}"]`);
      return (el?.getBoundingClientRect().top ?? Number.NaN) - top;
    },
    { id, scroller: PLAN_SURFACE },
  );
}

test("each thread renders after its block without overlapping the next", async ({
  daemon,
  page,
}) => {
  const s = await seedPreview(daemon, page);
  await expect(card(page, "ann-1")).toBeVisible();
  await expect(card(page, "ann-2")).toBeVisible();

  for (const [line, id] of [
    [s.near + 2, "ann-1"],
    [s.itemFour, "ann-2"],
  ] as const) {
    await expect
      .poll(async () => {
        const g = await slotAroundBlock(page, line, id);
        return g.slotTop >= g.blockBottom - 1 && g.slotBottom <= g.nextTop + 1;
      })
      .toBe(true);
  }
});

test("hovering or expanding a card highlights exactly its lines' rendered text", async ({
  daemon,
  page,
}) => {
  const s = await seedPreview(daemon, page);
  const near = joinLines(s.lines, s.near + 1, s.near + 2);

  await card(page, "ann-1").hover();
  await expect.poll(() => highlighted(page)).toBe(near);
  expect(near).not.toContain("alpha"); // line 1 stays out

  await page.mouse.move(1, 1);
  await expect.poll(() => highlighted(page)).toBe("");

  await card(page, "ann-2").click();
  await expect(card(page, "ann-2")).toHaveClass(/focused/);
  await page.mouse.move(1, 1);
  await expect.poll(() => highlighted(page)).toBe("item four");
});

test("a draft's marker renders after the code block and resumes into the composer", async ({
  daemon,
  page,
}) => {
  const s = await seedPreview(daemon, page);
  const marker = page.getByRole("button", { name: "Resume unsent comment" });
  await expect(marker).toBeVisible();
  const below = await page.evaluate((line) => {
    const block = [
      ...document.querySelectorAll<HTMLElement>(".plan-preview [data-source-start]"),
    ].find((b) => Number(b.dataset.sourceStart) <= line && line <= Number(b.dataset.sourceEnd));
    const slot = document
      .querySelector('[aria-label="Resume unsent comment"]')
      ?.closest("[data-preview-slot]");
    return (
      (slot?.getBoundingClientRect().top ?? 0) >=
      (block?.querySelector("pre")?.getBoundingClientRect().bottom ?? Infinity) - 1
    );
  }, s.code);
  expect(below).toBe(true);

  await marker.click();
  const composer = page.getByRole("dialog", { name: "Add a comment" });
  await expect(composer).toBeInViewport();
  await expect(composer.getByRole("textbox", { name: "Comment" })).toHaveText(
    "an unsent code note",
  );
});

test("a card edits and deletes from the preview", async ({ daemon, page }) => {
  const s = await seedPreview(daemon, page);

  const one = card(page, "ann-1");
  await one.getByRole("button", { name: "Edit" }).click();
  const editor = one.getByRole("textbox", { name: "Edit comment" });
  await expect(editor).toHaveText("tighten these two lines");
  await editor.fill("tighten these two lines further");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(one.getByText("tighten these two lines further")).toBeVisible();
  await expect
    .poll(
      async () =>
        (await daemon.getReview(s.id)).body?.annotations?.find((a) => a.id === "ann-1")?.comment,
    )
    .toBe("tighten these two lines further");

  await card(page, "ann-2").getByRole("button", { name: "Discard" }).click();
  await discardConfirm(page).getByRole("button", { name: "Discard" }).click();
  await expect(card(page, "ann-2")).toHaveCount(0);
  await expect
    .poll(async () => (await daemon.getReview(s.id)).body?.annotations?.map((a) => a.id))
    .toEqual(["ann-1", "ann-3", "ann-4"]);
});

test("a navigator pick parks the comment's card at the reveal offset", async ({ daemon, page }) => {
  await seedPreview(daemon, page);
  await commentTally(page).click();
  const nav = commentNavigator(page);
  await expect(nav).toBeVisible();

  for (const [id, text] of [
    ["ann-4", "second far thought"],
    ["ann-3", "first far thought"],
  ] as const) {
    await nav.getByRole("listitem").filter({ hasText: text }).getByRole("button").click();
    await expect(card(page, id)).toHaveClass(/focused/);
    await expect
      .poll(async () => Math.abs((await offsetInScroller(page, id)) - SCROLL_OFFSET_TOP))
      .toBeLessThanOrEqual(4);
  }
});

test("flipping surfaces keeps every anchor and returns an open composer as a scratch", async ({
  daemon,
  page,
}) => {
  const s = await seedPreview(daemon, page);
  const anchors = async () =>
    (await daemon.getReview(s.id)).body?.annotations?.map((a) =>
      "startLine" in a ? [a.id, a.startLine, a.endLine] : [a.id],
    );
  const before = await anchors();

  await previewToggle(page).click();
  await expect(page.locator(PLAN_PREVIEW)).toHaveCount(0);
  await showPreview(page);

  await page.getByRole("button", { name: "Resume unsent comment" }).click();
  await expect(page.getByRole("dialog", { name: "Add a comment" })).toBeVisible();
  await previewToggle(page).click();
  await expect(page.locator(PLAN_PREVIEW)).toHaveCount(0);

  await expect.poll(anchors).toEqual(before);
  await expect
    .poll(async () =>
      (await daemon.getReview(s.id)).body?.composerScratches?.map((c) => [
        c.startLine,
        c.endLine,
        c.text,
      ]),
    )
    .toEqual([[s.code, s.code, "an unsent code note"]]);
});

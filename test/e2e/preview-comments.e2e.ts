// The plan preview's comments: saved threads and unsent-draft markers render in the
// reading flow after the block holding their anchor's end line, hovering or focusing a
// comment highlights exactly the rendered text its source lines produced, a card edits
// and deletes as it does in the source view, a navigator pick scrolls the preview, and
// a selection or plain click on rendered text opens a comment on its source lines, and
// so do `c` and `V` on the keyboard cursor's visual lines.
//
// What needs a real browser here: the Custom Highlight API's ranges over live text
// nodes, real hover, real mouse drags and clicks building native selections, real
// wrapping under keyboard visual mode and comments, the slots' placement and the
// reveal's scroll geometry, the discard popover, the CodeMirror editor, and persistence
// through the daemon across surface flips. The pure half stays units: visual-line text
// ranges in ui/src/lib/previewLines.test.ts, visual mode and `c` in
// ui/src/state/previewCursor.test.ts, slot grouping, span ranges, slot boxes and the
// selection clamp in ui/src/lib/previewComments.test.ts, the click/selection reporting in
// ui/src/components/PlanPreview.test.ts, the mount and its wiring in
// ui/src/components/DiffPlanView.test.ts, and the surface table in
// ui/src/lib/planView.test.ts.

import type { Locator, Page } from "@playwright/test";

import {
  commentNavigator,
  commentTally,
  discardConfirm,
  previewToggle,
} from "@test/e2e/support/chrome.ts";
import { previewCursor } from "@test/e2e/support/cursor.ts";
import { openRequestChangesDialog } from "@test/e2e/support/decision.ts";
import { type Daemon, expect, test, waitPastSafeModeGrace } from "@test/e2e/support/fixtures.ts";
import { submitForRevision } from "@test/e2e/support/review-state.ts";
import {
  PLAN_PREVIEW,
  PLAN_SURFACE,
  planSurface,
  revealGutterPlus,
  selectGutterRange,
} from "@test/e2e/support/source-view.ts";
import { caretThemeVariant, selectThemeFile } from "@test/e2e/support/themes.ts";
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
  ["```ts", "const answer = 42;", "const other = 7;", "```"].join("\n"),
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

type DraftAnnotations = NonNullable<Parameters<Daemon["putDraft"]>[1]["annotations"]>;

/** Seed the plan and its comments, plus any `extra` annotations built from the anchors,
 * and open the review — on the preview unless `preview` is false. */
async function seedPreview(
  daemon: Daemon,
  page: Page,
  {
    extra = () => [],
    preview = true,
  }: {
    extra?: (s: Seeded) => DraftAnnotations;
    preview?: boolean;
  } = {},
): Promise<Seeded> {
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
      ...extra(seeded),
    ],
    composerScratches: [
      { startLine: seeded.code, endLine: seeded.code, text: "an unsent code note" },
    ],
  });
  await page.goto("/");
  await planSurface(page);
  await waitPastSafeModeGrace(page);
  if (preview) await showPreview(page);
  return seeded;
}

async function showPreview(page: Page): Promise<void> {
  await previewToggle(page).click();
  await expect(page.locator(PLAN_PREVIEW)).toBeVisible();
}

const card = (page: Page, id: string): Locator => page.locator(`[data-annotation-card="${id}"]`);

/** The slot holding card `id`, the last text bottom of the block holding `line`, and the
 * next block's first text top. */
function slotAroundBlock(page: Page, line: number, id: string) {
  return page.evaluate(
    ({ line, id, preview }) => {
      const blocks = [...document.querySelectorAll<HTMLElement>(`${preview} [data-source-start]`)];
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
    { line, id, preview: PLAN_PREVIEW },
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

/** How many visual lines the preview's heading renders on; -1 with none. */
const headingRows = (page: Page) =>
  page.evaluate((preview) => {
    const h1 = document.querySelector(`${preview} h1`);
    if (!h1) return -1;
    const range = document.createRange();
    range.selectNodeContents(h1);
    return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
  }, PLAN_PREVIEW);

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

test("a slot keeps to its block when a theme switch rewraps the heading above it", async ({
  daemon,
  page,
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
  // A width at which the heavy face wraps FAR onto one more line than the thin one.
  await page.setViewportSize({ width: 505, height: 900 });
  const id = await daemon.seed({
    plan: [`# ${FAR}`, NEAR, "Closing paragraph quokka."].join("\n\n"),
  });
  const lines = ((await daemon.getReview(id)).body?.currentPlan ?? "").split("\n");
  const near = lineStarting(lines, "Nearby paragraph");
  // The blank's 0-based index after NEAR is NEAR's last 1-based line.
  const endLine = lines.indexOf("", near);
  await daemon.putDraft(id, {
    annotations: [{ id: "ann-theme", startLine: endLine, endLine, comment: "follow the rewrap" }],
  });
  await page.goto("/");
  await planSurface(page);
  await waitPastSafeModeGrace(page);
  await showPreview(page);

  const slotStaysInPlace = async () => {
    const g = await slotAroundBlock(page, endLine, "ann-theme");
    return g.slotTop >= g.blockBottom - 1 && g.slotBottom <= g.nextTop + 1;
  };
  await expect.poll(slotStaysInPlace).toBe(true);
  const topBefore = (await slotAroundBlock(page, endLine, "ann-theme")).slotTop;
  const rowsBefore = await headingRows(page);

  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(() => headingRows(page)).not.toBe(rowsBefore);
  await expect
    .poll(async () => (await slotAroundBlock(page, endLine, "ann-theme")).slotTop)
    .not.toBe(topBefore);
  await expect.poll(slotStaysInPlace).toBe(true);
});

test("a slot that grows re-places itself under its block, clear of the next", async ({
  daemon,
  page,
}) => {
  const s = await seedPreview(daemon, page);
  const marker = page.getByRole("button", { name: "Resume unsent comment" });
  await expect(marker).toBeVisible();
  const slotBox = () =>
    page.evaluate(
      ({ line, preview }) => {
        const blocks = [
          ...document.querySelectorAll<HTMLElement>(`${preview} [data-source-start]`),
        ];
        const i = blocks.findIndex(
          (b) => Number(b.dataset.sourceStart) <= line && line <= Number(b.dataset.sourceEnd),
        );
        const slot = document
          .querySelector('[aria-label="Resume unsent comment"], [aria-label="Add a comment"]')
          ?.closest("[data-preview-slot]")
          ?.getBoundingClientRect();
        return {
          codeBottom: blocks[i]?.querySelector("pre")?.getBoundingClientRect().bottom ?? Infinity,
          nextTop: blocks[i + 1]?.getBoundingClientRect().top ?? Number.NaN,
          slotTop: slot?.top ?? Number.NaN,
          slotBottom: slot?.bottom ?? Number.NaN,
          height: slot?.height ?? 0,
        };
      },
      { line: s.code, preview: PLAN_PREVIEW },
    );
  await expect.poll(async () => (await slotBox()).height).toBeGreaterThan(0);
  const heightBefore = (await slotBox()).height;

  await marker.click();
  await expect(page.getByRole("dialog", { name: "Add a comment" })).toBeVisible();
  await expect
    .poll(async () => {
      const g = await slotBox();
      return (
        g.height > heightBefore && g.slotTop >= g.codeBottom - 1 && g.slotBottom <= g.nextTop + 1
      );
    })
    .toBe(true);
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
  await expect
    .poll(() =>
      page.evaluate(
        ({ line, preview }) => {
          const block = [
            ...document.querySelectorAll<HTMLElement>(`${preview} [data-source-start]`),
          ].find(
            (b) => Number(b.dataset.sourceStart) <= line && line <= Number(b.dataset.sourceEnd),
          );
          const slot = document
            .querySelector('[aria-label="Resume unsent comment"]')
            ?.closest("[data-preview-slot]");
          return (
            (slot?.getBoundingClientRect().top ?? 0) >=
            (block?.querySelector("pre")?.getBoundingClientRect().bottom ?? Infinity) - 1
          );
        },
        { line: s.code, preview: PLAN_PREVIEW },
      ),
    )
    .toBe(true);

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

test("a focused comment on a code line stays highlighted once the block is highlighted", async ({
  daemon,
  page,
}) => {
  await seedPreview(daemon, page, {
    extra: (s) => [{ id: "ann-code", startLine: s.code, endLine: s.code, comment: "name it" }],
    preview: false,
  });
  await commentTally(page).click();
  await commentNavigator(page)
    .getByRole("listitem")
    .filter({ hasText: "name it" })
    .getByRole("button")
    .click();
  await expect(card(page, "ann-code")).toHaveClass(/focused/);

  await showPreview(page);
  await expect(page.locator(`${PLAN_PREVIEW} pre code span`).first()).toBeAttached();
  await expect.poll(() => highlighted(page)).toBe("const answer = 42;");
});

test("pointer leaving a slot keeps the highlight on the card holding focus", async ({
  daemon,
  page,
}) => {
  const s = await seedPreview(daemon, page);
  await card(page, "ann-1").getByRole("button", { name: "Edit" }).focus();
  await expect.poll(() => highlighted(page)).toBe(joinLines(s.lines, s.near + 1, s.near + 2));

  await card(page, "ann-2").hover();
  await expect.poll(() => highlighted(page)).toBe("item four");
  await page.mouse.move(1, 1);
  await expect.poll(() => highlighted(page)).toBe(joinLines(s.lines, s.near + 1, s.near + 2));
});

test.describe("commenting from the preview", () => {
  /** A word in the preview: its `nth` (0-based) whole-word occurrence inside the deepest
   * rendered block holding source `line`. */
  interface Word {
    text: string;
    line: number;
    nth?: number;
  }

  /** The viewport rect of `word`'s rendered characters. */
  async function wordRect(page: Page, word: Word) {
    const rect = await page.evaluate(
      ({ word, preview }) => {
        const block = [...document.querySelectorAll<HTMLElement>(`${preview} [data-source-start]`)]
          .filter(
            (b) =>
              Number(b.dataset.sourceStart) <= word.line &&
              word.line <= Number(b.dataset.sourceEnd),
          )
          .at(-1);
        if (!block) return null;
        const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
        const pattern = new RegExp(
          `(?<![\\w])${word.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w])`,
          "g",
        );
        let seen = 0;
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          for (const m of (node.textContent ?? "").matchAll(pattern)) {
            if (seen++ !== (word.nth ?? 0)) continue;
            const range = document.createRange();
            range.setStart(node, m.index);
            range.setEnd(node, m.index + word.text.length);
            const r = range.getBoundingClientRect();
            return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
          }
        }
        return null;
      },
      { word, preview: PLAN_PREVIEW },
    );
    if (!rect) throw new Error(`"${word.text}" not rendered near line ${word.line}`);
    return rect;
  }

  /** A real mouse drag from `from`'s first character to `to`'s last (or to a point). */
  async function dragAcross(page: Page, from: Word, to: Word | { x: number; y: number }) {
    const fromRect = await wordRect(page, from);
    const releasePoint =
      "text" in to
        ? await wordRect(page, to).then((b) => ({ x: b.right - 1, y: (b.top + b.bottom) / 2 }))
        : to;
    await page.mouse.move(fromRect.left + 1, (fromRect.top + fromRect.bottom) / 2);
    await page.mouse.down();
    await page.mouse.move(releasePoint.x, releasePoint.y, { steps: 12 });
    await page.mouse.up();
  }

  async function clickWord(page: Page, word: Word) {
    const r = await wordRect(page, word);
    await page.mouse.click((r.left + r.right) / 2, (r.top + r.bottom) / 2);
  }

  const composerLabel = (page: Page) =>
    page.getByRole("dialog", { name: "Add a comment" }).locator(".label");

  const expectComposerFocused = (page: Page) =>
    expect(
      page.getByRole("dialog", { name: "Add a comment" }).getByRole("textbox", { name: "Comment" }),
    ).toBeFocused();

  const words = (line: string) => line.match(/[\w.]+/g) ?? [];
  const occurrences = (line: string, word: string) =>
    words(line).filter((w) => w.replace(/\.$/, "") === word).length;

  // submitComposer's card wait is strict, and these plans already carry cards.
  async function sendComment(page: Page, text: string) {
    const dialog = page.getByRole("dialog", { name: "Add a comment" });
    await dialog.getByRole("textbox", { name: "Comment" }).fill(text);
    await dialog.getByRole("button", { name: "Comment" }).click();
    await expect(dialog).toHaveCount(0);
  }

  async function closeComposer(page: Page) {
    const dialog = page.getByRole("dialog", { name: "Add a comment" });
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  }

  /** A selection over the end of stored line `near` and the start of `near + 1`. */
  async function selectAcrossBreak(page: Page, s: Seeded) {
    const nearLine = s.lines[s.near - 1] ?? "";
    const last = (words(nearLine).at(-1) ?? "").replace(/[.,]$/, "");
    const next = (words(s.lines[s.near] ?? "")[0] ?? "").replace(/[.,]$/, "");
    await dragAcross(
      page,
      { text: last, line: s.near, nth: occurrences(nearLine, last) - 1 },
      { text: next, line: s.near, nth: occurrences(nearLine, next) },
    );
    return [last, next];
  }

  test("a selection across a rumdl line break comments on only the lines it spans", async ({
    daemon,
    page,
  }) => {
    const s = await seedPreview(daemon, page);
    const [last, next] = await selectAcrossBreak(page, s);

    await expect(composerLabel(page)).toHaveText(`Lines ${s.near}–${s.near + 1}`);
    const spanned = joinLines(s.lines, s.near, s.near + 1);
    expect(spanned).toContain(last);
    expect(spanned).toContain(next);
    await expect.poll(() => highlighted(page)).toBe(spanned);

    await sendComment(page, "across the break");
    await expect
      .poll(async () =>
        (await daemon.getReview(s.id)).body?.annotations
          ?.filter((a) => a.comment === "across the break")
          .map((a) => ("startLine" in a ? [a.startLine, a.endLine] : [])),
      )
      .toEqual([[s.near, s.near + 1]]);
    expect((await daemon.getReview(s.id)).body?.annotations).toHaveLength(5);
  });

  test("a drag that ends over a comment slot comments only on the block above it", async ({
    daemon,
    page,
  }) => {
    const s = await seedPreview(daemon, page);
    const box = await card(page, "ann-1").boundingBox();
    if (!box) throw new Error("ann-1's card is not rendered");
    const word = words(s.lines[s.near] ?? "")[0] ?? "";
    await dragAcross(
      page,
      { text: word, line: s.near, nth: occurrences(s.lines[s.near - 1] ?? "", word) },
      { x: box.x + box.width / 2, y: box.y + 6 },
    );
    await expect(composerLabel(page)).toHaveText(`Lines ${s.near + 1}–${s.near + 2}`);
  });

  test("a click on rendered text comments on its source line", async ({ daemon, page }) => {
    const s = await seedPreview(daemon, page);
    expect(words(s.lines[s.near] ?? "")).toContain("bravo");
    await clickWord(page, { text: "bravo", line: s.near });
    await expect(composerLabel(page)).toHaveText(`Line ${s.near + 1}`);
    await expectComposerFocused(page);
  });

  test("a Shift drag after a closed composer selects exactly the dragged text", async ({
    daemon,
    page,
  }) => {
    const s = await seedPreview(daemon, page);
    await clickWord(page, { text: "bravo", line: s.near });
    await expect(composerLabel(page)).toHaveText(`Line ${s.near + 1}`);
    await closeComposer(page);

    expect(s.lines[s.near]).toContain("bravo words");
    await page.keyboard.down("Shift");
    await dragAcross(
      page,
      { text: "bravo", line: s.near },
      { text: "words", line: s.near, nth: occurrences(s.lines[s.near - 1] ?? "", "words") },
    );
    await page.keyboard.up("Shift");

    await expect
      .poll(() => page.evaluate(() => String(document.getSelection())))
      .toBe("bravo words");
    await expect(page.getByRole("dialog", { name: "Add a comment" })).toHaveCount(0);
  });

  test("on a plan with a task list and a table: a click on a task and a drag across table rows comment on their lines", async ({
    daemon,
    page,
  }) => {
    const plan = [
      "# Tasks and tables",
      "- [ ] tick me first\n- [x] already done",
      "| name | value |\n| --- | --- |\n| cellone | first |\n| celltwo | second |\n| cellthree | third |",
      "A closing paragraph.",
    ].join("\n\n");
    const id = await daemon.seed({ plan });
    const lines = ((await daemon.getReview(id)).body?.currentPlan ?? "").split("\n");
    const tick = lineStarting(lines, "- [ ] tick me first");
    const row1 = lineStarting(lines, "| cellone");
    const row2 = lineStarting(lines, "| celltwo");
    await page.goto("/");
    await planSurface(page);
    await waitPastSafeModeGrace(page);
    await showPreview(page);

    await clickWord(page, { text: "tick", line: tick });
    await expect(composerLabel(page)).toHaveText(`Line ${tick}`);
    await expectComposerFocused(page);
    await closeComposer(page);

    await dragAcross(page, { text: "cellone", line: row1 }, { text: "celltwo", line: row2 });
    await expect(composerLabel(page)).toHaveText(`Lines ${row1}–${row2}`);
  });

  test("selections across blocks and across code rows comment on the lines they span", async ({
    daemon,
    page,
  }) => {
    const s = await seedPreview(daemon, page);
    const itemOne = lineStarting(s.lines, "- item one");

    await dragAcross(page, { text: "words.", line: s.near + 2 }, { text: "one", line: itemOne });
    await expect(composerLabel(page)).toHaveText(`Lines ${s.near + 2}–${itemOne}`);
    await expectComposerFocused(page);
    await closeComposer(page);

    await expect(page.locator(`${PLAN_PREVIEW} pre code span`).first()).toBeAttached();
    await dragAcross(page, { text: "42", line: s.code }, { text: "other", line: s.code + 1 });
    await expect(composerLabel(page)).toHaveText(`Lines ${s.code}–${s.code + 1}`);
  });

  test("a comment made in either view shows on the same lines in the other, with identical feedback", async ({
    daemon,
    page,
  }) => {
    const s = await seedPreview(daemon, page);
    const notes = async () =>
      (await daemon.getReview(s.id)).body?.annotations
        ?.filter((a) => a.comment === "same note")
        .map((a) => ({ id: a.id, lines: "startLine" in a ? [a.startLine, a.endLine] : [] }));

    await selectAcrossBreak(page, s);
    await sendComment(page, "same note");
    await expect.poll(notes).toHaveLength(1);
    const [fromPreview] = (await notes()) ?? [];
    expect(fromPreview?.lines).toEqual([s.near, s.near + 1]);

    await previewToggle(page).click();
    await expect(page.locator(PLAN_PREVIEW)).toHaveCount(0);
    await expect(card(page, fromPreview?.id ?? "")).toBeVisible();
    expect((await notes())?.[0]).toEqual(fromPreview);

    await selectGutterRange(page, s.near, s.near + 1);
    await (await revealGutterPlus(page, s.near + 1)).click();
    await expect(composerLabel(page)).toHaveText(`Lines ${s.near}–${s.near + 1}`);
    await sendComment(page, "same note");
    await expect.poll(notes).toHaveLength(2);
    const fromSource = (await notes())?.find((n) => n.id !== fromPreview?.id);
    expect(fromSource?.lines).toEqual([s.near, s.near + 1]);

    await showPreview(page);
    const slotOf = (id: string) =>
      page.evaluate((id) => {
        const slot = document
          .querySelector(`[data-annotation-card="${id}"]`)
          ?.closest("[data-preview-slot]");
        return slot ? [...document.querySelectorAll("[data-preview-slot]")].indexOf(slot) : -1;
      }, id);
    await expect.poll(() => slotOf("ann-1")).toBeGreaterThanOrEqual(0);
    const nearSlot = await slotOf("ann-1");
    await expect.poll(() => slotOf(fromPreview?.id ?? "")).toBe(nearSlot);
    await expect.poll(() => slotOf(fromSource?.id ?? "")).toBe(nearSlot);
    await card(page, fromSource?.id ?? "").hover();
    await expect.poll(() => highlighted(page)).toBe(joinLines(s.lines, s.near, s.near + 1));

    const feedback = await submitForRevision(
      page,
      await openRequestChangesDialog(page),
      daemon,
      s.id,
    );
    const entries = [
      ...feedback.matchAll(
        new RegExp(`\\d+\\. (Lines ${s.near}-${s.near + 1}:\\n[\\s\\S]*?same note)`, "g"),
      ),
    ].map((m) => m[1]);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toContain(">");
    expect(entries[1]).toBe(entries[0]);
  });

  test.describe("from the keyboard", () => {
    /** The visual selection highlight's text, or "" when nothing is painted. */
    const visualSelectionText = (page: Page) =>
      page.evaluate(() =>
        [...(CSS.highlights.get("caret-visual-selection") ?? [])].map((r) => r.toString()).join(""),
      );

    /** `g g j`: the cursor band on NEAR's first visual line. */
    async function cursorToNear(page: Page, s: Seeded) {
      await page.keyboard.press("g");
      await page.keyboard.press("g");
      await expect(previewCursor(page)).toHaveAttribute("data-line", "1");
      await page.keyboard.press("j");
      await expect(previewCursor(page)).toHaveAttribute("data-line", String(s.near));
    }

    /** Seeds the preview, then `g g j V`: visual mode anchored on NEAR's first visual
     * line. */
    async function visualAtNear(daemon: Daemon, page: Page): Promise<Seeded> {
      const s = await seedPreview(daemon, page);
      await cursorToNear(page, s);
      await page.keyboard.press("V");
      await expect.poll(() => visualSelectionText(page)).toMatch(/^Nearby/);
      return s;
    }

    async function bandBox(page: Page) {
      const box = await previewCursor(page).boundingBox();
      if (!box) throw new Error("the cursor band is not rendered");
      return box;
    }

    /** Drag from "Nearby" to 2px inside `box`'s right edge at its middle. */
    const dragToBandEnd = (
      page: Page,
      s: Seeded,
      box: { x: number; y: number; width: number; height: number },
    ) =>
      dragAcross(
        page,
        { text: "Nearby", line: s.near },
        { x: box.x + box.width - 2, y: box.y + box.height / 2 },
      );

    const hint = (page: Page) => page.locator(".visual-hint");

    test("c comments on the lines the cursor's visual line covers, as a drag across that line does", async ({
      daemon,
      page,
    }) => {
      const s = await seedPreview(daemon, page);
      await cursorToNear(page, s);
      await page.keyboard.press("c");
      await expect(composerLabel(page)).toHaveText(/^Lines? /);
      const label = await composerLabel(page).textContent();
      await closeComposer(page);

      await dragToBandEnd(page, s, await bandBox(page));
      await expect(composerLabel(page)).toHaveText(label ?? "");
    });

    test("a mouse comment opened in visual mode hides the visual selection while its composer is open", async ({
      daemon,
      page,
    }) => {
      const s = await visualAtNear(daemon, page);

      await dragToBandEnd(page, s, await bandBox(page));
      await expect(composerLabel(page)).toHaveText(/^Lines? /);
      await expect.poll(() => visualSelectionText(page)).toBe("");
    });

    test("V and j extend the selection over visual lines, and c comments on what a drag over the same text does", async ({
      daemon,
      page,
    }) => {
      const s = await visualAtNear(daemon, page);
      await expect(hint(page)).toBeVisible();
      const oneLine = await visualSelectionText(page);
      const firstTop = (await bandBox(page)).y;

      await page.keyboard.press("j");
      await expect.poll(async () => (await bandBox(page)).y).toBeGreaterThan(firstTop);
      await expect
        .poll(async () => {
          const twoLines = await visualSelectionText(page);
          return twoLines.length > oneLine.length && twoLines.startsWith(oneLine.trimEnd());
        })
        .toBe(true);

      const box = await bandBox(page);
      await page.keyboard.press("c");
      await expect(composerLabel(page)).toHaveText(/^Lines? /);
      const label = (await composerLabel(page).textContent()) ?? "";
      await expect.poll(() => visualSelectionText(page)).toBe("");
      await expect(hint(page)).toHaveCount(0);

      await closeComposer(page);
      await dragToBandEnd(page, s, box);
      await expect(composerLabel(page)).toHaveText(label);

      await sendComment(page, "from the keys");
      const [start, end = start] = (label.match(/\d+/g) ?? []).map(Number);
      await expect
        .poll(async () =>
          (await daemon.getReview(s.id)).body?.annotations
            ?.filter((a) => a.comment === "from the keys")
            .map((a) => ("startLine" in a ? [a.startLine, a.endLine] : [])),
        )
        .toEqual([[start, end]]);
    });

    test("Esc and a second V exit visual mode on the preview", async ({ daemon, page }) => {
      const s = await visualAtNear(daemon, page);

      await page.keyboard.press("Escape");
      await expect.poll(() => visualSelectionText(page)).toBe("");
      await expect(hint(page)).toHaveCount(0);
      await expect(previewCursor(page)).toHaveAttribute("data-line", String(s.near));

      await page.keyboard.press("V");
      await expect.poll(() => visualSelectionText(page)).toMatch(/^Nearby/);
      await page.keyboard.press("V");
      await expect.poll(() => visualSelectionText(page)).toBe("");
    });
  });
});

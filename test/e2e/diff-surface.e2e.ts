// Dev-flagged source-view surface (EXC-583). With the flag on, the plan renders
// as line-numbered markdown source through the @pierre/diffs wrapper instead of
// the legacy plan view + contents rail. The heading breadcrumbs bar jumps to
// headings and the line gutter creates comments (EXC-584). The view instance must
// survive the 2s poll with no scroll reset.
//
// Everything here needs a real browser. The gutter `+` reveal, the drag and
// shift-extend selection gestures, the smooth-scroll geometry, and the colors and
// font features resolved inside the library's shadow root are hit-testing, layout,
// and computed style that happy-dom does not do — all e2e concerns per
// doc/agents/browser-testing.md. The component's prop-driven halves — its render
// branches, annotation display, and scratch rehydration — are units in
// ui/src/components/DiffPlanView.test.ts.

import type { Locator, Page } from "@playwright/test";

import { discardConfirm, unsentRows } from "@test/e2e/support/chrome.ts";
import { makeProject } from "@test/e2e/support/file-refs.ts";
import {
  type Daemon,
  expect,
  motionToken,
  test,
  waitForTwoPollTicks,
  waitPastSafeModeGrace,
} from "@test/e2e/support/fixtures.ts";
import {
  awaitAnnotationComment,
  awaitAnnotationCount,
  awaitScratchCount,
  expectSingleAnnotation,
  submitForRevision,
} from "@test/e2e/support/review-state.ts";
import {
  composer,
  expectNoComposerOpens,
  firstGlyphX,
  gridCounts,
  gutterCellCenter,
  jumpToHeading,
  lineCenterY,
  PLAN_SURFACE,
  planSurface,
  revealGutterPlus,
  rowHeights,
  SEAM_STRIP,
  selectGutterRange,
  settledMutations,
  submitComposer,
} from "@test/e2e/support/source-view.ts";

// A plan tall enough to scroll the source view past one viewport.
const TALL_PLAN = `# Tall Plan\n\n${Array.from({ length: 120 }, (_, i) => `Line ${i + 1} of the plan body, long enough to overflow the viewport.`).join("\n\n")}\n`;

/** Seed TALL_PLAN and open it, waiting for its first body line and returning
 * the plan surface. */
async function openTallPlan(page: Page, daemon: Daemon): Promise<Locator> {
  await daemon.seed({ plan: TALL_PLAN });
  await page.goto("/");
  const view = await planSurface(page);
  await expect(page.getByText("Line 1 of the plan body")).toBeVisible();
  return view;
}

test("scroll position survives the 2-second poll tick", async ({ daemon, page }) => {
  const view = await openTallPlan(page, daemon);

  await view.evaluate((el) => {
    el.scrollTop = 400;
  });
  await expect.poll(async () => view.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  const before = await view.evaluate((el) => el.scrollTop);

  // Wait out two poll ticks (the poll re-delivers the same version every 2s); a
  // remount on an unchanged version would reset scrollTop to 0.
  await waitForTwoPollTicks(page);

  // Same scroll offset — the instance was preserved, not remounted.
  expect(await view.evaluate((el) => el.scrollTop)).toBe(before);
});

// ----- Heading jump scroll geometry -----

// A multi-heading plan with tall sections so a jump produces a visible scroll.
const padding = Array.from({ length: 40 }, (_, i) => `Filler line ${i + 1}.`).join("\n\n");
const TOC_PLAN = `# Overview\n\n${padding}\n\n## Approach\n\n${padding}\n\n## Verification\n\n${padding}\n`;

/** Offset (px) of the heading line whose source text is `text` from the top of
 * the scroll container, or +Infinity if that line isn't rendered. */
async function headingTopOffset(page: Page, text: string): Promise<number> {
  return page.evaluate((t) => {
    const view = document.querySelector(".diff-plan");
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    const row = Array.from(sh?.querySelectorAll("[data-line]") ?? []).find(
      (r) => r.textContent?.trim() === t,
    );
    if (view == null || row == null) return Number.POSITIVE_INFINITY;
    return Math.round(row.getBoundingClientRect().top - view.getBoundingClientRect().top);
  }, text);
}

test("a heading jump lands the heading at the top of the view, however far it is", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: TOC_PLAN });
  await page.goto("/");

  await planSurface(page);

  // Jump to the farthest heading; the smooth scroll should settle it just below
  // the top edge (a small breathing-room offset), not short of it or in the
  // middle of the view. expect.poll rides out the animation.
  await jumpToHeading(page, "Verification");
  await expect.poll(() => headingTopOffset(page, "## Verification")).toBeLessThanOrEqual(20);
  expect(await headingTopOffset(page, "## Verification")).toBeGreaterThanOrEqual(0);
});

// ----- Annotation creation from the line gutter (EXC-584) -----

// A plan with body text on several lines so a range spans real source lines.
const RANGE_PLAN = `# Range Plan\n\n${Array.from(
  { length: 12 },
  (_, i) => `Body line ${i + 1} content here.`,
).join("\n\n")}\n`;

/** The inline composer's editing surface. The composer is a CodeMirror editor
 * (MarkdownEditor.svelte), whose contenteditable exposes role="textbox" with the
 * "Comment" aria-label — so fill/press/toHaveText work as they did on the old
 * textarea, just targeted by role instead of tag. */
function composerInput(composer: Locator): Locator {
  return composer.getByRole("textbox", { name: "Comment" });
}

/** Click the gutter `+` a range selection revealed, and return the composer it
 * opens once visible. */
async function openComposerFromSelection(page: Page): Promise<Locator> {
  const plus = page.locator(".diffview [data-utility-button]");
  await expect(plus).toBeVisible();
  await plus.click();
  const composer = page.getByRole("dialog", { name: "Add a comment" });
  await expect(composer).toBeVisible();
  return composer;
}

/** goto + planSurface + the default fixture plan's marker text — split out from
 * `openDefaultPlan` for the one caller that must seed and put a draft before
 * `goto`. */
async function gotoDefaultPlan(page: Page): Promise<void> {
  await page.goto("/");
  await planSurface(page);
  await expect(page.getByText("This plan reorganizes the widget cache")).toBeVisible();
}

/** Seed the default fixture plan and open it, waiting for its own text. */
async function openDefaultPlan(page: Page, daemon: Daemon): Promise<string> {
  const id = await daemon.seed();
  await gotoDefaultPlan(page);
  return id;
}

/** Open the default plan, past Safe Mode's grace window, and click the gutter's
 * `+` on line 3 to open the comment composer — the arrange sequence most of the
 * composer/scratch specs below share. */
async function openComposerOnLine3(
  page: Page,
  daemon: Daemon,
): Promise<{ id: string; composer: Locator }> {
  const id = await openDefaultPlan(page, daemon);
  await waitPastSafeModeGrace(page);
  const plus = await revealGutterPlus(page, 3);
  await plus.click();
  return { id, composer: page.getByRole("dialog", { name: "Add a comment" }) };
}

/** Open the default plan and click the gutter's `+` on line 3 to open the
 * comment composer, with no Safe Mode grace wait — for tests whose first
 * keystroke lands well clear of the window on its own, or that never press
 * one at all. */
async function openComposerOnLine3NoGrace(
  page: Page,
  daemon: Daemon,
): Promise<{ id: string; composer: Locator }> {
  const id = await openDefaultPlan(page, daemon);
  const plus = await revealGutterPlus(page, 3);
  await plus.click();
  const composer = page.getByRole("dialog", { name: "Add a comment" });
  await expect(composer).toBeVisible();
  return { id, composer };
}

/** goto + planSurface + the RANGE_PLAN/BRACKET_PLAN's shared marker text — split
 * out from `openRangePlan` for the one caller that must seed and run an
 * `addInitScript` before `goto`. */
async function gotoRangePlan(page: Page): Promise<void> {
  await page.goto("/");
  await planSurface(page);
  await expect(page.getByText("Body line 1 content here.")).toBeVisible();
}

/** Seed `plan` (RANGE_PLAN by default) and open it, waiting for its shared
 * "Body line 1 content here." marker — also what BRACKET_PLAN's first body line
 * reads, so it opens that plan too. */
async function openRangePlan(
  page: Page,
  daemon: Daemon,
  plan: string = RANGE_PLAN,
): Promise<string> {
  const id = await daemon.seed({ plan });
  await gotoRangePlan(page);
  return id;
}

/** On the open RANGE_PLAN/BRACKET_PLAN, click line 3's body ("Body line 1") to
 * open its composer, and return it once the range label confirms line 3. */
async function openComposerOnRangeLine3(page: Page): Promise<Locator> {
  const composer = page.getByRole("dialog", { name: "Add a comment" });
  await page.getByText("Body line 1 content here.").click();
  await expect(composer.getByText("Line 3")).toBeVisible();
  return composer;
}

/**
 * Extend an existing selection with a shift-click on the number column (the
 * library's keyboard-additive extend gesture): anchor a single line by clicking
 * its number cell, then Shift-click `extendLine`'s cell. The result is a span from
 * the anchor to the shift target — the alternate path to a multi-line range that
 * the drag covers, preserved as additive rather than pointer-only.
 */
async function shiftExtendSelection(
  page: Page,
  anchorLine: number,
  extendLine: number,
): Promise<void> {
  const anchor = await gutterCellCenter(page, anchorLine);
  const extend = await gutterCellCenter(page, extendLine);
  await page.mouse.move(anchor.x, anchor.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.keyboard.down("Shift");
  await page.mouse.move(extend.x, extend.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.keyboard.up("Shift");
}

/**
 * Select a line span by dragging across the code *body* (not the gutter) from
 * `startLine` to `endLine`: the natural "drag across the lines" gesture. X stays
 * at the horizontal centre of the content while Y sweeps between the two line
 * rows. With `shift`, the modifier is held for the whole drag (the native
 * text-selection escape-hatch), so the gesture must NOT open a composer.
 */
async function dragLineBody(
  page: Page,
  startLine: number,
  endLine: number,
  opts: { shift?: boolean } = {},
): Promise<void> {
  const startY = await lineCenterY(page, startLine);
  const endY = await lineCenterY(page, endLine);
  const x = await page
    .locator(PLAN_SURFACE)
    .evaluate((el) => el.getBoundingClientRect().x + el.getBoundingClientRect().width / 2);
  if (opts.shift) await page.keyboard.down("Shift");
  await page.mouse.move(x, startY);
  await page.mouse.down();
  await page.mouse.move(x, endY, { steps: 12 });
  await page.mouse.up();
  if (opts.shift) await page.keyboard.up("Shift");
}

test("creating a single-line annotation from the gutter persists it line-anchored", async ({
  daemon,
  page,
}) => {
  // Line 3 is the "This plan reorganizes…" paragraph in the fixture plan.
  const { id, composer } = await openComposerOnLine3NoGrace(page, daemon);
  await expect(composer.getByText("Line 3")).toBeVisible();
  await composerInput(composer).fill("Quantify the cold cost here.");
  await composer.getByRole("button", { name: "Comment" }).click();

  await expect(composer).toHaveCount(0);
  await expectSingleAnnotation(daemon, id, {
    startLine: 3,
    endLine: 3,
    comment: "Quantify the cold cost here.",
  });
});

test("Tab nests the current list item in the comment composer", async ({ daemon, page }) => {
  // Tab on a list line runs indentMore against the four-space indentUnit, so the
  // marker shifts one level right (a nested list item), rather than tabbing focus
  // out of the editor. The item follows a first line so submit's trim (which
  // strips only the whole-comment edges) can't hide the indent.
  const { id, composer } = await openComposerOnLine3(page, daemon);
  await expect(composer.locator(".cm-editor")).toBeVisible();
  await page.keyboard.type("Note");
  await page.keyboard.press("Enter");
  await page.keyboard.type("- item");
  await page.keyboard.press("Tab");
  await composer.getByRole("button", { name: "Comment" }).click();

  await awaitAnnotationComment(daemon, id, "Note\n    - item");
});

test("Tab inserts four spaces outside a list in the comment composer", async ({ daemon, page }) => {
  // Off a list line Tab inserts four literal spaces at the cursor (the "just
  // enter four spaces" fallback), still without moving focus out of the editor.
  // Text on both sides keeps the run off the whole-comment edges submit trims.
  const { id, composer } = await openComposerOnLine3(page, daemon);
  await expect(composer.locator(".cm-editor")).toBeVisible();
  await page.keyboard.type("a");
  await page.keyboard.press("Tab");
  await page.keyboard.type("b");
  await composer.getByRole("button", { name: "Comment" }).click();

  await awaitAnnotationComment(daemon, id, "a    b");
});

test("Tab indents every line of a multi-line selection", async ({ daemon, page }) => {
  // Highlighting several lines and pressing Tab indents them all (indentMore over
  // the selection) rather than replacing the highlight with a single tab. A
  // leading unselected line keeps the indented block off the trimmed edges.
  const { id, composer } = await openComposerOnLine3(page, daemon);
  await expect(composer.locator(".cm-editor")).toBeVisible();
  await page.keyboard.type("Head");
  await page.keyboard.press("Enter");
  await page.keyboard.type("one");
  await page.keyboard.press("Enter");
  await page.keyboard.type("two");
  // Select up from the end of "two" into "one" — a two-line highlight.
  await page.keyboard.press("Shift+ArrowUp");
  await page.keyboard.press("Tab");
  await composer.getByRole("button", { name: "Comment" }).click();

  await awaitAnnotationComment(daemon, id, "Head\n    one\n    two");
});

test("Escape blurs the edit editor, then a second Escape saves the change", async ({
  daemon,
  page,
}) => {
  // Two-stage Escape: the first press unfocuses the field (still editing, nothing
  // saved); the second — now on the composer card — commits the edit, the way
  // clicking away would.
  const id = await daemon.seed();
  await daemon.putDraft(id, {
    annotations: [{ id: "ann-1", startLine: 7, endLine: 8, comment: "original" }],
  });
  await gotoDefaultPlan(page);

  const card = page.locator("[data-annotation-card]");
  await card.getByRole("button", { name: "Edit" }).click();
  const editor = card.locator(".cm-editor");
  await expect(editor.and(page.locator(".cm-focused"))).toBeVisible();
  await waitPastSafeModeGrace(page);
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("revised");

  await page.keyboard.press("Escape");
  await expect(card.locator(".cm-editor.cm-focused")).toHaveCount(0);
  await expect(editor).toBeVisible(); // still editing, not dismissed
  expect((await daemon.getReview(id)).body?.annotations?.[0]?.comment).toBe("original");

  await page.keyboard.press("Escape");
  await awaitAnnotationComment(daemon, id, "revised");
});

test("Escape blurs the composer, then a second Escape keeps the draft", async ({
  daemon,
  page,
}) => {
  // In create mode the second Escape keeps the draft for later (a resumable
  // scratch) rather than discarding it — the non-destructive "clicked away" path.
  const { id, composer } = await openComposerOnLine3(page, daemon);
  await expect(composer.locator(".cm-editor")).toBeVisible();
  await page.keyboard.type("keep me for later");

  await page.keyboard.press("Escape");
  await expect(composer.locator(".cm-editor.cm-focused")).toHaveCount(0);
  await expect(composer).toBeVisible(); // still open, not dismissed

  await page.keyboard.press("Escape");
  await expect(composer).toHaveCount(0); // dismissed
  await expect(page.getByRole("button", { name: "Resume unsent comment" })).toBeVisible();
  await awaitScratchCount(daemon, id, 1);
});

test("typing in a composer opened while another is open keeps the caret in place (EXC-780)", async ({
  daemon,
  page,
}) => {
  // Regression: opening a second composer while the first is still open used to
  // corrupt the new composer's caret — the host container survived the range
  // switch and its slot was reassigned in place, desyncing the just-focused
  // CodeMirror editable's DOM caret from CodeMirror's own offset. The first
  // Backspace then jumped the caret to the start, so subsequent input landed at
  // position 0. This MUST exercise REAL per-character keystrokes: the other
  // composer specs use fill(), which replaces the field in one shot and bypasses
  // the per-character path where the desync lives, so a fill()-based test passes
  // even while the bug is present.
  const id = await openRangePlan(page, daemon);
  await waitPastSafeModeGrace(page);

  // Composer A: open on line 3 via a line-body click and give it text, matching
  // the reported repro (the first field holds an in-progress draft when the
  // second is opened).
  const composer = await openComposerOnRangeLine3(page);
  await composerInput(composer).fill("first draft, kept for later");

  // Composer B: open on line 7 while A is still open — the open-while-open
  // transition that switches `pending` to a new range and (before the fix)
  // re-slotted the surviving host container in place.
  await page.getByText("Body line 3 content here.").click();
  await expect(composer.getByText("Line 7")).toBeVisible();

  // Type into B's autofocused editor with real keystrokes — no click/focus of
  // our own, which would place the caret and mask the desync. toBeFocused()
  // confirms the composer autofocused (without moving focus); page.keyboard then
  // targets the active element. Correct result is "hellX"; the bug yields "Xhell"
  // (the Backspace jumps the caret to 0, so "X" inserts at the start).
  await expect(composerInput(composer)).toBeFocused();
  await page.keyboard.type("hello");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("X");

  await composer.getByRole("button", { name: "Comment" }).click();

  await expect(composer).toHaveCount(0);
  await expectSingleAnnotation(daemon, id, { startLine: 7, endLine: 7, comment: "hellX" });
});

test("an unsubmitted composer scratch survives a page reload (EXC-744)", async ({
  daemon,
  page,
}) => {
  // Type a comment on line 3 and Keep it for later instead of submitting: it is
  // retained as a "scratch" that leaves a Resume marker on the line.
  const { id, composer } = await openComposerOnLine3NoGrace(page, daemon);
  await composerInput(composer).fill("Half-written thought to finish later.");
  await composer.getByRole("button", { name: "Keep for later" }).click();

  const marker = page.getByRole("button", { name: "Resume unsent comment" });
  await expect(marker).toBeVisible();
  await expect(marker).toContainText("Half-written thought to finish later.");

  // The scratch persists to the daemon through the draft autosave (the fix): the
  // review now carries a composer scratch.
  await awaitScratchCount(daemon, id, 1);

  // Reload. Before the fix the marker vanished (scratches lived only in memory);
  // now it rehydrates from the persisted scratch.
  await page.reload();
  await planSurface(page);
  const restored = page.getByRole("button", { name: "Resume unsent comment" });
  await expect(restored).toBeVisible();
  await expect(restored).toContainText("Half-written thought to finish later.");

  // Resuming reopens the composer with the text restored, ready to finish.
  await restored.click();
  const reopened = page.getByRole("dialog", { name: "Add a comment" });
  await expect(reopened).toBeVisible();
  await expect(composerInput(reopened)).toContainText("Half-written thought to finish later.");
});

test("creating a range annotation from the gutter persists the correct line span", async ({
  daemon,
  page,
}) => {
  const id = await daemon.seed({ plan: RANGE_PLAN });
  // Pin this test to caret-light: EXC-730 made caret-dark the default, which
  // surfaces the pre-existing dark-mode bug tracked in EXC-751 (the multi-line
  // range composer's Cmd+Enter submit does not fire when the diff renders dark).
  // This test guards range-annotation correctness, not theming, so it exercises
  // the working (light) path; EXC-751 owns the dark case.
  await page.addInitScript(() => localStorage.setItem("caret.theme.mode", "light"));
  await gotoRangePlan(page);
  // The submit chord below is this test's first keydown, ~330ms after mount — 30ms
  // clear of the 300ms safe-mode grace, and less under load. Unguarded, the guard
  // eats the chord and the composer never closes (EXC-897).
  await waitPastSafeModeGrace(page);

  // Select lines 5–8 by dragging the number column, then open the composer from
  // the gutter + that the selection reveals.
  await selectGutterRange(page, 5, 8);
  const composer = await openComposerFromSelection(page);
  await expect(composer.getByText("Lines 5–8")).toBeVisible();
  const rangeInput = composerInput(composer);
  await rangeInput.fill("This whole block needs a rewrite.");
  // Submit via the keyboard chord; focus the input first so the chord lands on it.
  await rangeInput.click();
  await page.keyboard.press("ControlOrMeta+Enter");

  await expect(composer).toHaveCount(0);
  await expectSingleAnnotation(daemon, id, { startLine: 5, endLine: 8 });
});

test("a shift-extend selection reaches the composer with an ascending range", async ({
  daemon,
  page,
}) => {
  // The keyboard-additive path: anchor a line, Shift-click a later one to extend
  // the span, then open the composer from the gutter +. It must land the same
  // ascending Lines X–Y the drag does, so the keyboard path stays equivalent.
  const id = await openRangePlan(page, daemon);

  await shiftExtendSelection(page, 4, 9);
  const composer = await openComposerFromSelection(page);
  await expect(composer.getByText("Lines 4–9")).toBeVisible();
  await composerInput(composer).fill("Shift-extended this span.");
  await composer.getByRole("button", { name: "Comment" }).click();

  await expect(composer).toHaveCount(0);
  await expectSingleAnnotation(daemon, id, { startLine: 4, endLine: 9 });
});

test("a bottom-up drag normalizes to an ascending span", async ({ daemon, page }) => {
  // Dragging the number column upward (endLine < startLine) must still persist an
  // ascending {startLine, endLine} — this locks commenting.ts's Math.min/max
  // normalization against regression, the invariant the live readout shares.
  const id = await openRangePlan(page, daemon);

  // Drag from line 9 up to line 5 — the gesture runs bottom-up.
  await selectGutterRange(page, 9, 5);
  const composer = await openComposerFromSelection(page);
  // Ascending despite the upward drag.
  await expect(composer.getByText("Lines 5–9")).toBeVisible();
  await composerInput(composer).fill("Dragged upward.");
  await composer.getByRole("button", { name: "Comment" }).click();

  await expect(composer).toHaveCount(0);
  await expectSingleAnnotation(daemon, id, { startLine: 5, endLine: 9 });
});

test("dragging across the code body opens the range composer on release", async ({
  daemon,
  page,
}) => {
  // The headline gesture (EXC-639): click-drag across the code body — not the
  // narrow gutter — selects the span and opens the composer on release, with no
  // separate + click. Submitting persists the ascending {startLine, endLine}.
  const id = await openRangePlan(page, daemon);

  await dragLineBody(page, 4, 8);

  const composer = page.getByRole("dialog", { name: "Add a comment" });
  await expect(composer).toBeVisible();
  await expect(composer.getByText("Lines 4–8")).toBeVisible();
  await composerInput(composer).fill("Range from a body drag.");
  await composer.getByRole("button", { name: "Comment" }).click();

  await expect(composer).toHaveCount(0);
  await expectSingleAnnotation(daemon, id, { startLine: 4, endLine: 8 });
});

test("holding Shift while dragging the code body opens no composer (text-select escape-hatch)", async ({
  daemon,
  page,
}) => {
  // The copy escape-hatch: a Shift+drag bows out of the comment gesture so the
  // browser selects text natively. We assert the deterministic half — no composer
  // opens — rather than that text got selected (a synthetic drag selecting text is
  // too flaky in headless Chromium to assert on).
  await openRangePlan(page, daemon);

  await dragLineBody(page, 4, 8, { shift: true });

  await expect(page.getByRole("dialog", { name: "Add a comment" })).toHaveCount(0);
});

test("a plain code-body drag suppresses native text selection", async ({ daemon, page }) => {
  // The flip side of the Shift escape-hatch: a plain drag must not paint native text
  // selection over the span it is range-selecting. Suppression is user-select:none on
  // the host (inherited into the shadow content) for the drag's lifetime, so while a
  // drag is held the code lines compute as unselectable. (A synthetic mouse drag does
  // not reliably create a selection in headless Chromium, so asserting the mechanism —
  // the computed user-select — is what actually proves the fix.)
  await openRangePlan(page, daemon);

  const x = await page
    .locator(PLAN_SURFACE)
    .evaluate((el) => el.getBoundingClientRect().x + el.getBoundingClientRect().width / 2);
  const readUserSelect = () =>
    page.evaluate(() => {
      const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot ?? null;
      const line = sh?.querySelector("[data-line]");
      return line == null ? null : getComputedStyle(line).userSelect;
    });

  expect(await readUserSelect()).not.toBe("none");

  await page.mouse.move(x, await lineCenterY(page, 4));
  await page.mouse.down();
  await page.mouse.move(x, await lineCenterY(page, 8), { steps: 12 });
  expect(await readUserSelect()).toBe("none");

  await page.mouse.up();
  expect(await readUserSelect()).not.toBe("none");
});

test("a live readout previews the range during the drag and clears on release", async ({
  daemon,
  page,
}, testInfo) => {
  await openRangePlan(page, daemon);

  const readout = page.locator(".drag-readout");
  await expect(readout).toHaveCount(0);

  // The button stays held, so the selection is read mid-gesture.
  const start = await gutterCellCenter(page, 4);
  const end = await gutterCellCenter(page, 8);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });

  await expect(readout).toBeVisible();
  await expect(readout).toHaveText("Lines 4–8");

  await page.screenshot({ path: testInfo.outputPath("active-selection.png") });

  await page.mouse.up();
  await expect(readout).toHaveCount(0);
});

test("dismissing the composer clears the line-selection highlight", async ({ daemon, page }) => {
  // Opening the composer from the gutter + selects the line (the library highlights
  // it amber). Dismissing the composer must clear that highlight — otherwise it
  // lingers on the line after the reviewer moves on.
  await openRangePlan(page, daemon);
  await waitPastSafeModeGrace(page); // Escape is absorbed during the safe-mode grace

  const selectedLineCount = () =>
    page.evaluate(
      () =>
        document.querySelector(".diffview")?.shadowRoot?.querySelectorAll("[data-selected-line]")
          .length ?? 0,
    );

  const plus = await revealGutterPlus(page, 5);
  await plus.click();
  const composer = page.getByRole("dialog", { name: "Add a comment" });
  await expect(composer).toBeVisible();
  expect(await selectedLineCount()).toBeGreaterThan(0);

  // Two-stage Escape: the first blurs the field into the card, the second
  // dismisses the (empty) composer.
  await composerInput(composer).focus();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(composer).toHaveCount(0);

  await expect.poll(selectedLineCount).toBe(0);
});

test("a drag selection renders the selected lines in caret amber, not library-blue", async ({
  daemon,
  page,
}) => {
  // The accent strategy recolors only the comment SELECTION to caret amber (via
  // --diffs-bg-selection-override / --diffs-bg-selection-number-override), while
  // --diffs-modified stays library-blue. The library mixes that override over each
  // selected line's own grey, so this asserts the resolved background reads as
  // amber — warm, not cool — proving the override took effect end to end in the
  // real Chromium build, not just in the static stylesheet.
  await openRangePlan(page, daemon);

  await selectGutterRange(page, 5, 8);

  // Read the computed background of a selected line body and the line-number
  // column from inside the shadow root. Chromium resolves the library's
  // color-mix(in lab, …) to a lab(L a b) triple; the b* axis is the blue↔yellow
  // channel, so amber-over-grey lands b* positive (warm) and library-blue would
  // land b* negative (cool). That sign flip is the falsifiable proof the
  // override resolved to amber, not the library default.
  const axes = await page.evaluate(() => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot ?? null;
    const labB = (el: Element | null): number | null => {
      if (!el) return null;
      const m = getComputedStyle(el as HTMLElement).backgroundColor.match(/-?\d+(?:\.\d+)?/g);
      return m && m.length >= 3 ? Number(m[2]) : null;
    };
    return {
      line: labB(sh?.querySelector("[data-selected-line][data-line]") ?? null),
      number: labB(sh?.querySelector("[data-selected-line][data-column-number]") ?? null),
    };
  });
  // Both the line body and its number column read warm (amber), not cool (blue).
  expect(axes.line).not.toBeNull();
  expect(axes.line as number).toBeGreaterThan(2);
  expect(axes.number).not.toBeNull();
  expect(axes.number as number).toBeGreaterThan(2);
});

// A plan whose fenced code block has a line far wider than the panel, so EXC-729 wraps it
// in a horizontal-scroll card ([data-code-card]). That card collapses the block's rows into a
// single content-column child, which once desynced @pierre/diffs' gutter/content child counts
// and made InteractionManager.renderSelection throw ("gutter and content children dont match")
// — silently killing the drag-selection highlight for the WHOLE view. The gutter mirror
// (codeBlockScroll.ts) rebalances the columns; this proves a drag still highlights, and never
// throws, when an overflowing code-block card is present. Same reflow-stable shape as CODE_PLAN
// (fence at 5–8), so the prose above is at lines 1–3.
const WIDE_CODE_PLAN = `# Wide code selection

Intro prose here.

\`\`\`text
${"const veryLongIdentifierThatRunsWellPastThePanelWidthToForceHorizontalOverflow = ".repeat(8)}0;
short tail line
\`\`\`

Closing prose after the block.
`;

test("a drag selection still highlights when the plan has an overflowing code-block card", async ({
  daemon,
  page,
}) => {
  // The library's selection render throws in a rAF, so it surfaces as an uncaught page error;
  // collect them and assert the specific mismatch never fires.
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await daemon.seed({ plan: WIDE_CODE_PLAN });
  await page.goto("/");
  await planSurface(page);
  await expect(page.getByText("Intro prose here.")).toBeVisible();

  // Precondition: the wide block overflowed and was carded — the exact DOM shape that used to
  // break the selection walk. Without a card present the test would pass vacuously.
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.querySelector(".diffview")?.shadowRoot?.querySelectorAll("[data-code-card]")
            .length ?? 0,
      ),
    )
    .toBeGreaterThan(0);

  const selectedLineCount = () =>
    page.evaluate(
      () =>
        document.querySelector(".diffview")?.shadowRoot?.querySelectorAll("[data-selected-line]")
          .length ?? 0,
    );

  // Drag across the prose above the block: the throw was global (any selection while any card
  // exists), so this range is a faithful trigger, and lines 1–3 are reflow-stable.
  await selectGutterRange(page, 1, 3);

  // The highlight rendered — the bug left it at zero (the library bailed on the throw) — and the
  // column-mismatch error never fired.
  await expect.poll(selectedLineCount).toBeGreaterThan(0);
  expect(pageErrors.filter((m) => /renderSelection|children dont match/.test(m))).toEqual([]);

  // And INSIDE the card. The library's walk skips a card whole, so its rows used to take no
  // band at all — an accepted trade-off until EXC-865 gave both card kinds the same mirror.
  // The fence spans 5–8, so 6–7 is the block's own code.
  await selectGutterRange(page, 6, 7);
  await expect
    .poll(() =>
      page.evaluate(() =>
        [
          ...(document
            .querySelector(".diffview")
            ?.shadowRoot?.querySelectorAll("[data-code-card] > [data-line][data-selected-line]") ??
            []),
        ].map((el) => `${el.getAttribute("data-line")}=${el.getAttribute("data-selected-line")}`),
      ),
    )
    .toEqual(["6=first", "7=last"]);
  expect(pageErrors.filter((m) => /renderSelection|children dont match/.test(m))).toEqual([]);
});

// EXC-1228: a comment anchored INSIDE an overflowing block. Needs a real browser for the
// library's own re-render on an annotation change (a changed annotation set makes its
// partial-render path ineligible, so the content column is replaced wholesale and any card
// with it), the live layout that decides overflow, and the card the two produce together.
//
// Anchored on line 6 — the block's ONLY wide row — so one gesture reaches both halves of the
// fix. Opening the composer selects that row: only the unguarded reading cap keeps it
// reporting overflow, so the block re-cards at all, and only the shared slice puts the
// comment row inside the card that results. On any other line a lost cap would go unnoticed,
// because a sibling wide row would keep the block carded anyway.
test("a comment inside an overflowing code block is drawn inside its card", async ({
  daemon,
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await daemon.seed({ plan: WIDE_CODE_PLAN });
  await page.goto("/");
  await planSurface(page);
  await expect(page.getByText("Intro prose here.")).toBeVisible();

  const shadowCount = (selector: string) =>
    page.evaluate(
      (s) => document.querySelector(".diffview")?.shadowRoot?.querySelectorAll(s).length ?? -1,
      selector,
    );
  const contentScrollWidth = () =>
    page.evaluate(
      () =>
        (
          document
            .querySelector(".diffview")
            ?.shadowRoot?.querySelector("[data-content]") as HTMLElement | null
        )?.scrollWidth ?? -1,
    );

  await expect.poll(() => shadowCount("[data-code-card]")).toBe(1);
  const before = await contentScrollWidth();

  await composer(page, 6);

  // Poll the comment row's arrival FIRST: it is the one predicate that is false before the
  // library's re-render and true after, so it bounds every read below it. The card count
  // cannot do that job — its first sample passes against the pre-render DOM too, and the row
  // moves into the card a frame later still, on caret's own MutationObserver.
  await expect.poll(() => shadowCount("[data-code-card] > [data-line-annotation]")).toBe(1);
  // The card survived the composer: uncapped, the selected row reports no overflow and the
  // block never re-cards at all.
  await expect.poll(() => shadowCount("[data-code-card]")).toBe(1);
  await expect.poll(() => shadowCount("[data-content] > [data-line-annotation]")).toBe(0);
  await expect.poll(() => shadowCount("[data-code-card-gutter] > [data-gutter-buffer]")).toBe(1);

  // Both failures, stated as what a reader sees rather than as a card selector: either one
  // stretches the surface toward the widest line. Exact equality is deliberate — scrollWidth
  // is an integer read twice off one page at one viewport, and a stranded comment row moves
  // it by only ~19px, which any tolerance wide enough to feel safe would wave through.
  await expect.poll(contentScrollWidth).toBe(before);
  expect(pageErrors.filter((m) => /renderSelection|children dont match/.test(m))).toEqual([]);
});

// EXC-1228 follow-up: the two geometry invariants the card's comment row has to hold, both
// of which only an engine can answer because both are the library's own resolved layout —
// @pierre/diffs sizes [data-annotation-content] for ITS scrollport (a definite width of the
// whole content column, and a sticky offset clearing the gutter), and the card is a narrower
// scrollport nested inside that one.
//
// Driven at a NARROW viewport on purpose. The card is capped at --caret-read-max and inset
// from the column by --caret-card-inset a side, so above a column of roughly
// 720 + 2 x 12 = 744px the cap makes the two widths coincide and a violation hides. Every
// other spec in this file runs full-width, which is exactly where this cannot be seen.
test("a comment inside a code card is never wider than the card, and starts at its edge", async ({
  daemon,
  page,
}) => {
  await page.setViewportSize({ width: 700, height: 800 });
  await daemon.seed({ plan: WIDE_CODE_PLAN });
  await page.goto("/");
  await planSurface(page);
  await expect(page.getByText("Intro prose here.")).toBeVisible();
  await composer(page, 6);

  const geometry = () =>
    page.evaluate(() => {
      const sh = document.querySelector(".diffview")?.shadowRoot ?? null;
      const card = sh?.querySelector("[data-code-card]") as HTMLElement | null;
      const comment = card?.querySelector("[data-annotation-content]") as HTMLElement | null;
      if (card === null || comment === null || card === undefined || comment === undefined) {
        return null;
      }
      const style = getComputedStyle(card);
      return {
        cardInner:
          card.clientWidth -
          Number.parseFloat(style.paddingInlineStart) -
          Number.parseFloat(style.paddingInlineEnd),
        commentWidth: comment.getBoundingClientRect().width,
        cardX: card.getBoundingClientRect().x,
        commentX: comment.getBoundingClientRect().x,
      };
    });

  await expect.poll(async () => (await geometry()) !== null).toBe(true);
  const box = await geometry();

  // Wider than the card and the card's own scrollWidth exceeds its clientWidth forever, so
  // the keep-or-retire branch reads permanent overflow and the block can never retire — a
  // phantom scroll range and an always-visible scrollbar on any commented block.
  expect(box?.commentWidth).toBeLessThanOrEqual(box?.cardInner ?? 0);

  // And it starts at the card's own edge. The library's sticky offset clears a gutter that
  // sits outside this scrollport, so left unzeroed it indents the composer by the gutter's
  // width relative to every code line in its own card.
  expect(box?.commentX).toBeCloseTo(box?.cardX ?? -1, 0);
});

// EXC-1145: the two cards a rendered plan puts in front of a reader — the table's
// (EXC-1136) and the fenced block's — must float at the same height, or the page reads as
// two elevation languages rather than as one family. The block has TWO paint paths to the
// table's one: an overflowing block is a single [data-code-card] box that takes the shadow
// the way the table card does, while a FITTING block gets no card element at all and every
// row carries the lift itself. Only an engine can say those two produce the same picture,
// and only an engine resolves light-dark() at all — so this plan carries a table, a fitting
// fence and an overflowing fence together, and the probe runs under both schemes.
//
// The sheet's own declarations are pinned in coreStyles.test.ts; what is claimed here is
// that they reach the screen as one elevation.
const CARD_FAMILY_PLAN = `# Card family

| Component | Status |
| --- | --- |
| cache | warm |
| queue | cold |

A fitting fence, whose rows never earn a card:

\`\`\`text
fits inside the panel
so does this one
\`\`\`

An overflowing fence, which codeBlockScroll.ts wraps in one:

\`\`\`text
${"const veryLongIdentifierThatRunsWellPastThePanelWidthToForceHorizontalOverflow = ".repeat(8)}0;
short tail line
\`\`\`

Closing prose below both blocks.
`;

// The three surfaces, read from the live cascade. The two cards are boxes, so they are read
// whole; a fitting block is rows, so its fill and lift come off an INTERIOR row and its
// rounding off the block's own first row. Interior matters: codeBlocks.ts tags every row of
// a block data-code-line, fences included, and the first is also data-code-start — so the
// unqualified selector would resolve to the same opening-fence row both reads want to tell
// apart, and a regression that narrowed the lift to the two end rows (the ones already
// carrying bespoke rounding and padding, so the tempting place to scope it) would pass. The
// direct-child combinator is what separates the fitting block from the overflowing one: the
// latter's rows moved inside the card.
async function cardFamily(page: Page) {
  return page.evaluate(() => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot ?? null;
    const at = (selector: string) => sh?.querySelector(selector) as HTMLElement | null;
    const read = (el: HTMLElement | null) => {
      if (!el) return null;
      const s = getComputedStyle(el);
      return { shadow: s.boxShadow, fill: s.backgroundColor, radius: s.borderTopLeftRadius };
    };
    const fittingRow = at(
      "[data-content] > [data-line][data-code-line]:not([data-code-start]):not([data-code-end])",
    );
    return {
      table: read(at("[data-content] > [data-table-card]")),
      card: read(at("[data-content] > [data-code-card]")),
      fitting: read(fittingRow),
      fittingRadius: read(at("[data-content] > [data-line][data-code-start]"))?.radius ?? null,
      fittingLine: Number(fittingRow?.getAttribute("data-line") ?? Number.NaN),
      // The row's OWN centre, not the view's: a code row is inset and capped at
      // --caret-read-max, so on a wide viewport the view's horizontal centre lands past the
      // row's right edge and a pointermove there hits the container instead. (A prose row
      // spans the content column, which is why the hover tests above can use the view's.)
      fittingCentreX: fittingRow
        ? fittingRow.getBoundingClientRect().x + fittingRow.getBoundingClientRect().width / 2
        : Number.NaN,
    };
  });
}

test("the table card and both of the code block's paint paths float as one family", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: CARD_FAMILY_PLAN });
  await page.goto("/");
  await planSurface(page);
  await expect(page.getByText("Closing prose below both blocks.")).toBeVisible();

  // The gutter still labels the overflowing block one number per row (EXC-729's mirror), so
  // a paint change cannot quietly cost the block its line numbers — the acceptance criterion
  // the issue names, on the one fixture that carries a carded block AND a table.
  const gutter = await gridCounts(page);
  expect(gutter.rows).toBeGreaterThan(0);
  expect(gutter.numbers).toBe(gutter.rows);

  // Precondition: all three surfaces are on the page, and the code rows the loop reads are
  // the ones the fitting fence owns. Without the card the overflow path would be absent and
  // the family claim would cover two thirds of itself; these counts are also the barrier the
  // loop re-asserts after each scheme flip.
  const codeCards = page.locator(".diffview [data-content] > [data-code-card]");
  const codeRows = page.locator(".diffview [data-content] > [data-line][data-code-line]");
  await expect(codeCards).toHaveCount(1);
  const fittingRowCount = await codeRows.count();
  expect(fittingRowCount).toBeGreaterThan(2);

  // The scheme flips below are the point of this test, and caret runs every appearance
  // change as a whole-page wipe (EXC-730) — document.startViewTransition replaces the live
  // page with root-level snapshots for 0.45s, which no pointer can reach through and no
  // mutation observer can see. withWipe() degrades to an instant swap under reduced motion,
  // so asking for it here is the supported way to flip a scheme without the wipe in front
  // of it. The wipe has its own coverage; what is under test here is what it wipes TO.
  await page.emulateMedia({ reducedMotion: "reduce" });

  const seen: string[] = [];
  for (const scheme of ["dark", "light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expect(page.locator("html")).toHaveAttribute("data-theme", scheme);
    // Wait for the re-theme's own output, not for a quiet period. A scheme flip re-forces the
    // highlighter (DiffPlanView's readerOptions are reactive on themeId), which re-syncs the
    // view and re-runs the tagging pass — so the rows below are torn down and rebuilt. The
    // library sets data-hovered off its own pointermove, so a pointer parked before that
    // rebuild lands on a row that no longer exists and never fires again. These two counts
    // are what the pass restores, so they are what says it finished.
    await expect(codeCards).toHaveCount(1);
    await expect(codeRows).toHaveCount(fittingRowCount);

    const family = await cardFamily(page);
    expect(family.table, "table card").not.toBeNull();
    expect(family.card, "code card").not.toBeNull();
    expect(family.fitting, "fitting code row").not.toBeNull();
    const table = family.table as NonNullable<typeof family.table>;
    const card = family.card as NonNullable<typeof family.card>;
    const fitting = family.fitting as NonNullable<typeof family.fitting>;

    // One elevation across all three. Non-"none" first, so this cannot pass by all three
    // having no shadow at all.
    expect(table.shadow, scheme).not.toBe("none");
    expect(card.shadow, scheme).toBe(table.shadow);
    expect(fitting.shadow, scheme).toBe(table.shadow);

    // And the rest of the panel look the elevation joins: one fill, one radius.
    expect(table.fill, scheme).not.toBe("rgba(0, 0, 0, 0)");
    expect(card.fill, scheme).toBe(table.fill);
    expect(fitting.fill, scheme).toBe(table.fill);
    expect(Number.parseFloat(table.radius)).toBeGreaterThan(0);
    expect(card.radius, scheme).toBe(table.radius);
    expect(family.fittingRadius, scheme).toBe(table.radius);
    // The rounding hangs off the block's END rows only, so the interior row read above meets
    // no corner — the same shape an interior table row has.
    expect(fitting.radius, scheme).toBe("0px");

    // A hovered fitting row keeps the lift. Its band rule sets box-shadow to paint the
    // gutter→content seam strip and outranks the base row rule, and box-shadow does not
    // cascade additively — so without the lift restated there the row would silently drop
    // to flat under the pointer. The resting value must still be a substring: same lift,
    // with the seam strip in front of it.
    const y = await lineCenterY(page, family.fittingLine);
    await page.mouse.move(family.fittingCentreX, y);
    await expect(
      page.locator(`.diffview [data-content] [data-line="${family.fittingLine}"][data-hovered]`),
    ).toHaveCount(1);
    const hovered = (await cardFamily(page)).fitting as NonNullable<typeof family.fitting>;
    expect(hovered.shadow, scheme).toContain(fitting.shadow);
    expect(hovered.shadow, scheme).toMatch(SEAM_STRIP);

    // Un-hover, and prove it took: the next iteration's resting read depends on it, and
    // without this a stuck hover fails as an elevation mismatch instead of naming itself.
    await page.mouse.move(0, 0);
    await expect(page.locator(".diffview [data-hovered]")).toHaveCount(0);

    seen.push(table.shadow);
  }

  // light-dark() actually resolved, in both directions. The lift's alpha splits by scheme
  // (the same black reads much heavier over a light ground), so a value that never moved
  // would mean the function fell back rather than resolving — and the round trip back to
  // dark proves the first reading was not a one-way stamp.
  expect(seen[1]).not.toBe(seen[0]);
  expect(seen[2]).toBe(seen[0]);
});

// EXC-1228: the amber band on a selected code row runs to the same right edge as the band
// on a selected PROSE row. Needs an engine: a code row has to be stopped from stretching
// the content column's track — otherwise its block reports no overflow and the surface
// widens to the longest line — and the question here is whether whatever stops it also
// shortens the band, which is resolved layout rather than a declaration.
//
// The two edges MATCHING is the whole claim. A band measured only against itself passes
// while ending short of the panel it sits in, which is what reads as a rendering fault.
// CARD_FAMILY_PLAN because its fitting fence (11-12) never earns a card, so its rows stay
// direct children of the content column — the state a reader meets on most code blocks.
test("a selected code row's band ends where a selected prose row's does", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: CARD_FAMILY_PLAN });
  await page.goto("/");
  await planSurface(page);
  await expect(page.getByText("Closing prose below both blocks.")).toBeVisible();

  const bandRight = () =>
    page.evaluate(() => {
      const sh = document.querySelector(".diffview")?.shadowRoot ?? null;
      const row = sh?.querySelector("[data-content] > [data-line][data-selected-line]");
      return row == null ? null : row.getBoundingClientRect().right;
    });

  // Line 8 is the prose above the fitting fence; 11 is that fence's first code line.
  await selectGutterRange(page, 8, 8);
  await expect.poll(bandRight).not.toBeNull();
  const prose = await bandRight();

  await selectGutterRange(page, 11, 11);
  await expect.poll(bandRight).not.toBeNull();
  expect(await bandRight()).toBeCloseTo(prose ?? -1, 0);
});

// A plan with a fenced code block: heading (1), blank (2), prose (3), blank (4),
// opening fence (5), two code lines (6–7), closing fence (8), blank (9), prose (10).
const CODE_PLAN = `# Code Plan

Some intro prose here.

\`\`\`ts
const x: number = compute();
return x + 1;
\`\`\`

Closing prose after the block.
`;

test("renders a fenced code block as a tagged, darker panel on its own rows (EXC-692)", async ({
  daemon,
  page,
}) => {
  // The block reads as its own element: caret tags the content rows inside the
  // fence (data-code-line, plus -start/-end on the first/last) and the panel CSS
  // fills them one step darker than the diff surface. This proves the shadow-DOM
  // tagging + the fill resolve end to end in the real Chromium build, not just in
  // the static stylesheet — and that the block's line span (5–8) is respected while
  // prose rows are left alone.
  await daemon.seed({ plan: CODE_PLAN });
  await page.goto("/");
  await planSurface(page);
  await expect(page.getByText("Some intro prose here.")).toBeVisible();

  const readPanel = () =>
    page.evaluate(() => {
      const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot ?? null;
      const row = (n: number) =>
        (sh?.querySelector(`[data-content] > [data-line="${n}"]`) as HTMLElement | null) ?? null;
      const has = (n: number, a: string) => row(n)?.hasAttribute(a) ?? false;
      const bg = (n: number) => {
        const el = row(n);
        return el ? getComputedStyle(el).backgroundColor : null;
      };
      const width = (n: number) => row(n)?.getBoundingClientRect().width ?? null;
      const tokenIn = (n: number, attr: string) =>
        (sh?.querySelector(
          `[data-content] > [data-line="${n}"] [${attr}]`,
        ) as HTMLElement | null) ?? null;
      const lang = tokenIn(5, "data-code-lang"); // opening fence "```ts" → language token
      const openFence = tokenIn(5, "data-code-fence"); // opening fence "```" → markers
      const fence = tokenIn(8, "data-code-fence"); // closing fence "```" → markers
      return {
        codeLines: [5, 6, 7, 8].map((n) => has(n, "data-code-line")),
        start: has(5, "data-code-start"),
        end: has(8, "data-code-end"),
        interiorStartEnd: has(6, "data-code-start") || has(7, "data-code-end"),
        proseIsCode: has(3, "data-code-line"),
        codeBg: bg(6),
        proseBg: bg(3),
        codeWidth: width(6),
        proseWidth: width(3),
        langText: lang?.textContent ?? null,
        langTop: lang ? getComputedStyle(lang).top : null,
        fenceText: fence?.textContent ?? null,
        fenceTop: fence ? getComputedStyle(fence).top : null,
        openFenceText: openFence?.textContent ?? null,
        openFenceBg: openFence ? getComputedStyle(openFence).backgroundColor : null,
        fenceBg: fence ? getComputedStyle(fence).backgroundColor : null,
        fenceRadius: fence ? getComputedStyle(fence).borderTopLeftRadius : null,
      };
    });

  // The decoration lands after the library paints and the fenced-code rehighlight
  // repaints the rows, so poll until every code row is tagged and the fence line's
  // language token has been split out (it only exists once the fence is tokenized).
  await expect
    .poll(async () => {
      const p = await readPanel();
      return p.codeLines.every(Boolean) && p.langText === "ts";
    })
    .toBe(true);

  const panel = await readPanel();
  // Only the block's boundary rows carry the corner markers; prose is untouched.
  expect(panel.start).toBe(true);
  expect(panel.end).toBe(true);
  expect(panel.interiorStartEnd).toBe(false);
  expect(panel.proseIsCode).toBe(false);
  // The panel fill resolved darker than a prose row's background, end to end.
  expect(panel.codeBg).not.toBeNull();
  expect(panel.proseBg).not.toBeNull();
  expect(panel.codeBg).not.toBe(panel.proseBg);
  // The panel is a contained card: its width is capped (~720px) and, on this wide
  // viewport, measurably narrower than a full-width prose row.
  expect(panel.codeWidth).not.toBeNull();
  expect(panel.proseWidth).not.toBeNull();
  expect(panel.codeWidth as number).toBeLessThanOrEqual(730);
  expect(panel.codeWidth as number).toBeLessThan(panel.proseWidth as number);
  // The fence-line tokens are shifted toward their row's vertical center (EXC-692):
  // the language tag ("ts") moves up (negative used `top`), the closing markers
  // ("```") move down (positive used `top`). position: relative resolves `top` to a
  // px length; a static glyph would report `auto`.
  expect(panel.langText).toBe("ts");
  expect(Number.parseFloat(panel.langTop as string)).toBeLessThan(0);
  expect(panel.fenceText?.trim()).toBe("```");
  expect(Number.parseFloat(panel.fenceTop as string)).toBeGreaterThan(0);
  // The delimiters carry NO chip. EXC-869 gave them one and it was the chip family's one
  // member that never read as one: a chip tints a span of CONTENT, and a fence row is all
  // marker and no content, so the tint drew a small empty pill inside the panel. What the
  // markers keep is their ink and the centering nudges above; the panel is what says where
  // the block starts and stops.
  expect(panel.openFenceText?.trim()).toBe("```");
  expect(panel.fenceBg).toBe("rgba(0, 0, 0, 0)");
  expect(panel.openFenceBg).toBe(panel.fenceBg);
  expect(Number.parseFloat(panel.fenceRadius as string)).toBe(0);
});

test("hovering a code block reveals a copy button that copies the code (EXC-692)", async ({
  daemon,
  page,
}) => {
  // The copy affordance: hovering a fenced block shows a button at its top-right;
  // clicking it writes the block's code (fences stripped) to the clipboard and
  // confirms with a checkmark that reverts. Proves the hover hit-test, the clipboard
  // write, and the icon swap resolve end to end in the real browser.
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await daemon.seed({ plan: CODE_PLAN });
  await page.goto("/");
  await expect(page.getByText("Some intro prose here.")).toBeVisible();

  const copy = page.getByRole("button", { name: "Copy code" });
  await expect(copy).toHaveCount(0);

  // The centre of line 6 — inside the fence, not on it.
  const point = await page.evaluate(() => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot ?? null;
    const row = sh?.querySelector('[data-content] > [data-line="6"]') as HTMLElement | null;
    const r = row?.getBoundingClientRect();
    return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
  });
  expect(point).not.toBeNull();
  await page.mouse.move((point as { x: number }).x, (point as { y: number }).y);
  await expect(copy).toBeVisible();

  await copy.click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  // The fence lines are stripped from what is written.
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toBe("const x: number = compute();\nreturn x + 1;");
  await expect(page.getByRole("button", { name: "Copy code" })).toBeVisible();
});

// Two distinct fenced blocks separated by prose, with trailing filler for scroll room.
// Block A and block B carry different code so the clipboard proves which block the copy
// button targets after the plan scrolls under a stationary cursor (EXC-836).
const SCROLL_COPY_PLAN = `# Scroll Copy Plan

Intro prose above the first block.

\`\`\`ts
const a = 1;
const aa = 2;
\`\`\`

Middle prose between the blocks.

\`\`\`ts
const b = 3;
const bb = 4;
\`\`\`

Closing prose after the second block.

${Array.from({ length: 20 }, (_, i) => `Filler line ${i + 1} giving the surface room to scroll.`).join("\n\n")}
`;

// The viewport center of the shadow row whose text contains `needle`, or null when no
// such row is rendered. Used to place the cursor and to compute how far to scroll a row
// under it.
async function rowPoint(page: Page, needle: string): Promise<{ x: number; y: number } | null> {
  return page.evaluate((text) => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot ?? null;
    const rows = sh?.querySelectorAll<HTMLElement>("[data-content] > [data-line]") ?? [];
    for (const row of rows) {
      if ((row.textContent ?? "").includes(text)) {
        const r = row.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }
    }
    return null;
  }, needle);
}

// The `data-line` of the content row the library currently flags `data-hovered` (its
// row highlight), or null when nothing is hovered. The library sets `data-hovered` off
// its own pointermove, not CSS :hover, so this is what a scroll under a still cursor
// must keep in sync.
async function hoveredLineNo(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot ?? null;
    const row = sh?.querySelector("[data-content] > [data-line][data-hovered]");
    return row?.getAttribute("data-line") ?? null;
  });
}

// The `data-line` of the content row under a viewport point — the same shadow-root
// hit-test the fix re-fires on scroll, so the row this reports is exactly the one the
// re-fired pointermove should hover.
async function lineNoAt(page: Page, x: number, y: number): Promise<string | null> {
  return page.evaluate(
    ({ x, y }) => {
      const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot ?? null;
      const el = sh?.elementFromPoint(x, y) ?? null;
      const row = el?.closest("[data-line]") ?? null;
      return row?.getAttribute("data-line") ?? null;
    },
    { x, y },
  );
}

test("the copy button follows the block under a stationary cursor as the plan scrolls (EXC-836)", async ({
  daemon,
  page,
}) => {
  // CSS :hover doesn't re-fire when the container scrolls under a still pointer, so the
  // copy button used to stay glued to the block that scrolled away. It must instead
  // re-anchor to the element now under the pointer: hide over prose, and re-appear
  // targeting the new block when another block scrolls under the cursor.
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await daemon.seed({ plan: SCROLL_COPY_PLAN });
  await page.goto("/");
  await expect(page.getByText("Intro prose above the first block.")).toBeVisible();

  const copy = page.getByRole("button", { name: "Copy code" });
  // Scroll with a real mouse wheel at the stationary pointer — the true user gesture.
  // NOT `el.scrollTop +=`, which fires a scroll event without proving a wheel over the
  // plan actually routes to `.diff-plan`; wheel deltaY maps 1:1 onto scrollTop here.
  const wheelBy = (dy: number) => page.mouse.wheel(0, dy);

  // Park the cursor on block A's interior code line.
  const cursor = await rowPoint(page, "const a = 1;");
  expect(cursor).not.toBeNull();
  await page.mouse.move(cursor!.x, cursor!.y);
  await expect(copy).toBeVisible();

  // Scroll the middle prose under the stationary cursor: no block is there, so the
  // button hides — the behavior CSS :hover alone could never produce on scroll.
  const prose = await rowPoint(page, "Middle prose between the blocks.");
  expect(prose).not.toBeNull();
  await wheelBy(prose!.y - cursor!.y);
  await expect(copy).toHaveCount(0);

  // Scroll block B under the same stationary cursor: the button re-anchors to it.
  const blockB = await rowPoint(page, "const b = 3;");
  expect(blockB).not.toBeNull();
  await wheelBy(blockB!.y - cursor!.y);
  await expect(copy).toBeVisible();

  // Clicking the re-anchored button copies block B's code — proof it followed to the
  // block now under the pointer, not the one that was there before the scroll.
  await copy.click();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toBe("const b = 3;\nconst bb = 4;");
});

test("the row highlight and gutter + follow the row under a stationary cursor as the plan scrolls (EXC-836)", async ({
  daemon,
  page,
}) => {
  // The library drives the row highlight (data-hovered) and the gutter + off its own
  // pointermove, not CSS :hover, and has no scroll listener — so scrolling the plan
  // under a still cursor used to leave both glued to the row that scrolled away. They
  // must instead follow the row now under the pointer, with the mouse never moving.
  await openTallPlan(page, daemon);

  // Park the cursor on a specific content row; the library highlights it and mounts
  // the + on it.
  const cursor = await rowPoint(page, "Line 5 of the plan body");
  expect(cursor).not.toBeNull();
  await page.mouse.move(cursor!.x, cursor!.y);
  const before = await lineNoAt(page, cursor!.x, cursor!.y);
  expect(before).not.toBeNull();
  await expect.poll(() => hoveredLineNo(page)).toBe(before);
  await expect(page.locator(".diffview [data-utility-button]")).toBeVisible();

  // Wheel the plan several rows down under the STILL cursor — a real wheel (not
  // scrollTop=), so this proves the true gesture routes to .diff-plan.
  await page.mouse.wheel(0, 200);

  // A different content row now sits under the unmoved cursor.
  await expect.poll(() => lineNoAt(page, cursor!.x, cursor!.y)).not.toBe(before);
  const after = await lineNoAt(page, cursor!.x, cursor!.y);
  expect(after).not.toBeNull();

  // The fix: the highlight AND the + re-evaluate on scroll and follow to that row,
  // with no pointer movement. (RED before the fix: both stay on `before`.)
  await expect.poll(() => hoveredLineNo(page)).toBe(after);
  // The + rode with the hover: its vertical center now sits within a row's height of
  // the cursor, not left behind on the row that scrolled away.
  const plusY = await page.locator(".diffview [data-utility-button]").evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.y + r.height / 2;
  });
  expect(Math.abs(plusY - cursor!.y)).toBeLessThan(40);
});

test("numeric chrome renders with tabular figures end to end", async ({ daemon, page }) => {
  // Tabular figures keep columns of digits aligned. The bridge sets
  // --diffs-font-features to the 'tnum' tag, which the library feeds into
  // font-feature-settings on its :host, so it inherits down to the line-number
  // column; caret's own numeric chrome gets the same via the .metric atom's
  // font-variant-numeric. Both are computed-style facts in the real Chromium
  // build, not just static stylesheet text.
  await openRangePlan(page, daemon);

  // A diff line-number cell resolves font-feature-settings to the tabular tag.
  const lineNumberFeatures = await page.evaluate(() => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot ?? null;
    const cell = sh?.querySelector("[data-line-number-content]") ?? null;
    return cell ? getComputedStyle(cell as HTMLElement).fontFeatureSettings : null;
  });
  expect(lineNumberFeatures).toContain('"tnum"');

  // The composer's 'Lines N–M' label is a caret numeric chrome surface; through
  // the .metric atom it resolves font-variant-numeric to tabular-nums.
  await selectGutterRange(page, 5, 8);
  const plus = page.locator(".diffview [data-utility-button]");
  await expect(plus).toBeVisible();
  await plus.click();
  const composer = page.getByRole("dialog", { name: "Add a comment" });
  await expect(composer.getByText("Lines 5–8")).toBeVisible();
  const labelVariant = await composer
    .locator(".label")
    .evaluate((el) => getComputedStyle(el).fontVariantNumeric);
  expect(labelVariant).toContain("tabular-nums");
});

test("dismissing an empty composer with Escape leaves no residue", async ({ daemon, page }) => {
  // An empty composer dismissed produces no draft — only typed text is retained
  // as a scratch (see the scratch-draft tests below). Safe Mode's grace window
  // would otherwise swallow the first keystroke (the Escape) as an accidental
  // interruption.
  const { id, composer } = await openComposerOnLine3(page, daemon);
  await expect(composer).toBeVisible();
  // Two-stage Escape: the first blurs into the card, the second dismisses. An
  // empty box has nothing to keep, so dismissing leaves no residue.
  await composerInput(composer).focus();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  await expect(composer).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Resume unsent comment" })).toHaveCount(0);
  await awaitAnnotationCount(daemon, id, 0);
});

// ----- Scratch drafts: an unsubmitted composer dismissed with text is retained
// as a returnable "Resume" marker (EXC-634). Distinct from a committed "Draft"
// annotation: a scratch was never added to the working copy. -----

/** The Resume marker the host renders for a retained scratch draft. */
function scratchMarker(page: Page): Locator {
  return page.getByRole("button", { name: "Resume unsent comment" });
}

/** Discard `composer`'s draft, confirm the discard (EXC-749), and assert
 * nothing of it survives: the composer, the Resume marker, and the
 * persisted scratch are all gone. */
async function discardScratchAndExpectGone(
  page: Page,
  daemon: Daemon,
  id: string,
  composer: Locator,
): Promise<void> {
  await composer.getByRole("button", { name: "Discard" }).click();
  await discardConfirm(page).getByRole("button", { name: "Discard" }).click();
  await expect(composer).toHaveCount(0);
  await expect(scratchMarker(page)).toHaveCount(0);
  await awaitScratchCount(daemon, id, 0);
}

test("Keep for later retains a returnable Resume marker", async ({ daemon, page }) => {
  const { id, composer } = await openComposerOnLine3(page, daemon);
  await expect(composer).toBeVisible();
  const textarea = composerInput(composer);
  await textarea.fill("half a thought to finish later");
  await composer.getByRole("button", { name: "Keep for later" }).click();

  // The marker reads "Resume" (an action), never "Draft" (the committed-annotation
  // state), so the two never look the same.
  await expect(composer).toHaveCount(0);
  const marker = scratchMarker(page);
  await expect(marker).toBeVisible();
  await expect(marker).toContainText("Resume");
  await expect(marker).not.toContainText("Draft");
  await expect(marker).toContainText("half a thought to finish later");

  // Nothing is persisted — a scratch is in-memory only, not a created annotation.
  await awaitAnnotationCount(daemon, id, 0);
});

test("the Discard button discards a typed draft, leaving no Resume marker", async ({
  daemon,
  page,
}) => {
  const { id, composer } = await openComposerOnLine3(page, daemon);
  await composerInput(composer).fill("drop this via the button");
  await discardScratchAndExpectGone(page, daemon, id, composer);
});

test("canceling a Discard keeps the composer open", async ({ daemon, page }) => {
  // The confirmation's whole point: an accidental Discard is recoverable.
  // Canceling backs out and leaves the composer (and its draft) in place.
  const { composer } = await openComposerOnLine3(page, daemon);
  await composerInput(composer).fill("do not lose me");
  await composer.getByRole("button", { name: "Discard" }).click();

  await expect(discardConfirm(page)).toBeVisible();
  await discardConfirm(page).getByRole("button", { name: "Keep editing" }).click();
  await expect(discardConfirm(page)).toHaveCount(0);
  await expect(composer).toBeVisible();
});

test("resuming a kept scratch then Discarding removes the marker and un-persists it", async ({
  daemon,
  page,
}) => {
  // Keep for later persists a scratch; resuming consumes it back into the
  // composer; Discarding then drops it for good — the persisted scratch is
  // removed, not merely hidden.
  const { id, composer } = await openComposerOnLine3(page, daemon);
  await composerInput(composer).fill("keep then change my mind");
  await composer.getByRole("button", { name: "Keep for later" }).click();

  const marker = scratchMarker(page);
  await expect(marker).toBeVisible();
  await awaitScratchCount(daemon, id, 1);

  await marker.click();
  await expect(composer).toBeVisible();
  await discardScratchAndExpectGone(page, daemon, id, composer);
});

test("clicking the Resume marker reopens the composer with the text restored", async ({
  daemon,
  page,
}) => {
  const { composer } = await openComposerOnLine3(page, daemon);
  await composerInput(composer).fill("restore this exactly");
  await composer.getByRole("button", { name: "Keep for later" }).click();

  const marker = scratchMarker(page);
  await expect(marker).toBeVisible();
  await marker.click();

  // The marker is consumed: it moved back into the composer rather than duplicating.
  await expect(composer).toBeVisible();
  await expect(composerInput(composer)).toHaveText("restore this exactly");
  await expect(scratchMarker(page)).toHaveCount(0);
});

test("a resumed scratch can be completed into a persisted annotation", async ({ daemon, page }) => {
  const { id, composer } = await openComposerOnLine3(page, daemon);
  await composerInput(composer).fill("start it");
  await composer.getByRole("button", { name: "Keep for later" }).click();

  await scratchMarker(page).click();
  await expect(composer).toBeVisible();
  const textarea = composerInput(composer);
  await textarea.fill("start it, then finish it");
  await composer.getByRole("button", { name: "Comment" }).click();

  await expect(composer).toHaveCount(0);
  await expect(scratchMarker(page)).toHaveCount(0);
  await expectSingleAnnotation(daemon, id, {
    startLine: 3,
    endLine: 3,
    comment: "start it, then finish it",
  });
});

test("opening a different range retains the in-progress text as a scratch", async ({
  daemon,
  page,
}) => {
  // The "never lose text" guarantee must hold when the reviewer changes their
  // mind mid-comment: typing on line 3, then clicking line 7, must retain the
  // line-3 text as a scratch rather than dropping it — the host retains before it
  // opens the new range.
  await openRangePlan(page, daemon);
  await waitPastSafeModeGrace(page);

  const composer = await openComposerOnRangeLine3(page);
  await composerInput(composer).fill("started on line 3");

  // Switch to line 7 ("Body line 3") without dismissing the line-3 composer.
  await page.getByText("Body line 3 content here.").click();
  await expect(composer.getByText("Line 7")).toBeVisible();

  const marker = scratchMarker(page);
  await expect(marker).toBeVisible();
  await expect(marker).toContainText("started on line 3");
  await marker.click();
  // Scope to the range label: the resumed editor body also contains "line 3", so
  // a bare getByText would match both it and the label.
  await expect(composer.locator(".label")).toHaveText("Line 3");
  await expect(composerInput(composer)).toHaveText("started on line 3");
});

test("opening a different range starts the new composer empty, not seeded with the prior draft", async ({
  daemon,
  page,
}) => {
  // Regression: switching lines mid-draft must open a CLEAN composer at the new
  // line. Keeping the prior line's text as a Resume marker is correct, but that
  // text must not bleed into the fresh composer — each range is its own draft.
  await openRangePlan(page, daemon);
  await waitPastSafeModeGrace(page);

  const composer = await openComposerOnRangeLine3(page);
  await composerInput(composer).fill("started on line 3");

  // Switch to line 7 without dismissing: the new composer opens empty.
  await page.getByText("Body line 3 content here.").click();
  await expect(composer.getByText("Line 7")).toBeVisible();
  await expect(composerInput(composer)).not.toContainText("started on line 3");

  await expect(scratchMarker(page)).toContainText("started on line 3");
});

test("scratch drafts clear when a new plan version arrives", async ({ daemon, page }) => {
  // A scratch's anchor belongs to the version it was typed against; a new version
  // must drop it so it never resumes onto text it was not written for. This
  // mirrors the existing discard-on-content-change guard for the open composer.
  const { id, composer } = await openComposerOnLine3(page, daemon);
  await composerInput(composer).fill("anchored to v1");
  await composer.getByRole("button", { name: "Keep for later" }).click();
  await expect(scratchMarker(page)).toBeVisible();

  // A new version supersedes the current plan text in place.
  await daemon.addVersion(
    id,
    "# Widget Cache Refactor v2\n\nA wholly different second version body.\n",
  );

  await expect(page.getByText("A wholly different second version body.")).toBeVisible();
  await expect(scratchMarker(page)).toHaveCount(0);
});

// ----- Unsent scratches surfaced in the Request Changes dialog (EXC-635) -----
// The dialog lists unsent composer drafts so the reviewer consciously Saves
// (graduates into the sent feedback) or Discards each. An unsaved scratch is
// never silently sent.

/** Create a scratch on `line` by typing into the composer and dismissing it,
 * then open the Request Changes dialog. Returns the dialog locator. */
async function scratchThenOpenDialog(page: Page, line: number, text: string): Promise<Locator> {
  const plus = await revealGutterPlus(page, line);
  await plus.click();
  const composer = page.getByRole("dialog", { name: "Add a comment" });
  await composerInput(composer).fill(text);
  await composer.getByRole("button", { name: "Keep for later" }).click();
  await expect(scratchMarker(page)).toBeVisible();

  await page.getByRole("button", { name: "Request changes" }).click();
  const dialog = page.getByRole("dialog", { name: "Send the plan back for revision" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("the Request Changes dialog lists an unsent scratch, collapsed and uncounted", async ({
  daemon,
  page,
}) => {
  const id = await openDefaultPlan(page, daemon);
  await waitPastSafeModeGrace(page);

  const dialog = await scratchThenOpenDialog(page, 3, "an unsent thought on line 3");

  // The scratch is listed under "Unsent comments", collapsed (its text shows in
  // the trigger's one-line snippet, the full body behind the collapsed disclosure).
  const section = dialog.locator(".scratches");
  await expect(section).toBeVisible();
  await expect(section).toContainText("Unsent comments");
  await expect(unsentRows(dialog)).toHaveCount(1);
  await expect(section).toContainText("an unsent thought on line 3");

  // It does not count as a committed comment: the empty-state still shows and
  // the Send button stays disabled (nothing is committed to send).
  await expect(dialog.locator(".summary.empty")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Send for revision" })).toBeDisabled();

  // And nothing is persisted while it sits unsent.
  await awaitAnnotationCount(daemon, id, 0);
});

test("Saving a scratch graduates it into the sent feedback", async ({ daemon, page }) => {
  const id = await openDefaultPlan(page, daemon);
  await waitPastSafeModeGrace(page);

  const dialog = await scratchThenOpenDialog(page, 3, "save me into the review");

  // Save it — the action sits outside the collapsed disclosure (EXC-746), so no
  // expand is needed.
  await unsentRows(dialog).getByRole("button", { name: "Save", exact: true }).click();

  await expect(unsentRows(dialog)).toHaveCount(0);
  await expect(dialog.locator(".scratches")).toHaveCount(0);
  await expect(dialog.locator(".summary")).toContainText("1 comment");
  await expect(dialog.locator(".preview pre")).toContainText("save me into the review");

  // Submitting now sends it. It reaches Decision.feedback as a line reference.
  const feedback = await submitForRevision(page, dialog, daemon, id);
  expect(feedback).toContain("Line 3:");
  expect(feedback).toContain("save me into the review");
});

test("Discarding a scratch removes it and never sends it", async ({ daemon, page }) => {
  const id = await openDefaultPlan(page, daemon);
  await waitPastSafeModeGrace(page);

  const dialog = await scratchThenOpenDialog(page, 3, "discard this draft");

  // Discard sits outside the collapsed disclosure (EXC-746), so no expand is needed.
  // It asks to confirm before dropping the draft (EXC-762).
  await unsentRows(dialog).getByRole("button", { name: "Discard", exact: true }).click();
  // The confirm bubble portals to the body (bits-ui Popover, EXC-1110), so it's a
  // page locator rather than a descendant of the dialog element.
  await discardConfirm(page).getByRole("button", { name: "Discard" }).click();

  // The scratch is gone from the dialog, and the underlying Resume marker is gone
  // too — Discard drops it from the review entirely.
  await expect(dialog.locator(".scratches")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(scratchMarker(page)).toHaveCount(0);

  // Nothing was ever persisted.
  await awaitAnnotationCount(daemon, id, 0);
});

test("submitting with an unsaved scratch sends only committed comments", async ({
  daemon,
  page,
}) => {
  // The default: an unsaved scratch is NOT silently included. A general comment
  // makes the submit possible; the scratch left unsent must not reach feedback.
  const id = await openDefaultPlan(page, daemon);
  await waitPastSafeModeGrace(page);

  const dialog = await scratchThenOpenDialog(page, 3, "must not be sent unsaved");

  // Type a general comment and submit, leaving the scratch unsaved.
  await dialog
    .getByRole("textbox", { name: "General comment" })
    .fill("Please revise the cache section.");
  const feedback = await submitForRevision(page, dialog, daemon, id);
  expect(feedback).toContain("Please revise the cache section.");
  expect(feedback).not.toContain("must not be sent unsaved");
});

// ----- Inline annotation cards: collapse/expand + delete (EXC-581) -----

/** Create a single-line annotation on `line` via the gutter, returning once the
 * card for it is on screen. */
async function createAnnotation(page: Page, line: number, comment: string): Promise<void> {
  const plus = await revealGutterPlus(page, line);
  await plus.click();
  const composer = page.getByRole("dialog", { name: "Add a comment" });
  await expect(composer).toBeVisible();
  const input = composerInput(composer);
  await input.fill(comment);
  // Wait for the editor to reflect the text before submitting: CodeMirror applies
  // input asynchronously, so submitting immediately can race the fill under load.
  await expect(input).toContainText(comment);
  await composer.getByRole("button", { name: "Comment" }).click();
  await expect(composer).toHaveCount(0);
}

test("a created annotation shows an inline card that doesn't overlay the code", async ({
  daemon,
  page,
}) => {
  await openDefaultPlan(page, daemon);

  await createAnnotation(page, 3, "Quantify the cold cost.");

  // The new annotation is focused on create, so its card renders expanded with
  // the full comment.
  const card = page.locator("[data-annotation-card]");
  await expect(card).toBeVisible();
  await expect(card.getByText("Quantify the cold cost.")).toBeVisible();

  // It renders inline in the library's annotation row — normal flow (not an
  // absolutely-positioned overlay), projected into a slot wrapper — so it sits
  // between the code lines rather than covering them.
  expect(await card.evaluate((el) => getComputedStyle(el).position)).toBe("static");
  expect(await card.evaluate((el) => el.closest("[data-annotation-slot]") != null)).toBe(true);

  // The rendered-markdown prose reads as sans-serif, not the code column's
  // monospace: the card is projected into the diffs library's monospace
  // annotation row, and slotInto opts the projected node out of --font-mono, so
  // the comment resolves --font-sans (Geist), not Berkeley Mono (EXC-802).
  const commentFont = await card
    .locator(".comment")
    .evaluate((el) => getComputedStyle(el).fontFamily);
  expect(commentFont).toMatch(/^Geist/);
});

test("two comments on the same line render as one ordered thread", async ({ daemon, page }) => {
  await openDefaultPlan(page, daemon);

  // Two comments anchored to the same line. The library reserves one annotation
  // row per line, so both land in that single row — caret frames them as one
  // ordered thread (shared container, count, order cue) rather than two
  // disconnected chips.
  await createAnnotation(page, 3, "Quantify the cold cost.");
  await createAnnotation(page, 3, "And the warm path too.");

  const thread = page.locator(".thread");
  await expect(thread).toHaveCount(1);
  await expect(thread.locator("[data-annotation-card]")).toHaveCount(2);
  await expect(thread.locator(".thread-count")).toHaveText(/2/);
  await expect(thread.locator(".thread-ordinal")).toHaveText(["1", "2"]);
});

test("clicking a line's content opens a comment composer for that line", async ({
  daemon,
  page,
}) => {
  await daemon.seed();
  await page.goto("/");
  await planSurface(page);

  // A plain click on the line's prose (not the gutter, not a link) opens the
  // composer anchored to that line — no need to hit the small hover `+`.
  await page.getByText("This plan reorganizes the widget cache").click();
  const composer = page.getByRole("dialog", { name: "Add a comment" });
  await expect(composer).toBeVisible();
  await expect(composer.getByText("Line 3")).toBeVisible();
});

test("hovering a line body reveals the + and lifts that line's background, scoped to that line", async ({
  daemon,
  page,
}) => {
  // The whole line is the comment target, so the hover affordance must read on the
  // line body — not only at the gutter edge. Hovering anywhere on a line reveals
  // the gutter `+` and lifts that one line's background (the caret-grey
  // --diffs-bg-hover-override). This proves the library applies the lift end to end
  // in the real Chromium build — css-bridge.test.ts only pins the static
  // declaration — and that the lift is scoped to the hovered line, not the view.
  await openRangePlan(page, daemon);

  // At rest — mouse parked off any line — the library renders no gutter `+` at all.
  await page.mouse.move(0, 0);
  const plus = page.locator(".diffview [data-utility-button]");
  await expect(plus).toHaveCount(0);

  // Hover the body of line 3 ("Body line 1") at the view's horizontal centre, well
  // clear of the gutter, to prove the whole line is the hover target.
  const y = await lineCenterY(page, 3);
  const cx = await page
    .locator(PLAN_SURFACE)
    .evaluate((el) => el.getBoundingClientRect().x + el.getBoundingClientRect().width / 2);
  await page.mouse.move(cx, y);

  await expect(plus).toBeVisible();

  // Exactly one line carries the library's hover marker, and its resolved background
  // differs from a resting sibling's — the lift took effect, scoped to that line.
  const bg = await page.evaluate(() => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot ?? null;
    const hovered = Array.from(sh?.querySelectorAll("[data-line][data-hovered]") ?? []);
    const resting = Array.from(sh?.querySelectorAll("[data-line]:not([data-hovered])") ?? []);
    const colorOf = (el: Element | undefined) =>
      el ? getComputedStyle(el as HTMLElement).backgroundColor : null;
    return {
      hoveredCount: hovered.length,
      hoveredBg: colorOf(hovered[0]),
      restingBg: colorOf(resting[0]),
    };
  });
  expect(bg.hoveredCount).toBe(1);
  expect(bg.hoveredBg).not.toBeNull();
  expect(bg.restingBg).not.toBeNull();
  expect(bg.hoveredBg).not.toBe(bg.restingBg);
});

test("text selected on a line is preserved and a click opens no composer", async ({
  daemon,
  page,
}) => {
  // With a selection present (here via Shift+drag, or programmatically as below), a
  // click is copy intent, not a comment-open. SourceView.handleLineClick reads the
  // shadow root's own getSelection() (window.getSelection() can't see into the open
  // shadow root) and the selectionCollapsed guard suppresses the composer. This
  // drives that guard directly — selecting via the same shadow getSelection() the
  // handler reads, then clicking via dispatchEvent so no native mousedown collapses
  // the selection first. (A synthetic mouse drag is too flaky in headless Chromium
  // to select text reliably.) It also pins that the handler reads the shadow
  // selection, not the document one — the subtlety its own comment warns about.
  await openRangePlan(page, daemon);

  // Select the line's prose inside the shadow root — proving it is selectable (copy
  // works; user-select is not suppressed) and seeding the selection the click
  // handler will read.
  const selectedLength = await page.evaluate(() => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot as
      | (ShadowRoot & { getSelection?: () => Selection | null })
      | null;
    if (sh == null) return 0;
    const lineEl = Array.from(sh.querySelectorAll("[data-line]")).find((el) =>
      (el.textContent ?? "").includes("Body line 1 content here."),
    );
    if (lineEl == null) return 0;
    const range = document.createRange();
    range.selectNodeContents(lineEl);
    const sel = sh.getSelection?.() ?? (typeof getSelection === "function" ? getSelection() : null);
    sel?.removeAllRanges();
    sel?.addRange(range);
    return (sel?.toString() ?? "").length;
  });
  expect(selectedLength).toBeGreaterThan(0);

  // A click made while that selection is live opens no composer. dispatchEvent
  // issues the click without a native mousedown, so the selection is still present
  // when the handler reads it.
  await page.getByText("Body line 1 content here.").dispatchEvent("click");
  await expectNoComposerOpens(page);
});

test("an inline card collapses to a chip and expands again", async ({ daemon, page }) => {
  await openDefaultPlan(page, daemon);

  await createAnnotation(page, 3, "Tighten this paragraph.");
  const card = page.locator("[data-annotation-card]");
  await expect(card.locator(".body")).toBeVisible();

  // Collapse: the body's grid row shrinks to zero height (it stays mounted for the
  // reveal, so it goes not-visible rather than leaving the DOM), leaving the chip.
  await card.getByRole("button", { name: "Collapse comment" }).click();
  await expect(card.locator(".body")).not.toBeVisible();
  await expect(card.locator(".chip")).toBeVisible();

  await card.locator(".chip").click();
  await expect(card.locator(".body")).toBeVisible();
  await expect(card.getByText("Tighten this paragraph.")).toBeVisible();
});

test("the composer reveal and the card swap share one opacity-only token transition", async ({
  daemon,
  page,
}) => {
  await openDefaultPlan(page, daemon);

  // Reads the computed reveal: the scoped animation-name (Svelte hashes it, so it
  // ends in "-reveal"), the resolved duration, and the transform applied while the
  // keyframe runs. transform must stay "none" — the composer and card open inside
  // the library-reserved annotation row, so a transform that changed the row's
  // measured height would shift sibling code lines and fight the preventScroll
  // guard. The shared token-driven reveal is what makes both opens feel considered
  // rather than a pop.
  const motionOf = (el: Element) => {
    const cs = getComputedStyle(el);
    return {
      name: cs.animationName,
      duration: cs.animationDuration,
      transform: cs.transform,
    };
  };

  const plus = await revealGutterPlus(page, 3);
  await plus.click();
  const composer = page.getByRole("dialog", { name: "Add a comment" });
  await expect(composer).toBeVisible();
  const composerMotion = await composer.evaluate(motionOf);
  expect(composerMotion.name).toMatch(/reveal$/);
  // The micro tier, read off the token rather than retyped as seconds. Compared as a
  // number, not a formatted string: `toBe` on the string form would also be asserting
  // that Number's toString and Chrome's animation-duration serialization agree.
  expect(Number.parseFloat(composerMotion.duration)).toBeCloseTo(
    await motionToken(page, "--dur-micro"),
    3,
  );
  // Opacity only — no scale bounce, no translate.
  expect(composerMotion.transform).toBe("none");

  // The saved card reveals on the same contract: a one-shot opacity fade as it
  // settles into the document, no transform bounce. (The expand/collapse height
  // reveal is a separate grid-rows transition, exercised below.)
  const card = await submitComposer(composer, "Same considered reveal.");
  const cardMotion = await card.evaluate(motionOf);
  expect(cardMotion.name).toMatch(/reveal$/);
  expect(cardMotion.transform).toBe("none");
});

test("the saved card's trash Discard wobbles on hover", async ({ daemon, page }) => {
  // A saved comment's Discard is a trash icon; hovering it plays a small one-shot
  // wobble as a wink of polish. Assert the animation is WIRED — its name resolves
  // while hovered — rather than trying to catch a frame. The keyframes are declared
  // -global-, so the computed name is the verbatim "trash-shake" (unhashed), and the
  // global reduced-motion rule would collapse only its duration, never the name.
  await daemon.seed();
  await page.goto("/");
  await planSurface(page);
  await createAnnotation(page, 3, "Whimsy, please.");

  const discard = page.locator("[data-annotation-card]").getByRole("button", { name: "Discard" });
  await discard.hover();
  const iconAnimation = await discard
    .locator(".icon")
    .evaluate((el) => getComputedStyle(el).animationName);
  expect(iconAnimation).toBe("trash-shake");
});

test("deleting an inline card removes the annotation", async ({ daemon, page }) => {
  const id = await openDefaultPlan(page, daemon);

  await createAnnotation(page, 3, "Drop this section.");
  await awaitAnnotationCount(daemon, id, 1);

  await page.locator("[data-annotation-card]").getByRole("button", { name: "Discard" }).click();
  // Discarding a submitted comment can't be undone, so confirm first (EXC-749).
  await discardConfirm(page).getByRole("button", { name: "Discard" }).click();

  await expect(page.locator("[data-annotation-card]")).toHaveCount(0);
  await awaitAnnotationCount(daemon, id, 0);
});

test("canceling a delete keeps the inline card", async ({ daemon, page }) => {
  // Deleting a submitted comment is irreversible; canceling the confirm must
  // leave the card and its persisted annotation untouched (EXC-749).
  const id = await openDefaultPlan(page, daemon);

  await createAnnotation(page, 3, "Keep this section.");
  await page.locator("[data-annotation-card]").getByRole("button", { name: "Discard" }).click();

  await expect(discardConfirm(page)).toBeVisible();
  await discardConfirm(page).getByRole("button", { name: "Cancel" }).click();
  await expect(discardConfirm(page)).toHaveCount(0);
  await expect(page.locator("[data-annotation-card]")).toHaveCount(1);
  await awaitAnnotationCount(daemon, id, 1);
});

test("editing an inline card rewrites the comment and persists it", async ({ daemon, page }) => {
  const id = await openDefaultPlan(page, daemon);

  await createAnnotation(page, 3, "Original note.");
  await awaitAnnotationComment(daemon, id, "Original note.");

  const card = page.locator("[data-annotation-card]");
  await card.getByRole("button", { name: "Edit" }).click();
  const textarea = card.getByRole("textbox", { name: "Edit comment" });
  await expect(textarea).toHaveText("Original note.");
  await textarea.fill("Revised note with more detail.");
  await page.keyboard.press("ControlOrMeta+Enter");

  await expect(card.getByText("Revised note with more detail.")).toBeVisible();
  await expect(card.getByRole("textbox", { name: "Edit comment" })).toHaveCount(0);
  await awaitAnnotationComment(daemon, id, "Revised note with more detail.");
});

test("editing a saved comment focuses the editor so the caret tracks typing", async ({
  daemon,
  page,
}) => {
  // Regression: editing a saved comment mounts CodeMirror inside the already
  // slot-projected annotation container, where getRootNode() resolves to the
  // diffs library's ShadowRoot. CM gates focus on root.activeElement ===
  // contentDOM, but the slotted light-DOM content is focus-tracked at the
  // document level, so that check never matched — hasFocus stayed false, the
  // .cm-focused class that renders the caret was never applied, and typing left
  // the caret invisible/stuck. Passing root: document (see MarkdownEditor) points
  // CM at where the slotted content's focus actually lives.
  await openDefaultPlan(page, daemon);
  // End and the typed "XY" below are this test's only keydowns and both are
  // load-bearing; a swallowed End also puts Safe Mode's 2s suppression over the
  // typing. Measured 348ms after mount, 48ms clear of the grace (EXC-897).
  await waitPastSafeModeGrace(page);

  await createAnnotation(page, 3, "aaaaaaaa");
  const card = page.locator("[data-annotation-card]");
  await card.getByRole("button", { name: "Edit" }).click();

  // CM only renders the caret while it believes it is focused, so the fix shows
  // up as the .cm-focused class landing on the mounted editor.
  await expect(card.locator(".cm-editor.cm-focused")).toBeVisible();

  // And the caret tracks input: End jumps to the end, and real keystrokes append
  // there in order (a stuck caret would scramble or prepend them).
  await page.keyboard.press("End");
  await page.keyboard.type("XY");
  await expect(card.locator(".cm-content")).toHaveText("aaaaaaaaXY");
});

test("a rendered inline comment shows list markers (ordered and unordered)", async ({
  daemon,
  page,
}) => {
  // Regression: Tailwind Preflight resets lists to list-style: none, which
  // stripped the bullets/numbers from rendered-markdown comments. The .comment
  // list rules restore disc/decimal — and this only shows up with the full
  // stylesheet, so it is verified in the browser rather than under happy-dom.
  const id = await daemon.seed();
  await daemon.putDraft(id, {
    annotations: [
      {
        id: "ann-list",
        startLine: 7,
        endLine: 8,
        comment: "Intro\n\n- one\n- two\n\n1. first\n2. second",
      },
    ],
  });
  await page.goto("/");
  await planSurface(page);
  const card = page.locator("[data-annotation-card]");
  await card.locator(".chip").click();
  await expect(card.locator(".body")).toBeVisible();

  const ul = await card.locator(".comment ul").evaluate((el) => getComputedStyle(el).listStyleType);
  const ol = await card.locator(".comment ol").evaluate((el) => getComputedStyle(el).listStyleType);
  expect(ul).toBe("disc");
  expect(ol).toBe("decimal");
});

// ----- Interaction regressions -----

test("clicking a line near the top opens its composer without jumping the scroll", async ({
  daemon,
  page,
}) => {
  // Regression (focus-scroll): the composer's autofocus used to fire the
  // browser's native scroll-into-view against the mid-rerender annotation row
  // and slam a tall view to its bottom — clicking a line "jumped the page".
  // Opening must leave the scroll position put.
  const view = await openTallPlan(page, daemon);
  await view.evaluate((el) => {
    el.scrollTop = 0;
  });

  // The first body line, near the very top of the plan.
  await page.getByText("Line 1 of the plan body").click();
  const composer = page.getByRole("dialog", { name: "Add a comment" });
  await expect(composer).toBeVisible();

  // The view stayed at the top — no focus-driven jump toward the document bottom.
  expect(await view.evaluate((el) => el.scrollTop)).toBeLessThan(50);
});

test("clicking a line focuses the comment field immediately", async ({ daemon, page }) => {
  // Clicking a line to comment must land focus in the editor so the reviewer can
  // start typing at once — no second click into the field. The composer's node
  // is relocated into the library's slot on open (slotInto), which blurs the
  // just-autofocused editor unless slotInto restores it.
  await openTallPlan(page, daemon);

  await page.getByText("Line 1 of the plan body").click();
  const composer = page.getByRole("dialog", { name: "Add a comment" });
  await expect(composer).toBeVisible();
  await expect(composerInput(composer)).toBeFocused();
});

test("highlights fenced code blocks with per-language syntax colors", async ({ daemon, page }) => {
  // The plan renders as one markdown document; shiki's markdown grammar only
  // tokenizes a ```lang block when that grammar is attached, which the library
  // never does on its own. caret scans the plan's fences and attaches them, so
  // the fixture's ts fence must tokenize into several distinctly-colored spans
  // rather than the single un-highlighted color it had before.
  await daemon.seed();
  await page.goto("/");
  await planSurface(page);
  await expect(page.getByText("function warm")).toBeVisible();

  await expect
    .poll(() =>
      page.evaluate(() => {
        const sh = document.querySelector(".diffview")?.shadowRoot;
        const rows = sh?.querySelectorAll("[data-line]") ?? [];
        let row: Element | undefined;
        for (const r of rows) {
          if ((r.textContent ?? "").includes("function warm")) {
            row = r;
            break;
          }
        }
        if (row == null) return 0;
        const spans = row.querySelectorAll("span");
        return new Set([...spans].map((s) => getComputedStyle(s as HTMLElement).color)).size;
      }),
    )
    .toBeGreaterThanOrEqual(3);
});

// The layered-surface bridge (EXC-603). The single .diffview rule sets
// --diffs-bg: var(--paper-sunk); the library paints :host's background from it,
// so the rendered .diffview host resolves to caret's sunk-paper grey. A typo in
// the bridged token would blank the surface (transparent or the wrong grey), so
// this asserts the computed background is opaque and equal to --paper-sunk — in
// both schemes, since the token flips through the cascade and the bridge sets no
// nested @media of its own.
for (const colorScheme of ["light", "dark"] as const) {
  test(`the diff surface background resolves to caret's --paper-sunk in ${colorScheme}`, async ({
    daemon,
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await daemon.seed();
    await page.goto("/");
    await expect(page.locator(".diffview")).toBeVisible();

    const { surface, sunk } = await page.evaluate(() => {
      const view = document.querySelector(".diffview") as HTMLElement;
      // The library paints :host{background-color:var(--diffs-bg)}, applied to
      // the shadow host (the .diffview element itself), so its computed
      // background-color is the resolved bridge color.
      const surfaceColor = getComputedStyle(view).backgroundColor;
      // Resolve --paper-sunk to the same rgb() form via a throwaway probe so the
      // comparison is value-based, not string-formatting-based.
      const probe = document.createElement("span");
      probe.style.backgroundColor = "var(--paper-sunk)";
      document.body.appendChild(probe);
      const sunkColor = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return { surface: surfaceColor, sunk: sunkColor };
    });

    // Opaque (not the rgba(0,0,0,0) transparent default) and the bridged grey.
    expect(surface).not.toBe("rgba(0, 0, 0, 0)");
    expect(surface).toBe(sunk);
  });
}

// ----- Comment-span bracket (EXC-608) -----

// Tall enough that a 12+ line comment span and the rows above/below it all
// render in one viewport (so the bracket's full extent is measurable).
const BRACKET_PLAN = `# Bracket Plan\n\n${Array.from(
  { length: 24 },
  (_, i) => `Body line ${i + 1} content here.`,
).join("\n\n")}\n`;

/** The viewport rect of a 1-based source line's row in the view. */
async function lineRowRect(page: Page, line: number): Promise<{ top: number; bottom: number }> {
  return page.evaluate((ln) => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    const span = Array.from(sh?.querySelectorAll("[data-line-number-content]") ?? []).find(
      (s) => (s.parentElement as HTMLElement)?.dataset.lineIndex === String(ln - 1),
    );
    const r = (span?.parentElement as HTMLElement)?.getBoundingClientRect();
    return r ? { top: r.top, bottom: r.bottom } : { top: 0, bottom: 0 };
  }, line);
}

/** The single comment-bracket rail's viewport rect, or null if none is drawn. */
async function bracketRailRect(
  page: Page,
): Promise<{ top: number; bottom: number; width: number } | null> {
  return page.evaluate(() => {
    const rail = document.querySelector(".diff-plan [data-comment-bracket]") as HTMLElement | null;
    if (rail == null || getComputedStyle(rail).display === "none") return null;
    const r = rail.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, width: r.width };
  });
}

/** Drag-select lines `start`–`end` in the gutter and submit a comment, returning
 * once the inline card for the range is on screen. */
async function createRangeAnnotation(
  page: Page,
  start: number,
  end: number,
  comment: string,
): Promise<void> {
  // The submit chord below is the first keydown of every test funnelling through
  // here — the drag, the gutter +, and the fill are all mouse — so it lands ~330ms
  // after mount, barely clear of the 300ms safe-mode grace (EXC-897).
  await waitPastSafeModeGrace(page);
  await selectGutterRange(page, start, end);
  const composer = await openComposerFromSelection(page);
  const textarea = composerInput(composer);
  await textarea.fill(comment);
  // Confirm CodeMirror has applied the input before the submit chord (see
  // createAnnotation): the async input would otherwise race the keypress.
  await expect(textarea).toContainText(comment);
  await textarea.click();
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(composer).toHaveCount(0);
}

test("a multi-line comment paints a gutter bracket spanning its whole range", async ({
  daemon,
  page,
}) => {
  // The comment anchors its card to endLine, but the bracket must mark every line
  // from startLine to endLine — a 13-line span (4–16) on the body text.
  await openRangePlan(page, daemon, BRACKET_PLAN);

  // Source lines: line 1 is the heading, line 2 blank, then "Body line N" lands on
  // source line 2N+1. Select source lines 5–17 (Body line 2 → Body line 8), a
  // 13-line span anchored on content rows at both ends.
  const startLine = 5;
  const endLine = 17;
  await createRangeAnnotation(page, startLine, endLine, "This whole block needs a rewrite.");

  // The rail is drawn and its 6px-ish width matches the decoration-bar rail shape.
  await expect.poll(async () => bracketRailRect(page)).not.toBeNull();
  const rail = await bracketRailRect(page);
  expect(rail).not.toBeNull();
  expect(rail!.width).toBeGreaterThan(3);
  expect(rail!.width).toBeLessThan(12);

  // Its top aligns to the start row's top and its bottom to the end row's bottom
  // (within a few px of measurement slack) — so it covers the full 13-line span,
  // not just the endLine the card anchors to.
  const startRow = await lineRowRect(page, startLine);
  const endRow = await lineRowRect(page, endLine);
  expect(Math.abs(rail!.top - startRow.top)).toBeLessThan(4);
  expect(Math.abs(rail!.bottom - endRow.bottom)).toBeLessThan(4);
  // A 13-line span is much taller than one row — proof it isn't endLine-only.
  expect(rail!.bottom - rail!.top).toBeGreaterThan((endRow.bottom - startRow.top) * 0.8);

  // The bracket is decorative: it never intercepts gutter `+`/line clicks.
  expect(
    await page.evaluate(() => {
      const rl = document.querySelector(".diff-plan [data-comment-bracket]") as HTMLElement;
      const layer = rl.parentElement as HTMLElement;
      return [getComputedStyle(rl).pointerEvents, getComputedStyle(layer).pointerEvents];
    }),
  ).toEqual(["none", "none"]);
});

test("the comment bracket tracks its lines through a scroll", async ({ daemon, page }) => {
  await openRangePlan(page, daemon, BRACKET_PLAN);
  const view = await planSurface(page);

  await createRangeAnnotation(page, 5, 13, "Track me through scroll.");
  await expect.poll(async () => bracketRailRect(page)).not.toBeNull();

  // The rail stays glued to its start row after a scroll: it is a host-relative
  // child of the view, so it translates with the rows rather than detaching.
  await view.evaluate((el) => {
    el.scrollTop = 120;
  });
  await expect
    .poll(async () => {
      const rail = await bracketRailRect(page);
      const startRow = await lineRowRect(page, 5);
      return rail == null ? 999 : Math.abs(rail.top - startRow.top);
    })
    .toBeLessThan(4);
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`the comment bracket rail is an opaque amber in ${colorScheme}`, async ({
    daemon,
    page,
  }) => {
    // --diffs-decoration-bar-color is set on .diffview as a softened --accent and
    // inherits to the host-side rail; it must paint a visible (non-transparent)
    // color in both schemes, distinct from the page background.
    await page.emulateMedia({ colorScheme });
    await openRangePlan(page, daemon, BRACKET_PLAN);

    await createRangeAnnotation(page, 5, 17, "Color me amber.");
    await expect.poll(async () => bracketRailRect(page)).not.toBeNull();

    const fill = await page.evaluate(() => {
      const rail = document.querySelector(".diff-plan [data-comment-bracket]") as HTMLElement;
      return getComputedStyle(rail).backgroundColor;
    });
    // color-mix(in lab, --accent 75%, transparent) resolves to a partially-
    // transparent amber. This Chrome reports it in lab() form — assert it is a
    // visible (non-transparent), warm color: lab a* and b* are both positive for
    // amber in either scheme, and the 75% mix carries a ~0.75 alpha.
    expect(fill).not.toBe("rgba(0, 0, 0, 0)");
    const lab = fill.match(/^lab\(([-\d.]+) ([-\d.]+) ([-\d.]+)\s*\/\s*([\d.]+)\)/);
    expect(lab).not.toBeNull();
    const [, , a, b, alpha] = lab!.map(Number);
    expect(a).toBeGreaterThan(0); // red-axis: warm
    expect(b).toBeGreaterThan(0); // yellow-axis: amber
    expect(alpha).toBeGreaterThan(0.5);
    expect(alpha).toBeLessThan(1);
  });
}

// EXC-867: inline bold and italic render as real glyphs inside the chip family's
// round-rects, markers kept and subdued. Everything below needs a real browser and
// could not be a unit: the decoration pass runs inside the library's shadow root
// after an async repaint, the chip tints and radius are custom properties that only
// a live cascade resolves (a token that failed to derive computes to nothing at
// all), the weight/slant separation is a computed font style, and the monospace
// grid check is real font metrics. The pure half — the run grouping, the pill
// boundaries and the file-reference cut — is ui/src/lib/diffview/inlineDecorate.test.ts,
// and the theme rules are ui/src/lib/caret-theme.test.ts.
const EMPHASIS_PLAN = `# Emphasis Plan

Plain prose on its own line here.

This line has **bold text** and *italic text* on it.

Nested ***both at once*** sits here.

Bold wrapping code: **before \`inline()\` after** ends here.

**AAAA** and *BB* here

xxAAAAxx and xBBx here
`;

/** Reads the decorated row `n` out of the source view's shadow root. */
function readEmphasis(page: Page, n: number) {
  return page.evaluate((line) => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot ?? null;
    const row = sh?.querySelector(`[data-content] [data-line="${line}"]`) ?? null;
    const tokens = [...(row?.children ?? [])] as HTMLElement[];
    const tagged = tokens.filter((t) => t.hasAttribute("data-md"));
    const withText = (t: HTMLElement) => ({
      text: t.textContent ?? "",
      md: t.getAttribute("data-md"),
      start: t.getAttribute("data-md-start"),
      end: t.getAttribute("data-md-end"),
      weight: getComputedStyle(t).fontWeight,
      style: getComputedStyle(t).fontStyle,
      color: getComputedStyle(t).color,
      backgroundImage: getComputedStyle(t).backgroundImage,
      radiusStart: getComputedStyle(t).borderStartStartRadius,
      radiusEnd: getComputedStyle(t).borderEndEndRadius,
      padBlock: `${getComputedStyle(t).paddingTop} ${getComputedStyle(t).paddingBottom}`,
      // A member nested inside another paints on ::after, which is the only box in
      // the token that can round its own ends without clipping the enclosing pill's
      // tint — so the inner chip's whole render reads off the pseudo-element.
      inner: t.getAttribute("data-md-inner"),
      innerImage: getComputedStyle(t, "::after").backgroundImage,
      innerRadiusStart: getComputedStyle(t, "::after").borderStartStartRadius,
      innerRadiusEnd: getComputedStyle(t, "::after").borderEndEndRadius,
    });
    return {
      lineText: tokens.map((t) => t.textContent ?? "").join(""),
      tokens: tokens.map(withText),
      tagged: tagged.map(withText),
      boldStarts: tagged.filter((t) =>
        (t.getAttribute("data-md-start") ?? "").split(" ").includes("bold"),
      ).length,
      boldEnds: tagged.filter((t) =>
        (t.getAttribute("data-md-end") ?? "").split(" ").includes("bold"),
      ).length,
    };
  }, n);
}

/** The painted width of a row's text, measured over its text nodes so the grid
 * comparison reads glyph advance rather than the full-width grid cell. */
function rowTextWidth(page: Page, n: number) {
  return page.evaluate((line) => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot ?? null;
    const row = sh?.querySelector(`[data-content] [data-line="${line}"]`);
    if (row === null || row === undefined) return null;
    const range = document.createRange();
    range.selectNodeContents(row);
    return range.getBoundingClientRect().width;
  }, n);
}

/** Seed EMPHASIS_PLAN, open it, and wait until `awaitLine` has been decorated. */
async function openEmphasisPlan(page: Page, daemon: Daemon, awaitLine: number): Promise<void> {
  await daemon.seed({ plan: EMPHASIS_PLAN });
  await page.goto("/");
  await planSurface(page);
  await expect
    .poll(async () => (await readEmphasis(page, awaitLine)).tagged.length)
    .toBeGreaterThan(0);
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`inline emphasis chips resolve their tint, radius and glyphs in ${colorScheme}`, async ({
    daemon,
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await openEmphasisPlan(page, daemon, 5);
    await expect(page.getByText("Plain prose on its own line here.")).toBeVisible();

    const bold = await readEmphasis(page, 5);
    // The markers stay in the text — nothing is hidden or rewritten.
    expect(bold.lineText).toBe("This line has **bold text** and *italic text* on it.");

    const boldContent = bold.tagged.find((t) => t.text === "bold text");
    const boldMarker = bold.tagged.find((t) => t.text === "**");
    const italicContent = bold.tagged.find((t) => t.text === "italic text");
    expect(boldContent).toBeDefined();
    expect(boldMarker).toBeDefined();
    expect(italicContent).toBeDefined();

    // EXC-858 measured the bold and italic TINTS within a 1.05 contrast ratio in
    // five of nine palettes, so the tint cannot be the separator — the weight and
    // slant are, and they come from shiki. This is that assertion.
    expect(Number(boldContent!.weight)).toBeGreaterThanOrEqual(700);
    expect(italicContent!.style).toBe("italic");
    const plain = await readEmphasis(page, 3);
    expect(Number(plain.tokens[0]!.weight)).toBeLessThan(700);

    // The markers read as markers: their own subdued ink, distinct from the content.
    expect(boldMarker!.color).not.toBe(boldContent!.color);

    // The chip resolved end to end. --chip-bold and --radius are custom properties;
    // a token that failed to derive leaves the gradient invalid and background-image
    // computes to "none", so this cannot pass on a broken cascade.
    expect(boldContent!.backgroundImage).toContain("linear-gradient");
    expect(boldContent!.backgroundImage).not.toBe("none");
    expect(Number.parseFloat(boldMarker!.radiusStart)).toBeGreaterThan(0);
  });
}

test("a fragmented emphasis element still draws exactly one pill (EXC-867)", async ({
  daemon,
  page,
}) => {
  // `**before `inline()` after**` fragments into three runs once the inline-code
  // run is split out, but it is ONE bold element and must close its pill once.
  await openEmphasisPlan(page, daemon, 9);

  const row = await readEmphasis(page, 9);
  expect(row.boldStarts).toBe(1);
  expect(row.boldEnds).toBe(1);
  // Several tokens carry the member; only the outer two carry the rounded ends.
  expect(row.tagged.filter((t) => (t.md ?? "").split(" ").includes("bold")).length).toBeGreaterThan(
    1,
  );

  // Nested emphasis is both at once, and textmate needs the descendant rule to say so.
  await expect.poll(async () => (await readEmphasis(page, 7)).tagged.length).toBeGreaterThan(0);
  const nested = await readEmphasis(page, 7);
  const both = nested.tagged.find((t) => t.text === "both at once");
  expect(both).toBeDefined();
  expect((both!.md ?? "").split(" ").sort()).toEqual(["bold", "italic"]);
  expect(Number(both!.weight)).toBeGreaterThanOrEqual(700);
  expect(both!.style).toBe("italic");
});

test("a chip's padding pushes its neighbours rather thanoverlapping them (EXC-867)", async ({
  daemon,
  page,
}) => {
  // EXC-867 shipped these chips unpadded to keep every row's glyphs on one pixel grid,
  // and the padding that replaced it is a deliberate reversal: an unpadded tint reads as
  // a highlighter smear rather than as a chip. What is pinned here is the SHAPE of the
  // cost. Lines 11 and 13 are the same 22 characters, one carrying two pills and one
  // carrying none, so the difference between their painted widths is the padding and
  // nothing else — four edges of it, since each pill is padded at both ends.
  await openEmphasisPlan(page, daemon, 11);

  const geometry = await page.evaluate(() => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot ?? null;
    const row = sh?.querySelector('[data-content] [data-line="11"]') as HTMLElement | null;
    if (row === null) return null;
    const cap = row.querySelector("[data-md-start]") as HTMLElement | null;
    // How far each chip's painted box reaches back over the glyph before it. A cancelled
    // padding/negative-margin pair — the shape EXC-880 used and this replaced — puts the
    // translucent fill under that character, and two chips either side of one glyph coat
    // its cell twice. Positive here is that regression.
    const overlap = [...row.querySelectorAll("[data-md-start]")].map((chip) => {
      const previous = chip.previousElementSibling;
      if (previous === null) return 0;
      return previous.getBoundingClientRect().right - chip.getBoundingClientRect().left;
    });
    return {
      pad: cap === null ? null : Number.parseFloat(getComputedStyle(cap).paddingInlineStart),
      overlap: Math.max(0, ...overlap),
    };
  });
  expect(geometry?.pad ?? 0).toBeGreaterThan(0);

  const styled = await rowTextWidth(page, 11);
  const plain = await rowTextWidth(page, 13);
  expect(styled).not.toBeNull();
  expect(plain).not.toBeNull();
  expect((styled as number) - (plain as number)).toBeCloseTo(4 * (geometry?.pad ?? 0), 0);
  expect(geometry?.overlap).toBeCloseTo(0, 1);
});

test("a backticked file citation keeps its glyph through the decoration pass (EXC-867)", async ({
  daemon,
  page,
}) => {
  // The cross-issue regression this pass had to avoid. The codespan run covers the
  // backticks while the merged reference sits inside them, so the two partitions
  // interleave; tagTokenAt needs a token bounded by the reference. Nothing about
  // this shape may regress — it is the repo's commonest citation.
  const proj = await makeProject({ "src/cache.ts": "export const cache = 1;\n" });
  try {
    await daemon.seed({
      cwd: proj.dir,
      plan: "# Refs\n\nSee [`src/cache.ts`](src/cache.ts) for the detail.\n",
    });
    await page.goto("/");
    await planSurface(page);

    const glyph = () =>
      page.evaluate(() => {
        const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot ?? null;
        const el = sh?.querySelector("[data-content] [data-file-ref]") as HTMLElement | null;
        return el?.textContent ?? null;
      });
    // The reference resolves against the real cwd through the daemon, so poll.
    await expect.poll(glyph).toBe("src/cache.ts");
  } finally {
    await proj.cleanup();
  }
});

test("the decoration pass leaves the row's other consumers intact (EXC-867)", async ({
  daemon,
  page,
}) => {
  // The issue's "what must not break" list. Splitting a row into more elements —
  // and so more text nodes — is exactly what could break the passes that walk them,
  // and every one of these needs a real browser: rangeForSpan resolves a DOM Range
  // over the live text nodes, and the decoration only exists after the library's
  // async repaint.
  await openEmphasisPlan(page, daemon, 5);

  // Search highlights (rangeForSpan) still land on exactly the matched columns of a
  // SPLIT row. "bold text" sits inside the emphasis run on line 5, so its range is
  // resolved across the tokens the pass produced rather than one flat token.
  // Safe mode swallows shortcuts for its grace window, so `/` needs it past first.
  await waitPastSafeModeGrace(page);
  await page.keyboard.press("/");
  await page.keyboard.type("bold text");
  // Both registries: the sole match is the CURRENT one, so it paints in
  // caret-search-current and the caret-search underlay is empty.
  await expect
    .poll(() =>
      page.evaluate(() =>
        ["caret-search", "caret-search-current"].flatMap((name) =>
          [...(CSS.highlights.get(name) ?? [])].map((r) => r.toString()),
        ),
      ),
    )
    .toContain("bold text");
  await page.keyboard.press("Escape");

  // Decoration survives a repaint. The 2s poll re-renders the view, which is the
  // same row rewrite a version switch or resolve landing causes.
  await waitForTwoPollTicks(page);
  expect((await readEmphasis(page, 5)).tagged.length).toBeGreaterThan(0);

  // A fenced code block is never visited: links.ts emits no runs for in-code lines,
  // so the block's rows and its fence markers reach codeBlocks.ts untouched. Asserted
  // as absence because a split fence token would carry a duplicated data-code-fence.
  const inCode = await page.evaluate(() => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot ?? null;
    return {
      taggedInCode: sh?.querySelectorAll("[data-code-line] [data-md]").length ?? -1,
      fenceMarkers: sh?.querySelectorAll("[data-code-fence]").length ?? -1,
    };
  });
  expect(inCode.taggedInCode).toBe(0);
  expect(inCode.fenceMarkers).toBe(0); // this plan has no fences; the query resolves
});

test("compare mode never reaches the decoration pass (EXC-867)", async ({ daemon, page }) => {
  // Scope boundary EXC-855 draws for the whole epic: these affordances are
  // single-version only. Compare renders SourceDiffView, which is passed no inline
  // layer, so this is an absence assertion rather than a styling one — toHaveCount(0)
  // says "not offered here", which toBeHidden could not distinguish from "painted
  // nothing".
  await daemon.seedVersions(2, [
    EMPHASIS_PLAN,
    `${EMPHASIS_PLAN}\nA second version with **more bold**.\n`,
  ]);
  await page.goto("/");
  await planSurface(page);
  await expect.poll(async () => (await readEmphasis(page, 5)).tagged.length).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Versions" }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot ?? null;
        return sh?.querySelectorAll("[data-md]").length ?? -1;
      }),
    )
    .toBe(0);
});

// EXC-868: the inline-code chip. The pill GROUPING is pure and already pinned in
// ui/src/lib/diffview/inlineDecorate.test.ts; what cannot live there is whether the chip
// actually paints. --chip-code and --radius are custom properties, so only a live cascade
// resolves them — a token that failed to derive leaves the gradient invalid and
// background-image computing to "none" — and the subdued backticks are a computed colour
// that shiki only produces in a real highlight. The second row is the shape the epic cares
// about most: a backticked citation whose file reference cuts the row underneath the pill,
// which must still draw ONE chip rather than three.
//
// One scheme rather than the two the emphasis test above loops, and the asymmetry is
// deliberate: that loop exists because --chip-bold and --chip-italic composite within a
// 1.05 contrast ratio in five of nine palettes, so its tint had to be seen resolving in
// both. --chip-code rides the same recipe path that loop already proves resolves, and
// what is new here is shape, not colour — so a second scheme would re-prove the cascade
// and nothing else. The per-scheme look is checked by hand against the committed
// showcase instead.
const INLINE_CODE_PLAN = `# Inline code plan

A bare span: \`render()\` here.

See [\`src/cache.ts\`](src/cache.ts) for the detail.

Read [the \`render()\` helper](https://example.com/docs) first.
`;

/** How many of a decorated row's tokens open (or close) the `code` pill. */
function codeCaps(
  tagged: { start: string | null; end: string | null }[],
  edge: "start" | "end",
): number {
  return tagged.filter((t) => (t[edge] ?? "").split(" ").includes("code")).length;
}

test("the inline-code chip draws one pill per span (EXC-868)", async ({ daemon, page }) => {
  const proj = await makeProject({ "src/cache.ts": "export const cache = 1;\n" });
  try {
    await daemon.seed({ cwd: proj.dir, plan: INLINE_CODE_PLAN });
    await page.goto("/");
    await planSurface(page);
    await expect.poll(async () => (await readEmphasis(page, 3)).tagged.length).toBeGreaterThan(0);

    const bare = await readEmphasis(page, 3);
    // Nothing is stripped: the backticks are still in the text, inside the chip.
    expect(bare.lineText).toBe("A bare span: `render()` here.");
    expect(codeCaps(bare.tagged, "start")).toBe(1);
    expect(codeCaps(bare.tagged, "end")).toBe(1);

    const content = bare.tagged.find((t) => t.text === "render()");
    const marker = bare.tagged.find((t) => t.text === "`");
    expect(content).toBeDefined();
    expect(marker).toBeDefined();
    // The tint resolved end to end through the live cascade, and it is the CODE layer
    // doing the painting. One layer per member, and on a codespan the bold and italic two
    // resolve to transparent through their var() fallback — so "contains a gradient" would
    // have passed before this chip existed, and only "exactly one layer is not transparent"
    // pins that --chip-code itself derived. A token that failed to derive leaves the
    // gradient invalid and background-image computing to "none".
    const layers = content!.backgroundImage.split(/,\s*(?=linear-gradient)/);
    expect(layers).toHaveLength(4);
    expect(layers.filter((l) => !/rgba\(0,\s*0,\s*0,\s*0\)/.test(l))).toHaveLength(1);
    expect(Number.parseFloat(marker!.radiusStart)).toBeGreaterThan(0);
    // Backticks kept AND subdued: caret-theme.ts colours them off the code between them,
    // which is also the token boundary the file glyph depends on (caret-theme.ts's
    // punctuation.definition.raw.markdown rule).
    expect(marker!.color).not.toBe(content!.color);

    // The citation row. The reference resolves against the real cwd through the daemon,
    // so poll until the glyph lands before reading the pill.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot ?? null;
          const el = sh?.querySelector("[data-content] [data-file-ref]");
          const box = el === null || el === undefined ? null : getComputedStyle(el);
          return box === null
            ? null
            : `${el?.textContent} ${el?.getAttribute("data-md")} ${box.paddingLeft} ${box.borderStartStartRadius}`;
        }),
      )
      // The reference's child is INSIDE the citation's pill rather than beside it, and
      // its box is made to match: the member without a cap, and none of the inline
      // padding or rounding that shapes a standalone reference chip into a pill of its
      // own. Left unzeroed, each drew a seam through the middle of the pill.
      .toBe("src/cache.ts code 0px 0px");

    const cited = await readEmphasis(page, 5);
    expect(cited.tagged.map((t) => t.text)).toEqual(["`", "src/cache.ts", "`"]);
    // ONE CHIP, one colour, one thickness. A codespan wrapping a resolved reference is
    // not a code chip with a green middle: the group's tint is rebound to the reference's,
    // so all three children resolve the same layer. Before that, the backticks painted
    // --chip-code around a --chip-ref path and the pill changed colour twice across its
    // own width. The block padding is the same story on the other axis — the reference
    // used to zero all four sides, which drew a thinner middle inside taller caps.
    expect(new Set(cited.tagged.map((t) => t.backgroundImage)).size).toBe(1);
    expect(new Set(cited.tagged.map((t) => t.padBlock)).size).toBe(1);
    // And it is a REAL fill rather than three tokens agreeing on nothing: exactly one of
    // the four layers paints, which is the code layer carrying the reference's tint.
    const citedLayers = cited.tagged[0]!.backgroundImage.split(/,\s*(?=linear-gradient)/);
    expect(citedLayers.filter((l) => !/rgba\(0,\s*0,\s*0,\s*0\)/.test(l))).toHaveLength(1);
    // Stronger than counting caps: WHICH child carries them is the whole invariant. A
    // start on the middle child would also count one, and is exactly the notched pill
    // the cap rule exists to prevent.
    expect(cited.tagged.map((t) => t.start)).toEqual(["code", null, null]);
    expect(cited.tagged.map((t) => t.end)).toEqual([null, null, "code"]);

    // A codespan inside a COLLAPSED LINK LABEL — where this chip meets EXC-859's. The
    // label collapses to prose, so the code run sits wholly inside the link run and the
    // middle child carries both members. Two things have to be true at once, and only a
    // browser can say so: both layers paint (one property, four layers, so a member that
    // replaced the stack rather than adding to it would show up as a missing tint), and
    // the code member takes NO cap there, because the link pill encloses it and only the
    // outermost pill caps.
    const labelled = await readEmphasis(page, 7);
    expect(labelled.lineText).toBe("Read the `render()` helper first.");
    const both = labelled.tagged.find((t) => t.text === "render()");
    expect(both).toBeDefined();
    expect((both!.md ?? "").split(" ").sort()).toEqual(["code", "link"]);
    // No cap on the code member here: the link pill encloses it, and a cap lands only
    // where every member on the child ends. The link's own caps sit on the label's outer
    // children, so the code tint cannot round on this box without clipping the link's.
    expect(both!.start).toBeNull();
    expect(both!.end).toBeNull();
    expect(codeCaps(labelled.tagged, "start")).toBe(0);
    expect(codeCaps(labelled.tagged, "end")).toBe(0);
    // The two members paint on two BOXES, and that split is what lets the inner one
    // round. The token carries the enclosing link's layer; the nested code member moves
    // to ::after, which has a radius of its own to spend — square inner ends inside a
    // rounded outer pill is the artefact the pseudo-element replaces. Both still paint,
    // which is the original claim here: a member that replaced the stack rather than
    // adding to it would show up as a missing tint.
    const bothLayers = both!.backgroundImage.split(/,\s*(?=linear-gradient)/);
    expect(bothLayers).toHaveLength(4);
    expect(bothLayers.filter((l) => !/rgba\(0,\s*0,\s*0,\s*0\)/.test(l))).toHaveLength(1);
    expect(both!.inner).toBe("code");
    const innerLayers = both!.innerImage.split(/,\s*(?=linear-gradient)/);
    expect(innerLayers).toHaveLength(4);
    expect(innerLayers.filter((l) => !/rgba\(0,\s*0,\s*0,\s*0\)/.test(l))).toHaveLength(1);
    // The whole point: the inner pill closes ONCE, at the code run's own outer ends —
    // shiki cuts the backticks off as their own tokens, so a per-token radius would
    // pinch the inner chip at every seam exactly as it would the outer one.
    const innerRun = labelled.tagged.filter((t) => t.inner === "code");
    expect(innerRun.map((t) => t.text)).toEqual(["`", "render()", "`"]);
    expect(innerRun.map((t) => Number.parseFloat(t.innerRadiusStart) > 0)).toEqual([
      true,
      false,
      false,
    ]);
    expect(innerRun.map((t) => Number.parseFloat(t.innerRadiusEnd) > 0)).toEqual([
      false,
      false,
      true,
    ]);
  } finally {
    await proj.cleanup();
  }
});

// EXC-863: blockquote level bars. The pure halves are already pinned as units — the depth
// scan in ui/src/lib/diffview/inlineSpans.test.ts, the row tag and the per-level marker
// elements in inlineDecorate.test.ts, the selectors in coreStyles.test.ts, and the subdue's
// contrast floor across all nine palettes in ui/src/lib/theme.test.ts. What only a browser
// can answer is whether any of it PAINTS: the bar is a pseudo-element whose fill and radius
// are custom properties, so a token that failed to derive leaves a box with no background
// rather than a missing rule; the subdue is a computed opacity that no stylesheet regex can
// prove reaches a real row. The grid check is real font metrics, and the gutter count is the
// reflow guard a leading decoration most threatens.
//
// Both schemes, unlike the inline-code chip above. Not for the bar's fill — --ink-soft is a
// ramp token with no derivation of its own, resolved in both by construction — but for the
// subdue,
// whose whole constraint is contrast against the surface, and the surface is what a scheme
// changes. A fade that reads as a step in one and as nothing (or as unreadable) in the other
// is exactly the failure the issue's ladder is about.
const QUOTE_PLAN = `# Quote plan

Plain prose sits on this line here.

> One level with **bold** and \`code\` in it.

> > Two levels open on this row.

> > > Three levels open on this row.

> Plain quoted words with no markup.

x Plain quoted words with no markup.
`;

/** Every quote marker on row `n`: its level, whether the glyph was overdrawn, the bar's
 * own painted box read off the ::before, and the computed opacity of each token so the
 * subdue can be read where it actually lands. */
function readQuoteRow(page: Page, n: number) {
  return page.evaluate((line) => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot ?? null;
    const row = sh?.querySelector(`[data-content] [data-line="${line}"]`) ?? null;
    const markers = [...(row?.querySelectorAll("[data-md-quote]") ?? [])] as HTMLElement[];
    return {
      depth: row?.getAttribute("data-quote-depth") ?? null,
      text: [...(row?.children ?? [])].map((t) => t.textContent ?? "").join(""),
      rowOpacity: row === null ? null : getComputedStyle(row).opacity,
      tokens: [...(row?.children ?? [])].map((t) => ({
        text: t.textContent ?? "",
        quote: t.getAttribute("data-md-quote"),
        md: t.getAttribute("data-md"),
        opacity: getComputedStyle(t as HTMLElement).opacity,
      })),
      bars: markers.map((m) => {
        const bar = getComputedStyle(m, "::before");
        return {
          level: m.getAttribute("data-md-quote"),
          glyph: getComputedStyle(m).color,
          background: bar.backgroundColor,
          radius: Number.parseFloat(bar.borderStartStartRadius),
          width: Number.parseFloat(bar.width),
          left: Math.round(m.getBoundingClientRect().left),
        };
      }),
    };
  }, n);
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`blockquote level bars paint one bar per level in ${colorScheme} (EXC-863)`, async ({
    daemon,
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await daemon.seed({ plan: QUOTE_PLAN });
    await page.goto("/");
    await planSurface(page);
    await expect.poll(async () => (await readQuoteRow(page, 5)).depth).toBe("1");

    const rows = [
      await readQuoteRow(page, 5),
      await readQuoteRow(page, 7),
      await readQuoteRow(page, 9),
    ];
    expect(rows.map((r) => r.depth)).toEqual(["1", "2", "3"]);
    // Depth reads off the bar COUNT, which is the ticket's whole claim.
    expect(rows.map((r) => r.bars.length)).toEqual([1, 2, 3]);
    expect(rows[2]?.bars.map((b) => b.level)).toEqual(["1", "2", "3"]);

    for (const bar of rows.flatMap((r) => r.bars)) {
      // The token resolved through the live cascade. An underived --ink-soft leaves the
      // declaration invalid and the box transparent, which is a bar that is not there.
      expect(bar.background).not.toBe("rgba(0, 0, 0, 0)");
      expect(bar.width).toBeGreaterThan(0);
      // --radius resolved. This is the computed value, so it cannot see the clamp to a
      // pill that the used value applies at this width — only that the token is there.
      expect(bar.radius).toBeGreaterThan(0);
      // Overdrawn, not doubled — the glyph is gone but the character is not.
      expect(bar.glyph).toBe("rgba(0, 0, 0, 0)");
    }

    // Nesting is the source's own indentation: each level sits one marker column right of
    // the one outside it, so the bars stack rather than piling up in one column.
    const deepest = rows[2]?.bars.map((b) => b.left) ?? [];
    expect(deepest[1]).toBeGreaterThan(deepest[0] as number);
    expect(deepest[2]).toBeGreaterThan(deepest[1] as number);

    // The characters are still there for copy, selection and the comment anchors.
    expect(rows[0]?.text).toBe("> One level with **bold** and `code` in it.");

    // The subdue, read where it lands rather than off the stylesheet. Three things have
    // to hold at once and only a live cascade shows them: the ROW is not faded (its
    // background is where the amber selection band and the hover band paint, so fading it
    // would tint those too), the marker is not faded (it carries the bar), and every other
    // token is. The child combinator is what keeps the fade from compounding on nested
    // elements — a descendant selector would square it.
    // The depth of the fade is not asserted here — ui/src/lib/theme.test.ts owns that,
    // where it can composite QUOTE_SUBDUE against all nine palettes rather than the one
    // this browser happens to be showing. What is asserted is its SHAPE, which only the
    // live cascade has: one value, on the right elements.
    const quotedRow = await readQuoteRow(page, 5);
    expect(quotedRow.rowOpacity).toBe("1");
    const faded = quotedRow.tokens.filter((t) => t.quote === null).map((t) => t.opacity);
    expect(faded.length).toBeGreaterThan(0);
    // One value across every faded token — a compounding descendant selector would
    // show up here as two.
    expect([...new Set(faded)]).toHaveLength(1);
    expect(Number(faded[0])).toBeGreaterThan(0);
    expect(Number(faded[0])).toBeLessThan(1);
    expect(quotedRow.tokens.filter((t) => t.quote !== null).map((t) => t.opacity)).toEqual(["1"]);
    // And the chips inside the quote keep their own treatment rather than losing it —
    // the fade is on top of the chip, not instead of it.
    expect(quotedRow.tokens.some((t) => (t.md ?? "").includes("bold"))).toBe(true);
    expect(quotedRow.tokens.some((t) => (t.md ?? "").includes("code"))).toBe(true);

    // An unquoted row is untouched, so the fade is the quote's and not the sheet's.
    const plainRow = await readQuoteRow(page, 3);
    expect(plainRow.depth).toBeNull();
    expect([...new Set(plainRow.tokens.map((t) => t.opacity))]).toEqual(["1"]);

    // The monospace grid. Line 13 is line 11's twin — the same characters with the leading
    // marker mirrored by a plain glyph, and no inline markup on either, so the ONLY thing
    // that can separate their painted widths is the bar. (Line 5 would have re-proven
    // EXC-867's emphasis-advance check instead.) A bar that took room in the line box, or a
    // marker whose advance changed, would drag every column after it off the source grid,
    // and the search highlights, vim motions and drag-ranges all resolve against those.
    const quoted = await rowTextWidth(page, 11);
    const plain = await rowTextWidth(page, 13);
    expect(quoted).not.toBeNull();
    expect(Math.abs((quoted as number) - (plain as number))).toBeLessThan(1);

    // The reflow guard: a leading decoration is the shape that wraps a row in two, and a
    // wrapped row would leave the gutter one number short of the lines it labels.
    const counts = await page.evaluate(() => {
      const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot ?? null;
      return {
        rows: sh?.querySelectorAll("[data-content] [data-line]").length ?? -1,
        numbers: sh?.querySelectorAll("[data-gutter] [data-column-number]").length ?? -1,
      };
    });
    expect(counts.rows).toBeGreaterThan(0);
    expect(counts.numbers).toBe(counts.rows);
  });
}

// EXC-862: thematic breaks. The pure halves are already pinned as units — which lines are
// breaks in ui/src/lib/diffview/thematicBreaks.test.ts (including every look-alike), the
// selectors in coreStyles.test.ts, and the ink's floor across all nine palettes in
// ui/src/lib/theme.test.ts. What only a browser can answer is whether the line PAINTS: the
// rule is a background-image built from a custom property, so a token that failed to derive
// leaves the declaration invalid and the row simply has no line — indistinguishable from a
// missing rule in any stylesheet regex, and invisible to happy-dom, which reports no
// computed background at all.
//
// It also answers something no unit can: what INGEST leaves for the view to render. The
// daemon reflows every plan through rumdl (src/plan/rumdl.ts), which normalizes all three
// CommonMark spellings to `---` and rewrites a setext heading to ATX. So the spellings are
// a renderer contract the units own, while the browser's job is the shapes that survive the
// pipeline — and the three look-alikes that do survive it are here.
//
// Both schemes, for the same reason the blockquote case above runs in both: the rule's whole
// constraint is contrast against the surface, and the surface is what a scheme changes.
const RULE_PLAN = `---
title: front matter
---

# Rule plan

Prose above the break.

---

Prose below the break.

***

Prose below the second break.

___

| head | cell |
| ---- | ---- |
| body | cell |

\`\`\`text
--- inside a fence
\`\`\`
`;

/** Every rendered row, with the rule tag and what the row actually paints. Rows are read
 * whole rather than addressed by a line number counted off RULE_PLAN, because ingest
 * reflows it (see `lineOf` in the harness) — the assertions below describe the document
 * by its own text instead. */
function readRuleRows(page: Page) {
  return page.evaluate(() => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot ?? null;
    return [...(sh?.querySelectorAll("[data-content] [data-line]") ?? [])].map((row) => {
      const el = row as HTMLElement;
      const style = getComputedStyle(el);
      return {
        line: Number(el.getAttribute("data-line")),
        text: el.textContent ?? "",
        rule: el.hasAttribute("data-md-rule"),
        background: style.backgroundImage,
        ink: style.color,
        tokenInks: [...el.children].map((c) => getComputedStyle(c as HTMLElement).color),
      };
    });
  });
}

const TRANSPARENT = "rgba(0, 0, 0, 0)";

/** Seed RULE_PLAN, open it, and wait until at least one rule row has rendered. */
async function openRulePlan(page: Page, daemon: Daemon): Promise<void> {
  await daemon.seed({ plan: RULE_PLAN });
  await page.goto("/");
  await planSurface(page);
  await expect.poll(async () => (await readRuleRows(page)).some((r) => r.rule)).toBe(true);
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`thematic breaks draw a rule and the look-alikes do not in ${colorScheme} (EXC-862)`, async ({
    daemon,
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await openRulePlan(page, daemon);

    const rows = await readRuleRows(page);
    const ruled = rows.filter((r) => r.rule);

    // Three breaks were written in three spellings and three breaks are drawn. They all read
    // `---` because ingest normalized them, which is the finding worth pinning: the view is
    // asked to render one spelling in production however many the author typed, and the
    // other two are the units' business.
    expect(ruled.map((r) => r.text)).toEqual(["---", "---", "---"]);

    // The line is really painted. An underived --ink-soft would leave the declaration
    // invalid and the row with no background layer at all.
    for (const row of ruled) {
      expect(row.background).toContain("linear-gradient");
      // Overdrawn, not deleted: the row and every token it holds are transparent while the
      // characters stay in the DOM.
      expect(row.ink).toBe(TRANSPARENT);
      expect([...new Set(row.tokenInks)]).toEqual([TRANSPARENT]);
    }

    // And nothing else is. A prose row has no background layer and keeps its ink, so the
    // rule is the tagged row's rather than the sheet's.
    const prose = rows.find((r) => r.text === "Prose above the break.");
    expect(prose?.background).toBe("none");
    expect(prose?.ink).not.toBe(TRANSPARENT);

    // The three look-alikes that survive ingest. Each is spelled with the same characters a
    // break is spelled with, and converting any of them is a wrong render rather than a
    // plainer one — a table row would lose its header separator, a fence would stop being
    // literal, and a document would lose its front matter.
    const untagged = rows.filter((r) => !r.rule).map((r) => r.text);
    expect(untagged).toContain("| ---- | ---- |");
    expect(untagged).toContain("--- inside a fence");
    // The front-matter pair is the two `---` rows standing above the plan's first heading.
    const firstHeading = rows.findIndex((r) => r.text.startsWith("#"));
    expect(firstHeading).toBeGreaterThan(0);
    expect(
      rows
        .slice(0, firstHeading)
        .filter((r) => r.text === "---")
        .map((r) => r.rule),
    ).toEqual([false, false]);

    // The monospace grid is untouched. A background paints no box and takes no inline
    // advance, so the row's left edge and its height are the ordinary row's — which is what
    // keeps the gutter numbers, the vim motions and the comment anchors on the same grid.
    const ruledLine = ruled[0]?.line as number;
    expect(await firstGlyphX(page, ruledLine)).toBe(await firstGlyphX(page, prose?.line as number));
    const ruledHeights = await rowHeights(page, ruledLine);
    expect(ruledHeights.row).toBe((await rowHeights(page, prose?.line as number)).row);
    // The row and its own gutter cell share a grid track, so a rule that grew the row would
    // show up here first.
    expect(ruledHeights.number).toBe(ruledHeights.row);

    // The standing reflow guard: one gutter number per row, over a contiguous range.
    const counts = await gridCounts(page);
    expect(counts.numbers).toBe(counts.rows);
    expect(counts.highestLine).toBe(counts.rows);

    // The row is still a row: hovering its gutter reveals the comment `+`, which is the
    // affordance the issue asks for by name and the one a decoration that swallowed the
    // row's box would take away. Nothing about it is drawn by this feature, which is the
    // point — the characters stayed, so the row kept everything hanging off them.
    await expect(await revealGutterPlus(page, ruledLine)).toBeVisible();
  });
}

test("the rule's ink follows the colour scheme (EXC-862)", async ({ daemon, page }) => {
  // What the two-scheme loop above cannot claim on its own: every assertion in it holds
  // whichever scheme it ran under, so a token that resolved to one fixed colour would
  // satisfy both runs. The line has to be drawn in the ink of the scheme it is read in,
  // and the resolved gradient stop is where that is visible. theme.test.ts owns whether
  // the ink CLEARS its contrast floor in all nine palettes; this owns only that the live
  // cascade delivers the scheme's own value rather than a frozen one.
  const stop = async () => {
    const background = await page.evaluate(() => {
      const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot ?? null;
      const row = sh?.querySelector("[data-content] [data-line][data-md-rule]") ?? null;
      return row === null ? "" : getComputedStyle(row as HTMLElement).backgroundImage;
    });
    return /rgba?\([^)]*\)/.exec(background)?.[0] ?? "";
  };

  await page.emulateMedia({ colorScheme: "light" });
  await openRulePlan(page, daemon);
  const light = await stop();

  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(stop).not.toBe(light);
  const dark = await stop();

  for (const resolved of [light, dark]) {
    expect(resolved).toMatch(/^rgba?\(/);
    expect(resolved).not.toBe(TRANSPARENT);
  }
});

test("the repaint settles over the rules (EXC-862)", async ({ daemon, page }) => {
  // The claim every decoration pass in this epic owes. A pass that APPENDS a node to a row
  // can rebuild it on every repaint — the runaway EXC-870 measured at ~10,800 mutations in
  // two seconds. A background-image adds no node, so this is zero by construction.
  await openRulePlan(page, daemon);
  expect(await settledMutations(page)).toBe(0);
});

test("copying a rule's row yields the source characters (EXC-862)", async ({
  context,
  daemon,
  page,
}) => {
  // The epic's copy contract, read off the REAL clipboard. Selection.toString() takes a
  // different path through Blink and showed nothing wrong in EXC-870 while the clipboard
  // carried an image's alt text, so only this assertion means anything. A rule row is the
  // shape that could break it in either direction: the characters are invisible, so a
  // treatment that removed them (or that let the drawn line contribute text of its own)
  // would corrupt the copied markdown without changing anything a reader can see.
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openRulePlan(page, daemon);

  const copied = await page.evaluate(async () => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot ?? null;
    const row = sh?.querySelector("[data-content] [data-line][data-md-rule]") ?? null;
    if (sh == null || row == null) return { selection: "", clipboard: "<no rule row>" };
    const range = document.createRange();
    range.selectNodeContents(row);
    const sel = (sh as unknown as { getSelection?: () => Selection | null }).getSelection?.();
    sel?.removeAllRanges();
    sel?.addRange(range);
    document.execCommand("copy");
    return { selection: sel?.toString() ?? "", clipboard: await navigator.clipboard.readText() };
  });
  expect(copied.clipboard).toBe("---");
  expect(copied.selection).toBe("---");
});

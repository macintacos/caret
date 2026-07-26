// Dev-flagged source-view surface (EXC-583). With the flag on, the plan renders
// as line-numbered markdown source through the @pierre/diffs wrapper instead of
// the legacy plan view + contents rail. A left-hand filterable contents pane
// jumps to headings, the line gutter creates comments (EXC-584), and approve and
// request-changes still round-trip. The view instance must survive the 2s poll
// with no scroll reset.

import type { Locator, Page } from "@playwright/test";

import { expect, test, waitPastSafeModeGrace } from "@test/e2e/support/fixtures.ts";

// A plan tall enough to scroll the source view past one viewport.
const TALL_PLAN = `# Tall Plan\n\n${Array.from({ length: 120 }, (_, i) => `Line ${i + 1} of the plan body, long enough to overflow the viewport.`).join("\n\n")}\n`;

test("renders the plan as markdown source, with no legacy plan view or contents rail", async ({
  daemon,
  page,
}) => {
  await daemon.seed();
  await page.goto("/");

  // The source-view container is mounted; the plan source text is visible
  // (Playwright pierces the library's shadow root for text).
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.getByText("This plan reorganizes the widget cache")).toBeVisible();

  // The legacy surface is absent: no rendered-HTML article, no legacy rail.
  await expect(page.locator("article.plan")).toHaveCount(0);
  await expect(page.locator("nav.toc")).toHaveCount(0);
});

test("scroll position survives the 2-second poll tick", async ({ daemon, page }) => {
  await daemon.seed({ plan: TALL_PLAN });
  await page.goto("/");

  const view = page.locator(".diff-plan");
  await expect(view).toBeVisible();
  await expect(page.getByText("Line 1 of the plan body")).toBeVisible();

  // Scroll down, then assert the position settled at a non-zero offset.
  await view.evaluate((el) => {
    el.scrollTop = 400;
  });
  await expect.poll(async () => view.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  const before = await view.evaluate((el) => el.scrollTop);

  // Wait out more than two poll ticks (the poll re-delivers the same version
  // every 2s); a remount on an unchanged version would reset scrollTop to 0.
  // web-first: poll the condition rather than a fixed sleep.
  const t0 = await page.evaluate(() => performance.now());
  await page.waitForFunction((t) => performance.now() > t + 5000, t0);

  // Same scroll offset — the instance was preserved, not remounted.
  expect(await view.evaluate((el) => el.scrollTop)).toBe(before);
});

test("approving resolves the review on the source-view surface", async ({ daemon, page }) => {
  const id = await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();

  // Approve opens a confirmation (EXC-791); confirming resolves the review.
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Approve this plan?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Approve", exact: true }).click();

  await expect(page.getByRole("heading", { name: "No plans awaiting review" })).toBeVisible();
  await expect.poll(async () => (await daemon.listReviews()).map((r) => r.id)).not.toContain(id);
});

test("request-changes with a general comment round-trips on the source-view surface", async ({
  daemon,
  page,
}) => {
  const id = await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await waitPastSafeModeGrace(page);

  const feedback = "Please tighten the verification section.";
  const dialog = page.getByRole("dialog", { name: "Send the plan back for revision" });
  await page.getByRole("button", { name: "Request changes" }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: "General comment" }).fill(feedback);
  await page.keyboard.press("ControlOrMeta+Enter");

  await expect(page.getByRole("heading", { name: "No plans awaiting review" })).toBeVisible();
  await expect.poll(async () => (await daemon.getReview(id)).body?.decision?.behavior).toBe("deny");
  const review = (await daemon.getReview(id)).body;
  expect(review?.status).toBe("rejected");
  expect(review?.decision?.feedback).toContain(feedback);
});

// ----- Filterable contents pane (EXC-580) -----

// A multi-heading plan with tall sections so a jump produces a visible scroll.
const padding = Array.from({ length: 40 }, (_, i) => `Filler line ${i + 1}.`).join("\n\n");
const TOC_PLAN = `# Overview\n\n${padding}\n\n## Approach\n\n${padding}\n\n## Verification\n\n${padding}\n`;

test("shows a filterable contents pane and jumps to a heading's line", async ({ daemon, page }) => {
  await daemon.seed({ plan: TOC_PLAN });
  await page.goto("/");

  const view = page.locator(".diff-plan");
  await expect(view).toBeVisible();

  // The pane lists every heading.
  const pane = page.getByRole("navigation", { name: "Plan contents" });
  await expect(pane).toBeVisible();
  await expect(pane.locator(".toc-row")).toHaveCount(3);

  // Filtering hides non-matching rows (hide-non-matches default).
  await pane.getByRole("textbox", { name: "Filter headings" }).fill("veri");
  await expect(pane.locator(".toc-row")).toHaveCount(1);
  await expect(pane.locator(".toc-row")).toHaveText("Verification");

  // Clicking the filtered heading jumps the source view down to its line.
  await pane.locator(".toc-row").click();
  await expect.poll(async () => view.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
});

test("keyboard navigation in the contents pane jumps to the cursored heading", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: TOC_PLAN });
  await page.goto("/");

  const view = page.locator(".diff-plan");
  await expect(view).toBeVisible();
  const pane = page.getByRole("navigation", { name: "Plan contents" });
  await expect(pane.locator(".toc-row")).toHaveCount(3);
  // The window-level safe-mode guard swallows keystrokes inside the grace window
  // it arms at mount; wait it out so the arrow keys reach the filter input.
  await waitPastSafeModeGrace(page);

  // Focus the filter input (which owns the keyboard cursor) and walk down to the
  // third heading: ArrowDown moves the cursor from -1 → 0 → 1 → 2.
  const filter = pane.getByRole("textbox", { name: "Filter headings" });
  await filter.click();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");

  // The third row (Verification) is the cursored one.
  await expect(pane.locator(".toc-row.cursor")).toHaveText("Verification");

  // Enter jumps the source view down to that heading's line.
  await page.keyboard.press("Enter");
  await expect.poll(async () => view.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
});

test("suppresses the contents pane for a single-heading plan", async ({ daemon, page }) => {
  await daemon.seed({ plan: "# Only Heading\n\nNo other sections to navigate.\n" });
  await page.goto("/");

  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.getByText("No other sections to navigate")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Plan contents" })).toHaveCount(0);
});

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

  const view = page.locator(".diff-plan");
  await expect(view).toBeVisible();
  const pane = page.getByRole("navigation", { name: "Plan contents" });
  await expect(pane.locator(".toc-row")).toHaveCount(3);

  // Jump to the farthest heading; the smooth scroll should settle it just below
  // the top edge (a small breathing-room offset), not short of it or in the
  // middle of the view. expect.poll rides out the animation.
  await pane.getByRole("button", { name: "Verification" }).click();
  await expect.poll(() => headingTopOffset(page, "## Verification")).toBeLessThanOrEqual(20);
  expect(await headingTopOffset(page, "## Verification")).toBeGreaterThanOrEqual(0);
});

// ----- Annotation creation from the line gutter (EXC-584) -----

// A plan with body text on several lines so a range spans real source lines.
const RANGE_PLAN = `# Range Plan\n\n${Array.from(
  { length: 12 },
  (_, i) => `Body line ${i + 1} content here.`,
).join("\n\n")}\n`;

/** The vertical center (viewport px) of a 1-based source line in the view. */
async function lineCenterY(page: Page, line: number): Promise<number> {
  return page.evaluate((ln) => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    const span = Array.from(sh?.querySelectorAll("[data-line-number-content]") ?? []).find(
      (s) => (s.parentElement as HTMLElement)?.dataset.lineIndex === String(ln - 1),
    );
    const r = (span?.parentElement as HTMLElement)?.getBoundingClientRect();
    return r ? r.y + r.height / 2 : 0;
  }, line);
}

/** Reveal the gutter `+` on `line` by moving the mouse over its left edge. The
 * source view's gutter sits at the left of the .diff-plan scroll container, which
 * the contents pane shifts right when present — so anchor the hover to that
 * container's left edge rather than the viewport's. */
async function revealGutterPlus(page: Page, line: number): Promise<Locator> {
  const y = await lineCenterY(page, line);
  const x = await page.locator(".diff-plan").evaluate((el) => el.getBoundingClientRect().x + 6);
  await page.mouse.move(x, y);
  const plus = page.locator(".diffview [data-utility-button]");
  await expect(plus).toBeVisible();
  return plus;
}

/** The inline composer's editing surface. The composer is a CodeMirror editor
 * (MarkdownEditor.svelte), whose contenteditable exposes role="textbox" with the
 * "Comment" aria-label — so fill/press/toHaveText work as they did on the old
 * textarea, just targeted by role instead of tag. */
function composerInput(composer: Locator): Locator {
  return composer.getByRole("textbox", { name: "Comment" });
}

/** Viewport-px centre of a 1-based line's number cell in the gutter column. */
async function gutterCellCenter(page: Page, line: number): Promise<{ x: number; y: number }> {
  const pt = await page.evaluate((ln) => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    const span = Array.from(sh?.querySelectorAll("[data-line-number-content]") ?? []).find(
      (s) => (s.parentElement as HTMLElement)?.dataset.lineIndex === String(ln - 1),
    );
    const r = (span?.parentElement as HTMLElement)?.getBoundingClientRect();
    return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  }, line);
  if (!pt) throw new Error(`gutter cell for line ${line} not found`);
  return pt;
}

/**
 * Select a line span by dragging down the line-number column from `startLine` to
 * `endLine` (the library's line-selection gesture). A stepped real-mouse drag
 * grows the selection row by row; the gutter `+` then reports that range.
 */
async function selectGutterRange(page: Page, startLine: number, endLine: number): Promise<void> {
  const start = await gutterCellCenter(page, startLine);
  const end = await gutterCellCenter(page, endLine);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up();
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
    .locator(".diff-plan")
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
  const id = await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.getByText("This plan reorganizes the widget cache")).toBeVisible();

  // Line 3 is the "This plan reorganizes…" paragraph in the fixture plan.
  const plus = await revealGutterPlus(page, 3);
  await plus.click();

  const composer = page.getByRole("dialog", { name: "Add a comment" });
  await expect(composer).toBeVisible();
  await expect(composer.getByText("Line 3")).toBeVisible();
  await composerInput(composer).fill("Quantify the cold cost here.");
  await composer.getByRole("button", { name: "Comment" }).click();

  // The composer closes and the annotation persists line-anchored via /draft.
  await expect(composer).toHaveCount(0);
  await expect
    .poll(async () => (await daemon.getReview(id)).body?.annotations?.length ?? 0)
    .toBe(1);
  const ann = (await daemon.getReview(id)).body?.annotations?.[0];
  expect(ann).toMatchObject({ startLine: 3, endLine: 3, comment: "Quantify the cold cost here." });
});

test("Tab nests the current list item in the comment composer", async ({ daemon, page }) => {
  // Tab on a list line runs indentMore against the four-space indentUnit, so the
  // marker shifts one level right (a nested list item), rather than tabbing focus
  // out of the editor. The item follows a first line so submit's trim (which
  // strips only the whole-comment edges) can't hide the indent.
  const id = await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.getByText("This plan reorganizes the widget cache")).toBeVisible();
  await waitPastSafeModeGrace(page);

  const plus = await revealGutterPlus(page, 3);
  await plus.click();
  const composer = page.getByRole("dialog", { name: "Add a comment" });
  await expect(composer.locator(".cm-editor")).toBeVisible();
  await page.keyboard.type("Note");
  await page.keyboard.press("Enter");
  await page.keyboard.type("- item");
  await page.keyboard.press("Tab");
  await composer.getByRole("button", { name: "Comment" }).click();

  await expect
    .poll(async () => (await daemon.getReview(id)).body?.annotations?.[0]?.comment)
    .toBe("Note\n    - item");
});

test("Tab inserts four spaces outside a list in the comment composer", async ({ daemon, page }) => {
  // Off a list line Tab inserts four literal spaces at the cursor (the "just
  // enter four spaces" fallback), still without moving focus out of the editor.
  // Text on both sides keeps the run off the whole-comment edges submit trims.
  const id = await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.getByText("This plan reorganizes the widget cache")).toBeVisible();
  await waitPastSafeModeGrace(page);

  const plus = await revealGutterPlus(page, 3);
  await plus.click();
  const composer = page.getByRole("dialog", { name: "Add a comment" });
  await expect(composer.locator(".cm-editor")).toBeVisible();
  await page.keyboard.type("a");
  await page.keyboard.press("Tab");
  await page.keyboard.type("b");
  await composer.getByRole("button", { name: "Comment" }).click();

  await expect
    .poll(async () => (await daemon.getReview(id)).body?.annotations?.[0]?.comment)
    .toBe("a    b");
});

test("Tab indents every line of a multi-line selection", async ({ daemon, page }) => {
  // Highlighting several lines and pressing Tab indents them all (indentMore over
  // the selection) rather than replacing the highlight with a single tab. A
  // leading unselected line keeps the indented block off the trimmed edges.
  const id = await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.getByText("This plan reorganizes the widget cache")).toBeVisible();
  await waitPastSafeModeGrace(page);

  const plus = await revealGutterPlus(page, 3);
  await plus.click();
  const composer = page.getByRole("dialog", { name: "Add a comment" });
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

  await expect
    .poll(async () => (await daemon.getReview(id)).body?.annotations?.[0]?.comment)
    .toBe("Head\n    one\n    two");
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
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.getByText("This plan reorganizes the widget cache")).toBeVisible();

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
  await expect
    .poll(async () => (await daemon.getReview(id)).body?.annotations?.[0]?.comment)
    .toBe("revised");
});

test("Escape blurs the composer, then a second Escape keeps the draft", async ({
  daemon,
  page,
}) => {
  // In create mode the second Escape keeps the draft for later (a resumable
  // scratch) rather than discarding it — the non-destructive "clicked away" path.
  const id = await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.getByText("This plan reorganizes the widget cache")).toBeVisible();
  await waitPastSafeModeGrace(page);

  const plus = await revealGutterPlus(page, 3);
  await plus.click();
  const composer = page.getByRole("dialog", { name: "Add a comment" });
  await expect(composer.locator(".cm-editor")).toBeVisible();
  await page.keyboard.type("keep me for later");

  await page.keyboard.press("Escape");
  await expect(composer.locator(".cm-editor.cm-focused")).toHaveCount(0);
  await expect(composer).toBeVisible(); // still open, not dismissed

  await page.keyboard.press("Escape");
  await expect(composer).toHaveCount(0); // dismissed
  await expect(page.getByRole("button", { name: "Resume unsent comment" })).toBeVisible();
  await expect
    .poll(async () => (await daemon.getReview(id)).body?.composerScratches?.length ?? 0)
    .toBe(1);
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
  const id = await daemon.seed({ plan: RANGE_PLAN });
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.getByText("Body line 1 content here.")).toBeVisible();
  await waitPastSafeModeGrace(page);

  // Composer A: open on line 3 via a line-body click and give it text, matching
  // the reported repro (the first field holds an in-progress draft when the
  // second is opened).
  const composer = page.getByRole("dialog", { name: "Add a comment" });
  await page.getByText("Body line 1 content here.").click();
  await expect(composer.getByText("Line 3")).toBeVisible();
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
  await expect
    .poll(async () => (await daemon.getReview(id)).body?.annotations?.length ?? 0)
    .toBe(1);
  const ann = (await daemon.getReview(id)).body?.annotations?.[0];
  expect(ann).toMatchObject({ startLine: 7, endLine: 7, comment: "hellX" });
});

test("an unsubmitted composer scratch survives a page reload (EXC-744)", async ({
  daemon,
  page,
}) => {
  const id = await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.getByText("This plan reorganizes the widget cache")).toBeVisible();

  // Type a comment on line 3 and Keep it for later instead of submitting: it is
  // retained as a "scratch" that leaves a Resume marker on the line.
  const plus = await revealGutterPlus(page, 3);
  await plus.click();
  const composer = page.getByRole("dialog", { name: "Add a comment" });
  await expect(composer).toBeVisible();
  await composerInput(composer).fill("Half-written thought to finish later.");
  await composer.getByRole("button", { name: "Keep for later" }).click();

  const marker = page.getByRole("button", { name: "Resume unsent comment" });
  await expect(marker).toBeVisible();
  await expect(marker).toContainText("Half-written thought to finish later.");

  // The scratch persists to the daemon through the draft autosave (the fix): the
  // review now carries a composer scratch.
  await expect
    .poll(async () => (await daemon.getReview(id)).body?.composerScratches?.length ?? 0)
    .toBe(1);

  // Reload. Before the fix the marker vanished (scratches lived only in memory);
  // now it rehydrates from the persisted scratch.
  await page.reload();
  await expect(page.locator(".diff-plan")).toBeVisible();
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
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.getByText("Body line 1 content here.")).toBeVisible();
  // The submit chord below is this test's first keydown — everything before it is
  // mouse — so it lands ~330ms after mount, clearing the 300ms grace by as little
  // as 11ms under load. Without this the guard eats it and the composer never
  // closes (EXC-897).
  await waitPastSafeModeGrace(page);

  // Select lines 5–8 by dragging the number column, then open the composer from
  // the gutter + that the selection reveals.
  await selectGutterRange(page, 5, 8);
  const plus = page.locator(".diffview [data-utility-button]");
  await expect(plus).toBeVisible();
  await plus.click();

  const composer = page.getByRole("dialog", { name: "Add a comment" });
  await expect(composer).toBeVisible();
  await expect(composer.getByText("Lines 5–8")).toBeVisible();
  const rangeInput = composerInput(composer);
  await rangeInput.fill("This whole block needs a rewrite.");
  // Submit via the keyboard chord; focus the input first so the chord lands on it.
  await rangeInput.click();
  await page.keyboard.press("ControlOrMeta+Enter");

  await expect(composer).toHaveCount(0);
  await expect
    .poll(async () => (await daemon.getReview(id)).body?.annotations?.length ?? 0)
    .toBe(1);
  const ann = (await daemon.getReview(id)).body?.annotations?.[0];
  expect(ann).toMatchObject({ startLine: 5, endLine: 8 });
});

test("a shift-extend selection reaches the composer with an ascending range", async ({
  daemon,
  page,
}) => {
  // The keyboard-additive path: anchor a line, Shift-click a later one to extend
  // the span, then open the composer from the gutter +. It must land the same
  // ascending Lines X–Y the drag does, so the keyboard path stays equivalent.
  const id = await daemon.seed({ plan: RANGE_PLAN });
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.getByText("Body line 1 content here.")).toBeVisible();

  await shiftExtendSelection(page, 4, 9);
  const plus = page.locator(".diffview [data-utility-button]");
  await expect(plus).toBeVisible();
  await plus.click();

  const composer = page.getByRole("dialog", { name: "Add a comment" });
  await expect(composer).toBeVisible();
  await expect(composer.getByText("Lines 4–9")).toBeVisible();
  await composerInput(composer).fill("Shift-extended this span.");
  await composer.getByRole("button", { name: "Comment" }).click();

  await expect(composer).toHaveCount(0);
  await expect
    .poll(async () => (await daemon.getReview(id)).body?.annotations?.length ?? 0)
    .toBe(1);
  expect((await daemon.getReview(id)).body?.annotations?.[0]).toMatchObject({
    startLine: 4,
    endLine: 9,
  });
});

test("a bottom-up drag normalizes to an ascending span", async ({ daemon, page }) => {
  // Dragging the number column upward (endLine < startLine) must still persist an
  // ascending {startLine, endLine} — this locks commenting.ts's Math.min/max
  // normalization against regression, the invariant the live readout shares.
  const id = await daemon.seed({ plan: RANGE_PLAN });
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.getByText("Body line 1 content here.")).toBeVisible();

  // Drag from line 9 up to line 5 — the gesture runs bottom-up.
  await selectGutterRange(page, 9, 5);
  const plus = page.locator(".diffview [data-utility-button]");
  await expect(plus).toBeVisible();
  await plus.click();

  const composer = page.getByRole("dialog", { name: "Add a comment" });
  await expect(composer).toBeVisible();
  // Ascending despite the upward drag.
  await expect(composer.getByText("Lines 5–9")).toBeVisible();
  await composerInput(composer).fill("Dragged upward.");
  await composer.getByRole("button", { name: "Comment" }).click();

  await expect(composer).toHaveCount(0);
  await expect
    .poll(async () => (await daemon.getReview(id)).body?.annotations?.length ?? 0)
    .toBe(1);
  expect((await daemon.getReview(id)).body?.annotations?.[0]).toMatchObject({
    startLine: 5,
    endLine: 9,
  });
});

test("dragging across the code body opens the range composer on release", async ({
  daemon,
  page,
}) => {
  // The headline gesture (EXC-639): click-drag across the code body — not the
  // narrow gutter — selects the span and opens the composer on release, with no
  // separate + click. Submitting persists the ascending {startLine, endLine}.
  const id = await daemon.seed({ plan: RANGE_PLAN });
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.getByText("Body line 1 content here.")).toBeVisible();

  await dragLineBody(page, 4, 8);

  const composer = page.getByRole("dialog", { name: "Add a comment" });
  await expect(composer).toBeVisible();
  await expect(composer.getByText("Lines 4–8")).toBeVisible();
  await composerInput(composer).fill("Range from a body drag.");
  await composer.getByRole("button", { name: "Comment" }).click();

  await expect(composer).toHaveCount(0);
  await expect
    .poll(async () => (await daemon.getReview(id)).body?.annotations?.length ?? 0)
    .toBe(1);
  expect((await daemon.getReview(id)).body?.annotations?.[0]).toMatchObject({
    startLine: 4,
    endLine: 8,
  });
});

test("holding Shift while dragging the code body opens no composer (text-select escape-hatch)", async ({
  daemon,
  page,
}) => {
  // The copy escape-hatch: a Shift+drag bows out of the comment gesture so the
  // browser selects text natively. We assert the deterministic half — no composer
  // opens — rather than that text got selected (a synthetic drag selecting text is
  // too flaky in headless Chromium to assert on).
  await daemon.seed({ plan: RANGE_PLAN });
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.getByText("Body line 1 content here.")).toBeVisible();

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
  await daemon.seed({ plan: RANGE_PLAN });
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.getByText("Body line 1 content here.")).toBeVisible();

  const x = await page
    .locator(".diff-plan")
    .evaluate((el) => el.getBoundingClientRect().x + el.getBoundingClientRect().width / 2);
  const readUserSelect = () =>
    page.evaluate(() => {
      const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot ?? null;
      const line = sh?.querySelector("[data-line]");
      return line == null ? null : getComputedStyle(line).userSelect;
    });

  // Selectable at rest...
  expect(await readUserSelect()).not.toBe("none");

  // ...unselectable while a plain drag is held...
  await page.mouse.move(x, await lineCenterY(page, 4));
  await page.mouse.down();
  await page.mouse.move(x, await lineCenterY(page, 8), { steps: 12 });
  expect(await readUserSelect()).toBe("none");

  // ...and selectable again once the drag releases.
  await page.mouse.up();
  expect(await readUserSelect()).not.toBe("none");
});

test("a live readout previews the range during the drag and clears on release", async ({
  daemon,
  page,
}, testInfo) => {
  // The headline interaction: as the drag grows the selection, a live "Lines X–Y"
  // readout tracks it before release; on release it disappears with no residue.
  await daemon.seed({ plan: RANGE_PLAN });
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.getByText("Body line 1 content here.")).toBeVisible();

  const readout = page.locator(".drag-readout");
  await expect(readout).toHaveCount(0);

  // Press on line 4's number cell and drag down to line 8, holding the button so
  // the selection is mid-gesture (not yet released).
  const start = await gutterCellCenter(page, 4);
  const end = await gutterCellCenter(page, 8);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });

  // The readout shows the ascending span while the button is still held.
  await expect(readout).toBeVisible();
  await expect(readout).toHaveText("Lines 4–8");

  // Baseline screenshot of the active selection + live readout.
  await page.screenshot({ path: testInfo.outputPath("active-selection.png") });

  // Release: the readout disappears, leaving no residue.
  await page.mouse.up();
  await expect(readout).toHaveCount(0);
});

test("dismissing the composer clears the line-selection highlight", async ({ daemon, page }) => {
  // Opening the composer from the gutter + selects the line (the library highlights
  // it amber). Dismissing the composer must clear that highlight — otherwise it
  // lingers on the line after the reviewer moves on.
  await daemon.seed({ plan: RANGE_PLAN });
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.getByText("Body line 1 content here.")).toBeVisible();
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
  await composerInput(composer).press("Escape");
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
  await daemon.seed({ plan: RANGE_PLAN });
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.getByText("Body line 1 content here.")).toBeVisible();

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
  await expect(page.locator(".diff-plan")).toBeVisible();
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
  await expect(page.locator(".diff-plan")).toBeVisible();
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
  // No button until the pointer is over the block.
  await expect(copy).toHaveCount(0);

  // Hover the center of an interior code line (line 6) to reveal the button.
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
  // Confirmation: the label/glyph swaps to the checkmark…
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  // …the clipboard holds the block's code with the fence lines stripped…
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toBe("const x: number = compute();\nreturn x + 1;");
  // …and it reverts to the copy glyph.
  await expect(page.getByRole("button", { name: "Copy code" })).toBeVisible({ timeout: 3000 });
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

  // Park the cursor on block A's interior code line; the button appears on block A.
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
  await daemon.seed({ plan: TALL_PLAN });
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.getByText("Line 1 of the plan body")).toBeVisible();

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
  await daemon.seed({ plan: RANGE_PLAN });
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.getByText("Body line 1 content here.")).toBeVisible();

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
  // as a scratch (see the scratch-draft tests below). This pins the empty case.
  const id = await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.getByText("This plan reorganizes the widget cache")).toBeVisible();
  // Past Safe Mode's grace/suppression window, which would otherwise swallow the
  // first keystroke (the Escape) as an accidental interruption.
  await waitPastSafeModeGrace(page);

  const plus = await revealGutterPlus(page, 3);
  await plus.click();

  const composer = page.getByRole("dialog", { name: "Add a comment" });
  await expect(composer).toBeVisible();
  // Two-stage Escape: the first blurs into the card, the second dismisses. An
  // empty box has nothing to keep, so dismissing leaves no residue.
  await composerInput(composer).press("Escape");
  await page.keyboard.press("Escape");

  // The composer is gone, no scratch marker appears, and nothing was persisted.
  await expect(composer).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Resume unsent comment" })).toHaveCount(0);
  await expect
    .poll(async () => (await daemon.getReview(id)).body?.annotations?.length ?? 0)
    .toBe(0);
});

// ----- Scratch drafts: an unsubmitted composer dismissed with text is retained
// as a returnable "Resume" marker (EXC-634). Distinct from a committed "Draft"
// annotation: a scratch was never added to the working copy. -----

/** The Resume marker the host renders for a retained scratch draft. */
function scratchMarker(page: Page): Locator {
  return page.getByRole("button", { name: "Resume unsent comment" });
}

test("Keep for later retains a returnable Resume marker", async ({ daemon, page }) => {
  const id = await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.getByText("This plan reorganizes the widget cache")).toBeVisible();
  await waitPastSafeModeGrace(page);

  const plus = await revealGutterPlus(page, 3);
  await plus.click();
  const composer = page.getByRole("dialog", { name: "Add a comment" });
  await expect(composer).toBeVisible();
  const textarea = composerInput(composer);
  await textarea.fill("half a thought to finish later");
  await composer.getByRole("button", { name: "Keep for later" }).click();

  // The composer closes; a quiet Resume marker takes its place, previewing the
  // text. It reads "Resume" (an action), never "Draft" (the committed-annotation
  // state), so the two never look the same.
  await expect(composer).toHaveCount(0);
  const marker = scratchMarker(page);
  await expect(marker).toBeVisible();
  await expect(marker).toContainText("Resume");
  await expect(marker).not.toContainText("Draft");
  await expect(marker).toContainText("half a thought to finish later");

  // Nothing is persisted — a scratch is in-memory only, not a created annotation.
  await expect
    .poll(async () => (await daemon.getReview(id)).body?.annotations?.length ?? 0)
    .toBe(0);
});

test("the Discard button discards a typed draft, leaving no Resume marker", async ({
  daemon,
  page,
}) => {
  const id = await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.getByText("This plan reorganizes the widget cache")).toBeVisible();
  await waitPastSafeModeGrace(page);

  const plus = await revealGutterPlus(page, 3);
  await plus.click();
  const composer = page.getByRole("dialog", { name: "Add a comment" });
  await composerInput(composer).fill("drop this via the button");
  await composer.getByRole("button", { name: "Discard" }).click();
  // Confirm the discard (EXC-749).
  await page.locator(".confirm-popover .confirm").click();

  await expect(composer).toHaveCount(0);
  await expect(scratchMarker(page)).toHaveCount(0);
  await expect
    .poll(async () => (await daemon.getReview(id)).body?.composerScratches?.length ?? 0)
    .toBe(0);
});

test("canceling a Discard keeps the composer open", async ({ daemon, page }) => {
  // The confirmation's whole point: an accidental Discard is recoverable.
  // Canceling backs out and leaves the composer (and its draft) in place.
  await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.getByText("This plan reorganizes the widget cache")).toBeVisible();
  await waitPastSafeModeGrace(page);

  const plus = await revealGutterPlus(page, 3);
  await plus.click();
  const composer = page.getByRole("dialog", { name: "Add a comment" });
  await composerInput(composer).fill("do not lose me");
  await composer.getByRole("button", { name: "Discard" }).click();

  await expect(page.locator(".confirm-popover")).toBeVisible();
  await page.locator(".confirm-popover .cancel").click();
  await expect(page.locator(".confirm-popover")).toHaveCount(0);
  await expect(composer).toBeVisible();
});

test("resuming a kept scratch then Discarding removes the marker and un-persists it", async ({
  daemon,
  page,
}) => {
  // Keep for later persists a scratch; resuming consumes it back into the
  // composer; Discarding then drops it for good — the persisted scratch is
  // removed, not merely hidden.
  const id = await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.getByText("This plan reorganizes the widget cache")).toBeVisible();
  await waitPastSafeModeGrace(page);

  const plus = await revealGutterPlus(page, 3);
  await plus.click();
  const composer = page.getByRole("dialog", { name: "Add a comment" });
  await composerInput(composer).fill("keep then change my mind");
  await composer.getByRole("button", { name: "Keep for later" }).click();

  const marker = scratchMarker(page);
  await expect(marker).toBeVisible();
  await expect
    .poll(async () => (await daemon.getReview(id)).body?.composerScratches?.length ?? 0)
    .toBe(1);

  // Resume it, then Discard: the marker is gone and the persisted scratch cleared.
  await marker.click();
  await expect(composer).toBeVisible();
  await composer.getByRole("button", { name: "Discard" }).click();
  // Confirm the discard (EXC-749).
  await page.locator(".confirm-popover .confirm").click();

  await expect(composer).toHaveCount(0);
  await expect(scratchMarker(page)).toHaveCount(0);
  await expect
    .poll(async () => (await daemon.getReview(id)).body?.composerScratches?.length ?? 0)
    .toBe(0);
});

test("clicking the Resume marker reopens the composer with the text restored", async ({
  daemon,
  page,
}) => {
  await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.getByText("This plan reorganizes the widget cache")).toBeVisible();
  await waitPastSafeModeGrace(page);

  const plus = await revealGutterPlus(page, 3);
  await plus.click();
  const composer = page.getByRole("dialog", { name: "Add a comment" });
  await composerInput(composer).fill("restore this exactly");
  await composer.getByRole("button", { name: "Keep for later" }).click();

  const marker = scratchMarker(page);
  await expect(marker).toBeVisible();
  await marker.click();

  // The composer reopens with the text restored, and the marker is consumed
  // (it moved back into the composer, not duplicated).
  await expect(composer).toBeVisible();
  await expect(composerInput(composer)).toHaveText("restore this exactly");
  await expect(scratchMarker(page)).toHaveCount(0);
});

test("a resumed scratch can be completed into a persisted annotation", async ({ daemon, page }) => {
  const id = await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.getByText("This plan reorganizes the widget cache")).toBeVisible();
  await waitPastSafeModeGrace(page);

  const plus = await revealGutterPlus(page, 3);
  await plus.click();
  const composer = page.getByRole("dialog", { name: "Add a comment" });
  await composerInput(composer).fill("start it");
  await composer.getByRole("button", { name: "Keep for later" }).click();

  await scratchMarker(page).click();
  await expect(composer).toBeVisible();
  const textarea = composerInput(composer);
  await textarea.fill("start it, then finish it");
  await composer.getByRole("button", { name: "Comment" }).click();

  // Submitting graduates the scratch to a real annotation; no marker survives.
  await expect(composer).toHaveCount(0);
  await expect(scratchMarker(page)).toHaveCount(0);
  await expect
    .poll(async () => (await daemon.getReview(id)).body?.annotations?.length ?? 0)
    .toBe(1);
  expect((await daemon.getReview(id)).body?.annotations?.[0]).toMatchObject({
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
  await daemon.seed({ plan: RANGE_PLAN });
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.getByText("Body line 1 content here.")).toBeVisible();
  await waitPastSafeModeGrace(page);

  // Open the composer on line 3 ("Body line 1") via a line-body click and type.
  const composer = page.getByRole("dialog", { name: "Add a comment" });
  await page.getByText("Body line 1 content here.").click();
  await expect(composer.getByText("Line 3")).toBeVisible();
  await composerInput(composer).fill("started on line 3");

  // Switch to line 7 ("Body line 3") without dismissing the line-3 composer.
  await page.getByText("Body line 3 content here.").click();
  await expect(composer.getByText("Line 7")).toBeVisible();

  // The line-3 text survives as a Resume marker; clicking it restores the text.
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
  await daemon.seed({ plan: RANGE_PLAN });
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.getByText("Body line 1 content here.")).toBeVisible();
  await waitPastSafeModeGrace(page);

  const composer = page.getByRole("dialog", { name: "Add a comment" });
  await page.getByText("Body line 1 content here.").click();
  await expect(composer.getByText("Line 3")).toBeVisible();
  await composerInput(composer).fill("started on line 3");

  // Switch to line 7 without dismissing: the new composer opens empty.
  await page.getByText("Body line 3 content here.").click();
  await expect(composer.getByText("Line 7")).toBeVisible();
  await expect(composerInput(composer)).not.toContainText("started on line 3");

  // The line-3 text is safe as a Resume marker, not lost.
  await expect(scratchMarker(page)).toContainText("started on line 3");
});

test("scratch drafts clear when a new plan version arrives", async ({ daemon, page }) => {
  // A scratch's anchor belongs to the version it was typed against; a new version
  // must drop it so it never resumes onto text it was not written for. This
  // mirrors the existing discard-on-content-change guard for the open composer.
  const id = await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.getByText("This plan reorganizes the widget cache")).toBeVisible();
  await waitPastSafeModeGrace(page);

  const plus = await revealGutterPlus(page, 3);
  await plus.click();
  const composer = page.getByRole("dialog", { name: "Add a comment" });
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
  const id = await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.getByText("This plan reorganizes the widget cache")).toBeVisible();
  await waitPastSafeModeGrace(page);

  const dialog = await scratchThenOpenDialog(page, 3, "an unsent thought on line 3");

  // The scratch is listed under "Unsent comments", collapsed (its text shows in
  // the trigger's one-line snippet, the full body behind the collapsed disclosure).
  const section = dialog.locator(".scratches");
  await expect(section).toBeVisible();
  await expect(section).toContainText("Unsent comments");
  await expect(dialog.locator(".scratch-row")).toHaveCount(1);
  await expect(section).toContainText("an unsent thought on line 3");

  // It does not count as a committed comment: the empty-state still shows and
  // the Send button stays disabled (nothing is committed to send).
  await expect(dialog.locator(".summary.empty")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Send for revision" })).toBeDisabled();

  // And nothing is persisted while it sits unsent.
  await expect
    .poll(async () => (await daemon.getReview(id)).body?.annotations?.length ?? 0)
    .toBe(0);
});

test("Saving a scratch graduates it into the sent feedback", async ({ daemon, page }) => {
  const id = await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.getByText("This plan reorganizes the widget cache")).toBeVisible();
  await waitPastSafeModeGrace(page);

  const dialog = await scratchThenOpenDialog(page, 3, "save me into the review");

  // Save it — the action sits outside the collapsed disclosure (EXC-746), so no
  // expand is needed. The scratch leaves the unsent list and becomes a committed
  // comment: the count summary and the preview now include it.
  await dialog.locator(".scratch-row .save").click();

  await expect(dialog.locator(".scratch-row")).toHaveCount(0);
  await expect(dialog.locator(".scratches")).toHaveCount(0);
  await expect(dialog.locator(".summary")).toContainText("1 comment");
  await expect(dialog.locator(".preview pre")).toContainText("save me into the review");

  // Submitting now sends it. It reaches Decision.feedback as a line reference.
  await dialog.getByRole("button", { name: "Send for revision" }).click();
  await expect(page.getByRole("heading", { name: "No plans awaiting review" })).toBeVisible();
  await expect.poll(async () => (await daemon.getReview(id)).body?.decision?.behavior).toBe("deny");
  const feedback = (await daemon.getReview(id)).body?.decision?.feedback ?? "";
  expect(feedback).toContain("Line 3:");
  expect(feedback).toContain("save me into the review");
});

test("Discarding a scratch removes it and never sends it", async ({ daemon, page }) => {
  const id = await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.getByText("This plan reorganizes the widget cache")).toBeVisible();
  await waitPastSafeModeGrace(page);

  const dialog = await scratchThenOpenDialog(page, 3, "discard this draft");

  // Discard sits outside the collapsed disclosure (EXC-746), so no expand is needed.
  // It asks to confirm before dropping the draft (EXC-762).
  await dialog.locator(".scratch-row .discard").click();
  // The confirm bubble portals to the body (viewport-aware, EXC-762), so it's a
  // page locator rather than a descendant of the dialog element.
  await page.locator(".confirm-popover").getByRole("button", { name: "Discard" }).click();

  // The scratch is gone from the dialog, and the underlying Resume marker is gone
  // too — Discard drops it from the review entirely.
  await expect(dialog.locator(".scratches")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(scratchMarker(page)).toHaveCount(0);

  // Nothing was ever persisted.
  await expect
    .poll(async () => (await daemon.getReview(id)).body?.annotations?.length ?? 0)
    .toBe(0);
});

test("submitting with an unsaved scratch sends only committed comments", async ({
  daemon,
  page,
}) => {
  // The default: an unsaved scratch is NOT silently included. A general comment
  // makes the submit possible; the scratch left unsent must not reach feedback.
  const id = await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.getByText("This plan reorganizes the widget cache")).toBeVisible();
  await waitPastSafeModeGrace(page);

  const dialog = await scratchThenOpenDialog(page, 3, "must not be sent unsaved");

  // Type a general comment and submit, leaving the scratch unsaved.
  await dialog
    .getByRole("textbox", { name: "General comment" })
    .fill("Please revise the cache section.");
  await dialog.getByRole("button", { name: "Send for revision" }).click();
  await expect(page.getByRole("heading", { name: "No plans awaiting review" })).toBeVisible();

  await expect.poll(async () => (await daemon.getReview(id)).body?.decision?.behavior).toBe("deny");
  const feedback = (await daemon.getReview(id)).body?.decision?.feedback ?? "";
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
  await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.getByText("This plan reorganizes the widget cache")).toBeVisible();

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
  await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.getByText("This plan reorganizes the widget cache")).toBeVisible();

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
  await expect(page.locator(".diff-plan")).toBeVisible();

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
  await daemon.seed({ plan: RANGE_PLAN });
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.getByText("Body line 1 content here.")).toBeVisible();

  // At rest — mouse parked off any line — the gutter `+` is not shown.
  await page.mouse.move(0, 0);
  const plus = page.locator(".diffview [data-utility-button]");
  await expect(plus).toBeHidden();

  // Hover the body of line 3 ("Body line 1") at the view's horizontal centre, well
  // clear of the gutter, to prove the whole line is the hover target.
  const y = await lineCenterY(page, 3);
  const cx = await page
    .locator(".diff-plan")
    .evaluate((el) => el.getBoundingClientRect().x + el.getBoundingClientRect().width / 2);
  await page.mouse.move(cx, y);

  // The `+` reveals on the hovered row…
  await expect(plus).toBeVisible();

  // …exactly one line carries the library's hover marker, and its resolved
  // background differs from a resting sibling's — the lift took effect, scoped to
  // that line.
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
  await daemon.seed({ plan: RANGE_PLAN });
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.getByText("Body line 1 content here.")).toBeVisible();

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
  const composer = page.getByRole("dialog", { name: "Add a comment" });
  const t0 = await page.evaluate(() => performance.now());
  await page.waitForFunction((t) => performance.now() > t + 300, t0);
  await expect(composer).toHaveCount(0);
});

test("an inline card collapses to a chip and expands again", async ({ daemon, page }) => {
  await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.getByText("This plan reorganizes the widget cache")).toBeVisible();

  await createAnnotation(page, 3, "Tighten this paragraph.");
  const card = page.locator("[data-annotation-card]");
  await expect(card.locator(".body")).toBeVisible();

  // Collapse: the body's grid row shrinks to zero height (it stays mounted for the
  // reveal, so it goes not-visible rather than leaving the DOM), leaving the chip.
  await card.getByRole("button", { name: "Collapse comment" }).click();
  await expect(card.locator(".body")).not.toBeVisible();
  await expect(card.locator(".chip")).toBeVisible();

  // Expand again by clicking the chip; the full comment returns.
  await card.locator(".chip").click();
  await expect(card.locator(".body")).toBeVisible();
  await expect(card.getByText("Tighten this paragraph.")).toBeVisible();
});

test("the composer reveal and the card swap share one opacity-only token transition", async ({
  daemon,
  page,
}) => {
  await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.getByText("This plan reorganizes the widget cache")).toBeVisible();

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
  // --dur-fast is 120ms.
  expect(composerMotion.duration).toBe("0.12s");
  // Opacity only — no scale bounce, no translate.
  expect(composerMotion.transform).toBe("none");

  // The saved card reveals on the same contract: a one-shot opacity fade as it
  // settles into the document, no transform bounce. (The expand/collapse height
  // reveal is a separate grid-rows transition, exercised below.)
  await composerInput(composer).fill("Same considered reveal.");
  await composer.getByRole("button", { name: "Comment" }).click();
  await expect(composer).toHaveCount(0);
  const card = page.locator("[data-annotation-card]");
  await expect(card).toBeVisible();
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
  await expect(page.locator(".diff-plan")).toBeVisible();
  await createAnnotation(page, 3, "Whimsy, please.");

  const discard = page.locator("[data-annotation-card]").getByRole("button", { name: "Discard" });
  await discard.hover();
  const iconAnimation = await discard
    .locator(".icon")
    .evaluate((el) => getComputedStyle(el).animationName);
  expect(iconAnimation).toBe("trash-shake");
});

test("deleting an inline card removes the annotation", async ({ daemon, page }) => {
  const id = await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.getByText("This plan reorganizes the widget cache")).toBeVisible();

  await createAnnotation(page, 3, "Drop this section.");
  await expect
    .poll(async () => (await daemon.getReview(id)).body?.annotations?.length ?? 0)
    .toBe(1);

  await page.locator("[data-annotation-card]").getByRole("button", { name: "Discard" }).click();
  // Discarding a submitted comment can't be undone, so confirm first (EXC-749).
  await page.locator(".confirm-popover .confirm").click();

  // The card leaves the DOM and the delete persists through /draft.
  await expect(page.locator("[data-annotation-card]")).toHaveCount(0);
  await expect
    .poll(async () => (await daemon.getReview(id)).body?.annotations?.length ?? 0)
    .toBe(0);
});

test("canceling a delete keeps the inline card", async ({ daemon, page }) => {
  // Deleting a submitted comment is irreversible; canceling the confirm must
  // leave the card and its persisted annotation untouched (EXC-749).
  const id = await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.getByText("This plan reorganizes the widget cache")).toBeVisible();

  await createAnnotation(page, 3, "Keep this section.");
  await page.locator("[data-annotation-card]").getByRole("button", { name: "Discard" }).click();

  await expect(page.locator(".confirm-popover")).toBeVisible();
  await page.locator(".confirm-popover .cancel").click();
  await expect(page.locator(".confirm-popover")).toHaveCount(0);
  await expect(page.locator("[data-annotation-card]")).toHaveCount(1);
  await expect
    .poll(async () => (await daemon.getReview(id)).body?.annotations?.length ?? 0)
    .toBe(1);
});

test("editing an inline card rewrites the comment and persists it", async ({ daemon, page }) => {
  const id = await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.getByText("This plan reorganizes the widget cache")).toBeVisible();

  await createAnnotation(page, 3, "Original note.");
  await expect
    .poll(async () => (await daemon.getReview(id)).body?.annotations?.[0]?.comment)
    .toBe("Original note.");

  // Enter edit mode; the textarea seeds with the current comment, then rewrite it
  // and submit with the keyboard chord.
  const card = page.locator("[data-annotation-card]");
  await card.getByRole("button", { name: "Edit" }).click();
  const textarea = card.getByRole("textbox", { name: "Edit comment" });
  await expect(textarea).toHaveText("Original note.");
  await textarea.fill("Revised note with more detail.");
  await page.keyboard.press("ControlOrMeta+Enter");

  // The card returns to its read view showing the new text, and /draft carries it.
  await expect(card.getByText("Revised note with more detail.")).toBeVisible();
  await expect(card.getByRole("textbox", { name: "Edit comment" })).toHaveCount(0);
  await expect
    .poll(async () => (await daemon.getReview(id)).body?.annotations?.[0]?.comment)
    .toBe("Revised note with more detail.");
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
  await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.getByText("This plan reorganizes the widget cache")).toBeVisible();

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
  await expect(page.locator(".diff-plan")).toBeVisible();
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
  await daemon.seed({ plan: TALL_PLAN });
  await page.goto("/");
  const view = page.locator(".diff-plan");
  await expect(view).toBeVisible();
  await expect(page.getByText("Line 1 of the plan body")).toBeVisible();
  await view.evaluate((el) => {
    el.scrollTop = 0;
  });

  // A plain click on the first body line (near the very top) opens its composer.
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
  await daemon.seed({ plan: TALL_PLAN });
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.getByText("Line 1 of the plan body")).toBeVisible();

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
  await expect(page.locator(".diff-plan")).toBeVisible();
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
  // The submit chord below is the first keydown of every test that funnels through
  // here — the drag, the gutter +, and the fill are all mouse — so it lands ~330ms
  // after mount, clearing the 300ms grace by as little as 11ms under load. Without
  // this the guard eats it and the composer never closes (EXC-897).
  await waitPastSafeModeGrace(page);
  await selectGutterRange(page, start, end);
  const plus = page.locator(".diffview [data-utility-button]");
  await expect(plus).toBeVisible();
  await plus.click();
  const composer = page.getByRole("dialog", { name: "Add a comment" });
  await expect(composer).toBeVisible();
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
  await daemon.seed({ plan: BRACKET_PLAN });
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.getByText("Body line 1 content here.")).toBeVisible();

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
  await daemon.seed({ plan: BRACKET_PLAN });
  await page.goto("/");
  const view = page.locator(".diff-plan");
  await expect(view).toBeVisible();
  await expect(page.getByText("Body line 1 content here.")).toBeVisible();

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
    await daemon.seed({ plan: BRACKET_PLAN });
    await page.goto("/");
    await expect(page.locator(".diff-plan")).toBeVisible();
    await expect(page.getByText("Body line 1 content here.")).toBeVisible();

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

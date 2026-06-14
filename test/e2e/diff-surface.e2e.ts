// Dev-flagged source-view surface (EXC-583). With the flag on, the plan renders
// as line-numbered markdown source through the @pierre/diffs wrapper instead of
// the legacy plan view + contents rail. A left-hand filterable contents pane
// jumps to headings, the line gutter creates comments (EXC-584), and approve and
// request-changes still round-trip. The view instance must survive the 2s poll
// with no scroll reset.

import type { Locator, Page } from "@playwright/test";
import { expect, test, waitPastSafeModeGrace } from "./support/fixtures.ts";

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

  await page.getByRole("button", { name: "Approve", exact: true }).click();

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
  const dialog = page.getByRole("dialog", { name: "Request changes" });
  await page.getByRole("button", { name: "Request changes" }).click();
  await expect(dialog).toBeVisible();
  await dialog.locator("textarea").fill(feedback);
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
  await composer.locator("textarea").fill("Quantify the cold cost here.");
  await composer.getByRole("button", { name: "Comment" }).click();

  // The composer closes and the annotation persists line-anchored via /draft.
  await expect(composer).toHaveCount(0);
  await expect
    .poll(async () => (await daemon.getReview(id)).body?.annotations?.length ?? 0)
    .toBe(1);
  const ann = (await daemon.getReview(id)).body?.annotations?.[0];
  expect(ann).toMatchObject({ startLine: 3, endLine: 3, comment: "Quantify the cold cost here." });
});

test("creating a range annotation from the gutter persists the correct line span", async ({
  daemon,
  page,
}) => {
  const id = await daemon.seed({ plan: RANGE_PLAN });
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.getByText("Body line 1 content here.")).toBeVisible();

  // Select lines 5–8 by dragging the number column, then open the composer from
  // the gutter + that the selection reveals.
  await selectGutterRange(page, 5, 8);
  const plus = page.locator(".diffview [data-utility-button]");
  await expect(plus).toBeVisible();
  await plus.click();

  const composer = page.getByRole("dialog", { name: "Add a comment" });
  await expect(composer).toBeVisible();
  await expect(composer.getByText("Lines 5–8")).toBeVisible();
  const rangeInput = composer.locator("textarea");
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

test("cancelling the composer with Escape leaves no residue", async ({ daemon, page }) => {
  const id = await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.getByText("This plan reorganizes the widget cache")).toBeVisible();

  const plus = await revealGutterPlus(page, 3);
  await plus.click();

  const composer = page.getByRole("dialog", { name: "Add a comment" });
  await expect(composer).toBeVisible();
  const textarea = composer.locator("textarea");
  await textarea.fill("discard me");
  await textarea.click();
  await page.keyboard.press("Escape");

  // The composer is gone from the DOM and nothing was persisted.
  await expect(composer).toHaveCount(0);
  // Wait out the autosave debounce window and confirm no annotation landed.
  await expect
    .poll(async () => (await daemon.getReview(id)).body?.annotations?.length ?? 0)
    .toBe(0);
});

// ----- Inline annotation cards: collapse/expand + delete (EXC-581) -----

/** Create a single-line annotation on `line` via the gutter, returning once the
 * card for it is on screen. */
async function createAnnotation(page: Page, line: number, comment: string): Promise<void> {
  const plus = await revealGutterPlus(page, line);
  await plus.click();
  const composer = page.getByRole("dialog", { name: "Add a comment" });
  await expect(composer).toBeVisible();
  await composer.locator("textarea").fill(comment);
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

test("an inline card collapses to a chip and expands again", async ({ daemon, page }) => {
  await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.getByText("This plan reorganizes the widget cache")).toBeVisible();

  await createAnnotation(page, 3, "Tighten this paragraph.");
  const card = page.locator("[data-annotation-card]");
  await expect(card.locator(".body")).toBeVisible();

  // Collapse: the body disappears, leaving the compact chip.
  await card.getByRole("button", { name: "Collapse comment" }).click();
  await expect(card.locator(".body")).toHaveCount(0);
  await expect(card.locator(".chip")).toBeVisible();

  // Expand again by clicking the chip; the full comment returns.
  await card.locator(".chip").click();
  await expect(card.locator(".body")).toBeVisible();
  await expect(card.getByText("Tighten this paragraph.")).toBeVisible();
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

  await page.locator("[data-annotation-card]").getByRole("button", { name: "delete" }).click();

  // The card leaves the DOM and the delete persists through /draft.
  await expect(page.locator("[data-annotation-card]")).toHaveCount(0);
  await expect
    .poll(async () => (await daemon.getReview(id)).body?.annotations?.length ?? 0)
    .toBe(0);
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
  await card.getByRole("button", { name: "edit" }).click();
  const textarea = card.getByRole("textbox", { name: "Edit comment" });
  await expect(textarea).toHaveValue("Original note.");
  await textarea.fill("Revised note with more detail.");
  await page.keyboard.press("ControlOrMeta+Enter");

  // The card returns to its read view showing the new text, and /draft carries it.
  await expect(card.getByText("Revised note with more detail.")).toBeVisible();
  await expect(card.getByRole("textbox", { name: "Edit comment" })).toHaveCount(0);
  await expect
    .poll(async () => (await daemon.getReview(id)).body?.annotations?.[0]?.comment)
    .toBe("Revised note with more detail.");
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
  await selectGutterRange(page, start, end);
  const plus = page.locator(".diffview [data-utility-button]");
  await expect(plus).toBeVisible();
  await plus.click();
  const composer = page.getByRole("dialog", { name: "Add a comment" });
  await expect(composer).toBeVisible();
  const textarea = composer.locator("textarea");
  await textarea.fill(comment);
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

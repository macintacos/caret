// The plan's table-of-contents popup (EXC-1095 built the surface, EXC-1096 gives it
// this contract). The popup is a bits-ui Popover holding a Command: a filter field
// over a listbox of every heading, nested by level, with the one being read marked.
//
// Everything asserted here needs a real browser, which is why it is a spec rather
// than an extension of ui/src/components/PlanToc.test.ts (browser-testing.md). The
// keyboard walk is bits-ui's roving selection driven by real keydown; Escape,
// outside-click and focus restoration are the popover's own interaction semantics;
// "the current heading is scrolled into view" is a scroll measurement against a real
// box; and the narration attributes are read back off the live DOM, where a screen
// reader would find them. The pure half — the filtered tree's shape, the marked row,
// the a11y attributes' presence on a mounted popup — is that unit suite, and the
// vendored primitive's own viewport wiring is pinned in
// ui/src/lib/shadcn-command-popover.test.ts.
//
// Bare keys throughout, per the issue's constraint: a command modifier means the
// reviewer is addressing the browser or the OS, not the popup. waitPastSafeModeGrace
// (inside jumpToHeading) is mandatory before the first keystroke.

import type { Locator, Page } from "@playwright/test";

import { expect, test } from "@test/e2e/support/fixtures.ts";
import { jumpToHeading, PLAN_SURFACE, planSurface } from "@test/e2e/support/source-view.ts";

// Sections taller than the viewport, so jumping to one genuinely changes which
// heading is being read rather than leaving the whole plan in view.
const filler = (label: string) =>
  Array.from({ length: 30 }, (_, i) => `${label} detail line ${i + 1} keeps this tall.`).join("\n");

// Exactly ONE `#` on purpose, here and below: the daemon normalizes a posted plan to a
// single top-level heading and demotes every later one, so a fixture with two would be
// stored with the second at level 2 and quietly change the tree these specs assert.

// Twelve sections under one top-level heading — enough rows that the popup's list
// overflows its 18rem max-height, which is what makes "the current heading is scrolled
// into view on open" a claim about scrolling rather than about a list that fits whole.
const SECTIONS = [
  "Alpha",
  "Bravo",
  "Charlie",
  "Delta",
  "Echo",
  "Foxtrot",
  "Golf",
  "Hotel",
  "India",
  "Juliet",
  "Kilo",
  "Lima",
];
const TALL_PLAN = ["# Plan", filler("Plan"), ...SECTIONS.flatMap((s) => [`## ${s}`, filler(s)])]
  .join("\n\n")
  .concat("\n");

// Two matches for "notes" sitting in different branches, so filtering leaves a dimmed
// ancestor ("Rollout") BETWEEN the two selectable rows — the arrangement the roving
// walk has to step over, and the nesting the flat breadcrumbs filter cannot express.
const NESTED_PLAN = [
  "# Plan",
  filler("Plan"),
  "## Setup",
  filler("Setup"),
  "### Setup notes",
  filler("Setup notes"),
  "## Rollout",
  filler("Rollout"),
  "### Rollout notes",
  filler("Rollout notes"),
  "## Wrapup",
  filler("Wrapup"),
  "",
].join("\n\n");

const TOC = ".plan-toc-panel";

const trigger = (page: Page) => page.getByRole("button", { name: "Contents" });
const listbox = (page: Page) => page.locator(`${TOC} [data-slot='command-list']`);
const options = (page: Page) => page.locator(`${TOC} [role='option']`);
const contextRows = (page: Page) => page.locator(`${TOC} .toc-context`);
/** Scoped to the panel deliberately: the breadcrumbs bar's own filter publishes the
 * SAME accessible name, so an unscoped query would collect both. */
const field = (page: Page) => page.locator(`${TOC} input[aria-label='Filter headings']`);
/** The row the roving walk is on. bits-ui marks it `data-selected`; the reader is told
 * about it through the field's aria-activedescendant, asserted in its own test below. */
const walkedTo = (page: Page) => page.locator(`${TOC} [role='option'][data-selected]`);

/** Open the popup and wait for its rows. */
async function openToc(page: Page): Promise<void> {
  await trigger(page).click();
  await expect(listbox(page)).toBeVisible();
  await expect(options(page).first()).toBeVisible();
}

/** Load the plan and park the reading position on `heading`. */
async function readingAt(page: Page, heading: string): Promise<void> {
  await planSurface(page);
  await jumpToHeading(page, heading);
  await expect
    .poll(() => new URL(page.url()).searchParams.get("heading"))
    .toBe(heading.toLowerCase().replaceAll(" ", "-"));
}

/** Whether `row` is inside the scrolled list's visible box — the claim a unit mount
 * cannot make, since happy-dom lays nothing out. */
async function isWithinList(page: Page, row: Locator): Promise<boolean> {
  const rowBox = await row.boundingBox();
  const listBox = await listbox(page).boundingBox();
  if (rowBox === null || listBox === null) return false;
  return rowBox.y >= listBox.y - 1 && rowBox.y + rowBox.height <= listBox.y + listBox.height + 1;
}

test("opens on the heading being read, scrolled into view", async ({ daemon, page }) => {
  await daemon.seed({ plan: TALL_PLAN });
  await page.goto("/");
  // Kilo, not the trailing Lima: the plan scrolls only a third of a viewport past its
  // end, which is not enough room to bring the FINAL heading up to the reading zone, so
  // a jump there clamps short and the tracked heading stays on the section above it.
  // Kilo is still far enough down that a popup opening at the top would leave its row
  // below the list's 18rem fold.
  await readingAt(page, "Kilo");

  await openToc(page);
  const current = options(page).and(page.locator('[aria-current="location"]'));
  await expect(current).toHaveText("Kilo");
  await expect.poll(() => isWithinList(page, current)).toBe(true);

  // And the row above it is not — proof the list really is scrolled rather than short
  // enough to show every heading at once, which would make the assertion vacuous.
  expect(await isWithinList(page, options(page).first())).toBe(false);
});

test("the down arrow starts the walk at the heading being read, not the first row", async ({
  daemon,
  page,
}) => {
  // The deviation from the command's stock behavior, which selects the first row on
  // open. Asserted as the row AFTER the current one: landing on "Echo" is only
  // reachable from a walk that began at "Delta".
  await daemon.seed({ plan: TALL_PLAN });
  await page.goto("/");
  await readingAt(page, "Delta");

  await openToc(page);
  await expect(walkedTo(page)).toHaveText("Delta");

  await page.keyboard.press("ArrowDown");
  await expect(walkedTo(page)).toHaveText("Echo");

  // And back, which lands on the heading being read rather than stepping past it.
  await page.keyboard.press("ArrowUp");
  await expect(walkedTo(page)).toHaveText("Delta");
});

test("the roving walk steps over the dimmed ancestor rows", async ({ daemon, page }) => {
  await daemon.seed({ plan: NESTED_PLAN });
  await page.goto("/");
  await readingAt(page, "Setup");

  await openToc(page);
  await field(page).fill("notes");

  // "Rollout" is kept only to place the match under it, so it sits between the two
  // selectable rows.
  await expect(options(page)).toHaveText(["Setup notes", "Rollout notes"]);
  await expect(contextRows(page)).toHaveText(["Plan", "Setup", "Rollout"]);

  await expect(walkedTo(page)).toHaveText("Setup notes");
  await page.keyboard.press("ArrowDown");
  await expect(walkedTo(page)).toHaveText("Rollout notes");

  // The walk never rested on a dimmed row on the way: they are not command items at
  // all, so there is no state for one to carry.
  await expect(page.locator(`${TOC} .toc-context[data-selected]`)).toHaveCount(0);
});

test("the nesting filter drives the list, not the command's own filter engine", async ({
  daemon,
  page,
}) => {
  // The vendored command ships a fuzzy filter that both hides non-matching rows and
  // RE-SORTS the survivors by score. Turning it off is what lets `filteredHeadingTree`
  // own the list. Falsifiable on document order: the rows keep the order and the
  // indentation the plan gives them, which a score sort would shuffle — and the dimmed
  // ancestors would not survive a filter engine that has no concept of one.
  await daemon.seed({ plan: NESTED_PLAN });
  await page.goto("/");
  await readingAt(page, "Setup");

  await openToc(page);
  await field(page).fill("notes");

  await expect(page.locator(`${TOC} [role='option'], ${TOC} .toc-context`)).toHaveText([
    "Plan",
    "Setup",
    "Setup notes",
    "Rollout",
    "Rollout notes",
  ]);

  // Each row sits at its own heading level, so a match reads at the same indent
  // whether or not its ancestors matched.
  const depths = await page
    .locator(`${TOC} [role='option'], ${TOC} .toc-context`)
    .evaluateAll((els) =>
      els.map((el) => (el as HTMLElement).style.getPropertyValue("--toc-depth")),
    );
  expect(depths).toEqual(["0", "1", "2", "1", "2"]);
});

test("pressing Enter on a walked-to row goes there and leaves focus in the plan", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: TALL_PLAN });
  await page.goto("/");
  await readingAt(page, "Delta");

  await openToc(page);
  await page.keyboard.press("ArrowDown");
  await expect(walkedTo(page)).toHaveText("Echo");
  await page.keyboard.press("Enter");

  await expect(page.locator(TOC)).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.get("heading")).toBe("echo");

  // A pick hands the reviewer to the plan, so the popup's close skips its focus
  // return — the trigger must not be left wearing a focus ring over a plan that has
  // already moved. The body is where the plan's own window-level keys live.
  await expect(trigger(page)).not.toBeFocused();
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe("BODY");
});

test("clicking a heading goes there and dismisses", async ({ daemon, page }) => {
  await daemon.seed({ plan: TALL_PLAN });
  await page.goto("/");
  await readingAt(page, "Alpha");

  await openToc(page);
  await options(page).filter({ hasText: "Hotel" }).click();

  await expect(page.locator(TOC)).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.get("heading")).toBe("hotel");
});

test("Escape dismisses and hands focus back to the trigger", async ({ daemon, page }) => {
  // The other half of the focus split: a dismissal leaves the reviewer where they
  // were, so the trigger takes focus back. Only a pick suppresses that.
  await daemon.seed({ plan: TALL_PLAN });
  await page.goto("/");
  await readingAt(page, "Delta");
  const parked = new URL(page.url()).searchParams.get("heading");

  await openToc(page);
  await page.keyboard.press("Escape");

  await expect(page.locator(TOC)).toHaveCount(0);
  await expect(trigger(page)).toBeFocused();
  // Walking and dismissing moved nothing: only a commit navigates.
  expect(new URL(page.url()).searchParams.get("heading")).toBe(parked);
});

test("clicking outside the popup dismisses it", async ({ daemon, page }) => {
  await daemon.seed({ plan: TALL_PLAN });
  await page.goto("/");
  await readingAt(page, "Delta");

  await openToc(page);
  // A real pointerdown on the plan, placed below the panel's own box rather than on a
  // named element: the panel is anchored under its trigger at the top of the plan, so
  // the first rows sit beneath it and a click there lands on the dismiss layer instead
  // of outside it.
  const panelBox = await page.locator(TOC).boundingBox();
  const planBox = await page.locator(PLAN_SURFACE).boundingBox();
  expect(panelBox).not.toBeNull();
  expect(planBox).not.toBeNull();
  await page.mouse.click(planBox!.x + planBox!.width / 2, panelBox!.y + panelBox!.height + 40);

  await expect(page.locator(TOC)).toHaveCount(0);
});

test("the filter field is empty on every open", async ({ daemon, page }) => {
  // The popup always opens on the whole plan: a query that survived a close would show
  // a narrowed view of a plan the reviewer has since scrolled away from.
  await daemon.seed({ plan: NESTED_PLAN });
  await page.goto("/");
  await readingAt(page, "Setup");

  await openToc(page);
  await field(page).fill("notes");
  await expect(options(page)).toHaveCount(2);

  await page.keyboard.press("Escape");
  await expect(page.locator(TOC)).toHaveCount(0);

  await openToc(page);
  await expect(field(page)).toHaveValue("");
  // And the whole tree is back, not the narrowed one.
  await expect(options(page)).toHaveCount(6);
});

test("the field narrates the row the walk is on, and says so when nothing matches", async ({
  daemon,
  page,
}) => {
  // The accessibility payoff that justified vendoring `command` at all: the field is a
  // real combobox whose aria-activedescendant names the active row, so the list can be
  // walked and narrowed without focus ever leaving it. Read off the live DOM, which is
  // where a screen reader would read it.
  await daemon.seed({ plan: NESTED_PLAN });
  await page.goto("/");
  await readingAt(page, "Setup");

  await openToc(page);
  await expect(field(page)).toHaveAttribute("aria-controls", /.+/);
  await expect(field(page)).toHaveAttribute("aria-expanded", "true");

  // aria-controls resolves to the viewport the rows live in, inside the listbox.
  const controls = (await field(page).getAttribute("aria-controls")) ?? "";
  await expect(listbox(page).locator(`[id="${controls}"]`)).toHaveCount(1);

  // The named row is the heading being read, and it moves as the list narrows.
  // Trimmed rather than read raw: a row also holds the command's check-indicator
  // span, so its textContent carries the whitespace toHaveText would normalize away.
  const narrated = async () => {
    const id = await field(page).getAttribute("aria-activedescendant");
    return ((await page.locator(`${TOC} [id="${id}"]`).textContent()) ?? "").trim();
  };
  const named = () => page.locator(`${TOC} [role='option'][data-selected]`);

  await expect(named()).toHaveText("Setup");
  await expect.poll(narrated).toBe("Setup");

  await field(page).fill("rollout notes");
  await expect(named()).toHaveText("Rollout notes");
  await expect.poll(narrated).toBe("Rollout notes");

  // Narrowing to nothing leaves no row to name, so the message says it out loud
  // instead — the one narrowing aria-activedescendant cannot carry.
  await field(page).fill("nothing matches this");
  await expect(options(page)).toHaveCount(0);
  await expect(page.locator(`${TOC} [role='status']`)).toHaveText("No headings match");
});

// Heading breadcrumbs bar for the plan (EXC-946). The bar answers "where am I in
// this plan": the ancestor chain of the heading being read, updating as the
// reviewer scrolls, with each crumb opening that level's siblings.
//
// Everything asserted here needs a real browser. The trail is driven by the plan's
// scroll position measured with getBoundingClientRect, and the sibling menus are
// bits-ui popovers whose open/close, portalling, and submenu reveal are real
// interaction semantics — both e2e concerns per browser-testing.md. The `/`
// filter is a second panel — a `command` in a `popover` — whose narration attributes
// a screen reader reads off the live DOM; real-browser too.
//
// The filter's keyboard walk is the one thing split across both layers, deliberately.
// Where it lands — the roving SELECTION, which is DOM state rather than focus — a
// mount can see, so it is unit-tested. What only a browser can show is the rest: a
// real keypress reaching the primitive, the browser's own tab move being suppressed,
// and the newly selected row being scrolled into the list's box. Those are here. The
// bar's pure trail logic and the filter panel's structure and ARIA are likewise in
// ui/src/components/PlanBreadcrumbs.test.ts.
//
// EXC-1122's hold-to-repeat is here for a reason of its own, and the sharpest layer
// call in the file: what it adds is a CURVE — one move, a pause, then a run — which
// exists only against a real clock and a real key that is held rather than pressed.
// Playwright's `keyboard.down` emits one keydown and no repeats of its own, so
// everything the walk does past the first row is the app's timer and nothing else.
// The halves a mount can reach are the repeat bail and the wrap, both in that unit
// suite; the helper's own delay/run lifecycle is driven off an injected clock in
// ui/src/lib/keyRepeat.test.ts and needs no browser at all.

import type { Locator, Page } from "@playwright/test";

import {
  expect,
  motionToken,
  pastKeyRepeatDelay,
  test,
  waitPastSafeModeGrace,
  walkVisits,
} from "@test/e2e/support/fixtures.ts";
import { jumpToHeading, PLAN_SURFACE } from "@test/e2e/support/source-view.ts";

// Each section must be taller than the viewport, so scrolling to a later one
// genuinely changes which heading is being read rather than leaving the whole plan
// in view.
const filler = (label: string) =>
  Array.from(
    { length: 30 },
    (_, i) => `${label} detail line ${i + 1} keeps this section tall.`,
  ).join("\n");

// One top-level heading with two subsections, each holding a sub-subsection, so a
// trail runs three deep and both the level-2 and level-3 menus have real siblings.
//
// Exactly ONE `#` on purpose: the daemon normalizes a posted plan to a single
// top-level heading, demoting every later `#` (and reflowing paragraphs, so source
// line numbers shift too). A fixture with two `#` headings is stored with the
// second at level 2, which quietly changes the trail this spec asserts.
const NESTED_PLAN = [
  "# Alpha",
  filler("Alpha"),
  "## Bravo",
  filler("Bravo"),
  "### Charlie",
  filler("Charlie"),
  "## Delta",
  filler("Delta"),
  "### Echo",
  filler("Echo"),
  // A trailing section so Echo is not the last one. The plan scrolls a third of a
  // viewport past its end, which is not enough room to bring the final heading up
  // to the reading zone — a jump there clamps short and the tracked heading stays
  // on the section above it.
  "## Foxtrot",
  filler("Foxtrot"),
  "",
].join("\n\n");

// Five levels under one top-level heading, so the trail runs deeper than any row
// can hold at the app's narrow end. The trailing "## Foxtrot" keeps Echo off the
// end of the plan, for the same reason NESTED_PLAN carries one.
const DEEP_PLAN = [
  "# Alpha",
  filler("Alpha"),
  "## Bravo",
  filler("Bravo"),
  "### Charlie",
  filler("Charlie"),
  "#### Delta",
  filler("Delta"),
  "##### Echo",
  filler("Echo"),
  "## Foxtrot",
  filler("Foxtrot"),
  "",
].join("\n\n");

// More headings than the filter panel's list can show at once, which is what makes
// "the walk brought the row into view" a claim about scrolling rather than about a
// list that already showed everything. Only the COUNT matters, so the sections carry
// the same filler as the fixtures above rather than anything of their own.
//
// That count is sized against the vendored command-list's `max-h-72` (18rem), which
// these thirteen rows overflow by about four. Raise that height and this fixture has
// to grow with it — never relax the out-of-view half of the assertion, which is the
// only thing proving the list scrolls at all. The ToC popup's TALL_PLAN carries the
// same warning, having already been caught by it once.
const LONG_PLAN = [
  "# Alpha",
  filler("Alpha"),
  ...Array.from({ length: 12 }, (_, i) => [
    `## Section ${i + 1}`,
    filler(`Section ${i + 1}`),
  ]).flat(),
  "",
].join("\n\n");

// Three level-2 sections under one top-level heading and NOTHING nested inside them, so a
// walk from one to the next holds the trail at two levels for every frame of the scroll.
// That is the only shape in which "walking to a sibling" is a clean claim: in a plan whose
// sections have subsections, a jump between two of them really does pass through a
// shallower heading on the way, and the trail really does shorten there.
const SIBLING_PLAN = [
  "# Alpha",
  filler("Alpha"),
  "## Bravo",
  filler("Bravo"),
  "## Delta",
  filler("Delta"),
  // Trailing, so Delta is not the last section — the plan cannot scroll far enough past
  // its end to bring a final heading into the reading zone.
  "## Foxtrot",
  filler("Foxtrot"),
  "",
].join("\n\n");

const BAR = ".plan-breadcrumbs";
const CRUMB = `${BAR} button.crumb`;
// The crumbs the row is actually showing. A level it cannot hold stays in the
// list, out of flow, so the bar can keep measuring the trail it would need
// (EXC-957) — which is why "visible" here is a class rather than a count.
const SHOWN = `${BAR} .crumb-item:not(.elided) button.crumb`;
const MARKER = `${BAR} .crumb-ellipsis`;
const MENU = "[data-slot='dropdown-menu-content']";
const SUBMENU = "[data-slot='dropdown-menu-sub-content']";
// The filter is its own panel — a `command` in a `popover` — so its rows are options
// rather than menu items. Every locator below is scoped through it,
// which is what lets them be role queries: the ToC popup publishes a filter field
// with the SAME accessible name, and an unscoped query would collect both
// (browser-testing.md § Locators).
const FILTER = ".plan-crumb-filter";
const filterPanel = (page: Page) => page.locator(FILTER);
const results = (page: Page) => filterPanel(page).getByRole("option");
const resultsList = (page: Page) =>
  filterPanel(page).getByRole("listbox", { name: "Matching headings" });
const queryField = (page: Page) =>
  filterPanel(page).getByRole("combobox", { name: "Filter headings" });
/** The row the roving selection is on. bits-ui marks it `data-selected`; the reader
 * is told about it through the field's aria-activedescendant, asserted below. */
const walkedTo = (page: Page) => results(page).and(page.locator("[data-selected]"));

/** Whether `row` sits inside the results list's visible box — the claim a unit mount
 * cannot make, since happy-dom lays nothing out.
 *
 * Throws rather than returning false when either box is unmeasurable: one caller
 * asserts this is FALSE, to prove the list really scrolls, and a false-on-null would
 * let "not measurable" pass as "correctly out of view". `expect.poll` fails on a throw
 * exactly as it should. The one-pixel tolerance absorbs sub-pixel layout rounding,
 * which would otherwise red a row correctly scrolled flush against an edge. */
async function isWithinResults(page: Page, row: Locator): Promise<boolean> {
  const rowBox = await row.boundingBox();
  const listBox = await resultsList(page).boundingBox();
  if (rowBox === null || listBox === null) throw new Error("row or list has no bounding box");
  return rowBox.y >= listBox.y - 1 && rowBox.y + rowBox.height <= listBox.y + listBox.height + 1;
}

/** Where the plan is parked. Several specs below assert that walking the menus
 * moves nothing until the reviewer commits to a heading. */
const scrollTop = (page: Page) => page.locator(PLAN_SURFACE).evaluate((el) => el.scrollTop);

/** The plan's RESTING scroll position. A jump scrolls smoothly, so a spec that
 * goes on to assert "nothing moved" has to sample a position that has stopped
 * moving — two identical non-zero reads — rather than the first one it sees. */
async function parkedAt(page: Page): Promise<number> {
  let previous = -1;
  await expect
    .poll(async () => {
      const now = await scrollTop(page);
      const settled = now > 0 && now === previous;
      previous = now;
      return settled;
    })
    .toBe(true);
  return previous;
}

/** Arrange a reading position. The specs below reach their starting heading through
 * the very surface they go on to assert — unavoidable since EXC-949 left the bar as
 * the only way to reach an arbitrary heading — so the gesture is the shared one in
 * support/source-view.ts rather than a private copy that could drift from it. */
const jumpTo = jumpToHeading;

test("the bar sits in the control row between the compare picker and the path", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: NESTED_PLAN });
  await page.goto("/");

  const bar = page.locator(`.control-row ${BAR}`);
  await expect(bar).toBeVisible();
  // A named nav landmark: the plan's heading navigation keeps a role in the a11y
  // tree now that the contents rail's own landmark is gone (EXC-949).
  await expect(bar).toHaveAttribute("aria-label", "Plan location");

  // Left of the working-directory path, right of the compare picker.
  const picker = await page.locator(".control-row .compare-picker").boundingBox();
  const crumbs = await bar.boundingBox();
  const cwd = await page.locator(".control-row .cwd").boundingBox();
  expect(picker).not.toBeNull();
  expect(crumbs).not.toBeNull();
  expect(cwd).not.toBeNull();
  expect(picker!.x + picker!.width).toBeLessThanOrEqual(crumbs!.x);
  expect(crumbs!.x + crumbs!.width).toBeLessThanOrEqual(cwd!.x);
});

test("the trail follows the heading being read as the plan scrolls", async ({ daemon, page }) => {
  await daemon.seed({ plan: NESTED_PLAN });
  await page.goto("/");

  const crumbs = page.locator(CRUMB);
  // A plan nobody has scrolled yet still reads as a location: the trail is seeded
  // once the source view paints, not only on the first scroll.
  await expect(crumbs).toHaveText(["Alpha"]);
  // Seeding the tracked heading at load also publishes it to the URL, so a link
  // copied before scrolling points at the section on screen.
  await expect.poll(() => new URL(page.url()).searchParams.get("heading")).toBe("alpha");

  // Scrolling into a nested section deepens the trail rather than replacing it.
  await jumpTo(page, "Charlie");
  await expect(crumbs).toHaveText(["Alpha", "Bravo", "Charlie"]);

  // And crossing into the sibling section re-roots the middle of it.
  await jumpTo(page, "Echo");
  await expect(crumbs).toHaveText(["Alpha", "Delta", "Echo"]);

  // The innermost crumb is where the reader is.
  await expect(crumbs.last()).toHaveAttribute("aria-current", "location");
});

test("a ?heading= deep link opens the plan at that section", async ({ daemon, page }) => {
  // The INBOUND half of the `?heading=` mirror (EXC-641): every other heading
  // assertion in the suite reads the param after a jump, so without this one the
  // restore path — lineForSlug plus DiffPlanView's `restored` effect — has only a
  // pure unit test and nothing exercising it end to end. It moved here when EXC-949
  // deleted toc-active-heading.e2e.ts, which had carried it against the rail's rows.
  const id = await daemon.seed({ plan: NESTED_PLAN });
  await page.goto(`/?review=${id}&heading=echo`);

  await expect(page.locator(CRUMB)).toHaveText(["Alpha", "Delta", "Echo"]);
});

test("picking a sibling from a crumb's menu scrolls the plan to that heading", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: NESTED_PLAN });
  await page.goto("/");

  // Reading Bravo, so the innermost crumb's menu offers Bravo and its sibling Delta.
  await jumpTo(page, "Bravo");
  await expect(page.locator(CRUMB)).toHaveText(["Alpha", "Bravo"]);

  await page.locator(CRUMB).last().click();
  const menu = page.locator("[data-slot='dropdown-menu-content']");
  await expect(menu).toBeVisible();
  await menu.getByText("Delta", { exact: true }).click();

  // The pick lands the plan on Delta, which the trail and the URL's heading mirror
  // both report.
  await expect(page.locator(CRUMB)).toHaveText(["Alpha", "Delta"]);
  await expect.poll(() => new URL(page.url()).searchParams.get("heading")).toBe("delta");
});

test("picking a heading leaves the bar instead of parking a focus ring on the crumb", async ({
  daemon,
  page,
}) => {
  // A pick hands the reviewer to the plan, so that close skips the menu's focus
  // return: a crumb left focused wears the app's focus ring over a plan the
  // reviewer has already moved on to. Only a pick — Escape still hands focus back
  // to the crumb (review-shortcuts.e2e.ts), since a dismissal leaves them in the bar.
  await daemon.seed({ plan: NESTED_PLAN });
  await page.goto("/");

  await jumpTo(page, "Bravo");
  await expect(page.locator(CRUMB)).toHaveText(["Alpha", "Bravo"]);

  await page.locator(CRUMB).last().click();
  const menu = page.locator(MENU);
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "Delta" }).press("Enter");

  await expect(page.locator(CRUMB)).toHaveText(["Alpha", "Delta"]);
  await expect(menu).toHaveCount(0);
  // Focus sits on the body, which the plan's window-level keys are happy with —
  // nothing in the bar is left ringed.
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe("BODY");
});

test("a picked heading takes the line cursor with it, scrolling to one does not", async ({
  daemon,
  page,
}) => {
  // The cursor is where the reviewer's next motion, comment or visual selection
  // starts from, so a deliberate pick carries it to the chosen heading — the same
  // coherence a line click gets. Scrolling is not a choice: the trail re-roots on
  // every wheel tick and must leave the cursor where the reviewer put it.
  await daemon.seed({ plan: NESTED_PLAN });
  await page.goto("/");
  await waitPastSafeModeGrace(page);

  const cursor = page.locator(".diffview [data-content] [data-line][data-caret-cursor]");
  await page.locator(PLAN_SURFACE).evaluate((el) => el.scrollBy(0, 2000));
  // The trail deepened, so the scroll really did move the reading position — and
  // still no cursor exists.
  await expect.poll(() => page.locator(CRUMB).count()).toBeGreaterThan(1);
  await expect(cursor).toHaveCount(0);

  await jumpTo(page, "Delta");
  await expect(page.locator(CRUMB)).toHaveText(["Alpha", "Delta"]);
  await expect(cursor).toHaveText("## Delta");
});

test("a crumb's own heading opens the level below it without leaving the menu", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: NESTED_PLAN });
  await page.goto("/");

  await jumpTo(page, "Charlie");
  await expect(page.locator(CRUMB)).toHaveText(["Alpha", "Bravo", "Charlie"]);

  // Open the level-2 crumb, then hover its own row, which nests level 3 — one
  // menu walks down the hierarchy. Hovered rather than clicked because a click
  // now jumps (EXC-957); only hover, `l` and ArrowRight open. And named rather
  // than taken as "the sub-trigger", since every sibling that encloses headings
  // opens one now, so Delta carries a chevron here too.
  await page.locator(CRUMB).nth(1).click();
  await page.locator(MENU).getByRole("menuitem", { name: "Bravo" }).hover();
  const submenu = page.locator(SUBMENU);
  await expect(submenu).toBeVisible();
  await expect(submenu.getByText("Charlie", { exact: true })).toBeVisible();
});

test("j and k walk a nested submenu, not the plan behind it", async ({ daemon, page }) => {
  // EXC-947: j/k are handled on the menu content's own keydown, and a submenu's
  // content has its own roving group — so the walk has to keep working one level
  // in. The key that summons the bar is pinned in review-shortcuts.e2e.ts.
  await daemon.seed({ plan: NESTED_PLAN });
  await page.goto("/");

  await jumpTo(page, "Charlie");
  await expect(page.locator(CRUMB)).toHaveText(["Alpha", "Bravo", "Charlie"]);

  // The outermost crumb's own row nests the level below rather than jumping, so
  // stepping onto it and pressing ArrowRight opens a submenu with real siblings.
  await page.locator(CRUMB).first().click();
  await page.keyboard.press("j");
  await expect(page.locator("[data-slot='dropdown-menu-sub-trigger']").first()).toBeFocused();
  await page.keyboard.press("ArrowRight");

  const submenu = page.locator("[data-slot='dropdown-menu-sub-content']");
  await expect(submenu).toBeVisible();
  await expect(submenu.getByRole("menuitem", { name: "Bravo" })).toBeFocused();

  await page.keyboard.press("j");
  await expect(submenu.getByRole("menuitem", { name: "Delta" })).toBeFocused();
  await page.keyboard.press("j");
  await expect(submenu.getByRole("menuitem", { name: "Foxtrot" })).toBeFocused();
  await page.keyboard.press("k");
  await expect(submenu.getByRole("menuitem", { name: "Delta" })).toBeFocused();

  // The plan's own j/k line cursor never engaged. Asserted on the cursor tag rather
  // than on scrollTop: a freshly-placed cursor lands on the reading line and only
  // scrolls once it crosses the scrolloff band, so the plan would sit still here
  // even with the suppression broken — but the very first stray `j` steps the row
  // it sits on. That row is Charlie's own heading, put there by the pick that
  // arranged this reading position rather than by anything in the walk above.
  await expect(page.locator(".diffview [data-content] [data-caret-cursor]")).toHaveText(
    "### Charlie",
  );
});

// EXC-1121: Tab walks the open list too, and stays on the level it is on. Left to
// bits-ui the key closes the whole menu and moves focus to the next tabbable after
// the root trigger, which is the least obvious thing it could do from inside an open
// list. Real focus movement through the primitive's roving group, so it lives here.

test("Tab and Shift+Tab walk the open menu, wrapping at its ends", async ({ daemon, page }) => {
  await daemon.seed({ plan: NESTED_PLAN });
  await page.goto("/");

  await jumpTo(page, "Charlie");
  await expect(page.locator(CRUMB)).toHaveText(["Alpha", "Bravo", "Charlie"]);

  const menu = page.locator(MENU);
  await page.locator(CRUMB).nth(1).click();
  await expect(menu.getByRole("menuitem")).toHaveText(["Bravo", "Delta", "Foxtrot"]);

  await page.keyboard.press("Tab");
  await expect(menu.getByRole("menuitem", { name: "Bravo" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(menu.getByRole("menuitem", { name: "Delta" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(menu.getByRole("menuitem", { name: "Bravo" })).toBeFocused();

  // Past the last row and back to the first, and the same in reverse. The menus
  // take this from the primitive's own `loop`, which defaults on.
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(menu.getByRole("menuitem", { name: "Foxtrot" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(menu.getByRole("menuitem", { name: "Bravo" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(menu.getByRole("menuitem", { name: "Foxtrot" })).toBeFocused();

  // The menu is still the one that was open, on the crumb it was opened from: Tab
  // neither dismissed it, nor opened a submenu, nor stepped the bar to another
  // trigger.
  await expect(menu).toHaveCount(1);
  await expect(page.locator(SUBMENU)).toHaveCount(0);
  await expect(page.locator(CRUMB).nth(1)).toHaveAttribute("aria-expanded", "true");
});

test("Tab walks a submenu without stepping out of it", async ({ daemon, page }) => {
  // A submenu's content has its own roving group and its own copy of the handler,
  // so the walk has to keep working one level in — and `Tab` was never one of
  // bits-ui's SUB_OPEN_KEYS or SUB_CLOSE_KEYS, so it cannot cross the boundary in
  // either direction.
  await daemon.seed({ plan: NESTED_PLAN });
  await page.goto("/");

  await jumpTo(page, "Charlie");
  await expect(page.locator(CRUMB)).toHaveText(["Alpha", "Bravo", "Charlie"]);

  await page.locator(CRUMB).first().click();
  await page.keyboard.press("j");
  await page.keyboard.press("ArrowRight");

  const submenu = page.locator(SUBMENU);
  await expect(submenu.getByRole("menuitem", { name: "Bravo" })).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(submenu.getByRole("menuitem", { name: "Delta" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(submenu.getByRole("menuitem", { name: "Foxtrot" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(submenu.getByRole("menuitem", { name: "Bravo" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(submenu.getByRole("menuitem", { name: "Foxtrot" })).toBeFocused();

  // One submenu, still open, with the level above it still standing: nothing was
  // entered and nothing was closed.
  await expect(submenu).toHaveCount(1);
  await expect(page.locator(MENU)).toHaveCount(1);
});

// EXC-1122: holding a walk key traverses instead of moving once. See the file header
// for why the whole of this lives in the browser layer.

/** The menu row focus is on, or "" when it is anywhere else — the walk enters the
 * list from the content, so the reads before the first move have no row to name. */
const focusedRow = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    return el?.getAttribute("role") === "menuitem" ? (el.textContent?.trim() ?? "") : "";
  });

test("holding a walk key keeps traversing until it is released", async ({ daemon, page }) => {
  await daemon.seed({ plan: NESTED_PLAN });
  await page.goto("/");

  await jumpTo(page, "Charlie");
  await expect(page.locator(CRUMB)).toHaveText(["Alpha", "Bravo", "Charlie"]);

  const menu = page.locator(MENU);
  await page.locator(CRUMB).nth(1).click();
  await expect(menu.getByRole("menuitem")).toHaveText(["Bravo", "Delta", "Foxtrot"]);

  // Held down rather than pressed, which is the whole subject: one keydown goes in,
  // and every move after the first is the app's own timer.
  await page.keyboard.down("j");
  await walkVisits(() => focusedRow(page), 3);
  await page.keyboard.up("j");

  // Released, the walk stops where it stopped — no trailing move once the window a
  // run would have ticked in has passed.
  const stopped = await focusedRow(page);
  expect(stopped).not.toBe("");
  await pastKeyRepeatDelay(page);
  expect(await focusedRow(page)).toBe(stopped);
});

test("a held arrow traverses on the app's cadence rather than the OS's", async ({
  daemon,
  page,
}) => {
  // The arrows are claimed by the bar as of EXC-1122 — the walk they get is still the
  // primitive's, but the cadence has to be ours or holding ArrowDown would feel
  // different from holding `j`. Claiming them is also what makes double-stepping
  // possible, since the OS keeps emitting keydowns the primitive would act on, so the
  // single press below is as load-bearing as the hold.
  await daemon.seed({ plan: NESTED_PLAN });
  await page.goto("/");

  await jumpTo(page, "Charlie");
  const menu = page.locator(MENU);
  await page.locator(CRUMB).nth(1).click();
  await expect(menu.getByRole("menuitem")).toHaveText(["Bravo", "Delta", "Foxtrot"]);

  // One press, one row: the claim did not turn into two walks of the same list.
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "Bravo" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "Delta" })).toBeFocused();

  await page.keyboard.down("ArrowDown");
  await walkVisits(() => focusedRow(page), 3);
  await page.keyboard.up("ArrowDown");

  const stopped = await focusedRow(page);
  expect(stopped).not.toBe("");
  await pastKeyRepeatDelay(page);
  expect(await focusedRow(page)).toBe(stopped);
});

test("a held ArrowRight descends the hierarchy at the same cadence", async ({ daemon, page }) => {
  // ArrowRight is the one walk key bits-ui answers on the SUB-TRIGGER rather than
  // on the menu content, in the target phase and with a preventDefault of its own —
  // so onMenuKeydown never sees it and the hold has to be claimed a level down, in
  // onRowKeydown, where the handler still runs ahead of the primitive's. Nothing but
  // a real press can exercise that: a synthetic arrow is untrusted and returns at
  // the guard, which is exactly what keeps the walk's own re-dispatch working.
  await daemon.seed({ plan: DEEP_PLAN });
  await page.goto("/");

  await jumpTo(page, "Echo");
  const menu = page.locator(MENU);
  await page.locator(CRUMB).first().click();
  await expect(menu.getByRole("menuitem")).toHaveText(["Alpha"]);

  // Onto the row that nests the level below, which is where the claim lives.
  await page.keyboard.press("j");
  await expect(page.locator("[data-slot='dropdown-menu-sub-trigger']").first()).toBeFocused();

  // One press opens exactly one level: the claim did not double-drive the trigger.
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(SUBMENU)).toHaveCount(1);
  await expect(page.locator(SUBMENU).getByRole("menuitem", { name: "Bravo" })).toBeFocused();

  // And held, it keeps descending — the trail runs five deep, so there is somewhere
  // to go — then settles once the run is released.
  await page.keyboard.down("ArrowRight");
  await expect.poll(() => page.locator(SUBMENU).count(), { intervals: [50] }).toBeGreaterThan(1);
  await page.keyboard.up("ArrowRight");

  const depth = await page.locator(SUBMENU).count();
  await pastKeyRepeatDelay(page);
  expect(await page.locator(SUBMENU).count()).toBe(depth);
});

// EXC-957: the menus recurse the whole heading tree, so the bar reaches any
// heading in the plan; h and l walk that hierarchy alongside j and k; and the
// trail elides on the room the row measures rather than on how deep it is. Focus
// movement, submenu reveal and layout are all real-browser behaviour, so the
// coverage lives here (browser-testing.md).

test("h and l walk into a section the reader is not in, and only Enter goes there", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: NESTED_PLAN });
  await page.goto("/");

  await jumpTo(page, "Charlie");
  await expect(page.locator(CRUMB)).toHaveText(["Alpha", "Bravo", "Charlie"]);
  const parked = await parkedAt(page);

  // The outermost crumb holds the top level, and every heading below it is a
  // submenu away — including the whole Delta branch, which the reader is not in.
  await page.locator(CRUMB).first().click();
  await page.keyboard.press("j");
  await page.keyboard.press("l");
  const branches = page.locator(SUBMENU).first();
  await expect(branches.getByRole("menuitem", { name: "Bravo" })).toBeFocused();

  await page.keyboard.press("j");
  await expect(branches.getByRole("menuitem", { name: "Delta" })).toBeFocused();
  await page.keyboard.press("l");
  const under = page.locator(SUBMENU).nth(1);
  await expect(under.getByRole("menuitem", { name: "Echo" })).toBeFocused();

  // Three levels of menu opened and nothing moved: only a commit navigates.
  expect(await scrollTop(page)).toBe(parked);

  // h steps back out to the row that opened the submenu.
  await page.keyboard.press("h");
  await expect(branches.getByRole("menuitem", { name: "Delta" })).toBeFocused();
  expect(await scrollTop(page)).toBe(parked);

  await page.keyboard.press("l");
  await page.keyboard.press("Enter");
  await expect(page.locator(CRUMB)).toHaveText(["Alpha", "Delta", "Echo"]);
  await expect.poll(() => new URL(page.url()).searchParams.get("heading")).toBe("echo");
});

test("h steps out to the crumb before it once there is no submenu left to close", async ({
  daemon,
  page,
}) => {
  // `b` opens the crumb the reader is ON, so without this the keyboard could
  // only ever reach that crumb's subtree while a mouse could reach the whole
  // plan from the outermost crumb. Walking out to depth 0 and descending a
  // different branch is the reach the issue asks for.
  await daemon.seed({ plan: NESTED_PLAN });
  await page.goto("/");

  await jumpTo(page, "Charlie");
  await expect(page.locator(CRUMB)).toHaveText(["Alpha", "Bravo", "Charlie"]);
  const parked = await parkedAt(page);

  await page.keyboard.press("b");
  const menu = page.locator(MENU);
  await expect(menu.getByRole("menuitem")).toHaveText(["Charlie"]);

  // Out to Bravo's level, then out again to Alpha's — the top of the trail.
  await page.keyboard.press("h");
  await expect(menu.getByRole("menuitem")).toHaveText(["Bravo", "Delta", "Foxtrot"]);
  await page.keyboard.press("h");
  await expect(menu.getByRole("menuitem")).toHaveText(["Alpha"]);
  // One more has nowhere to go and leaves the menu open where it is.
  await page.keyboard.press("h");
  await expect(menu.getByRole("menuitem")).toHaveText(["Alpha"]);
  expect(await scrollTop(page)).toBe(parked);

  // And from there the whole plan is a descent away.
  await page.keyboard.press("j");
  await page.keyboard.press("l");
  await page.keyboard.press("j");
  await page.keyboard.press("l");
  await page.keyboard.press("Enter");
  await expect(page.locator(CRUMB)).toHaveText(["Alpha", "Delta", "Echo"]);
});

test("ArrowLeft walks the trail exactly as h does", async ({ daemon, page }) => {
  // Each arrow means what its vim twin means, so which key set the reviewer
  // reaches for never changes what they get (EXC-1120). The sibling spec above
  // drives the identical walk with `h`, and the two are one code path: `h` maps
  // onto ArrowLeft and re-enters the handler as one.
  await daemon.seed({ plan: NESTED_PLAN });
  await page.goto("/");

  await jumpTo(page, "Charlie");
  await expect(page.locator(CRUMB)).toHaveText(["Alpha", "Bravo", "Charlie"]);
  const parked = await parkedAt(page);

  await page.keyboard.press("b");
  const menu = page.locator(MENU);
  await expect(menu.getByRole("menuitem")).toHaveText(["Charlie"]);

  // Out to Bravo's level, the step taken once there is no submenu left to close.
  await page.keyboard.press("ArrowLeft");
  await expect(menu.getByRole("menuitem")).toHaveText(["Bravo", "Delta", "Foxtrot"]);
  await expect(menu.getByRole("menuitem", { name: "Bravo" })).toBeFocused();

  // With a submenu open ArrowLeft still closes just that submenu: the cross-crumb
  // walk only fires when the primitive has nothing left to close.
  await page.keyboard.press("l");
  const submenu = page.locator(SUBMENU);
  await expect(submenu.getByRole("menuitem")).toHaveText(["Charlie"]);
  await page.keyboard.press("ArrowLeft");
  await expect(submenu).toHaveCount(0);
  await expect(menu.getByRole("menuitem")).toHaveText(["Bravo", "Delta", "Foxtrot"]);

  // On out to the top of the trail, where one more has nowhere to go and leaves
  // the menu open where it is — and nothing has moved, since only a commit does.
  await page.keyboard.press("ArrowLeft");
  await expect(menu.getByRole("menuitem")).toHaveText(["Alpha"]);
  await page.keyboard.press("ArrowLeft");
  await expect(menu.getByRole("menuitem")).toHaveText(["Alpha"]);
  expect(await scrollTop(page)).toBe(parked);
});

test("a second Escape leaves the bar with nothing focused", async ({ daemon, page }) => {
  // Escape steps out one layer at a time: the menu, then the bar itself. Only the
  // second half is new — `onMenuKeydown` rides on portalled menu content, so the
  // bar had nothing listening once the menu had gone (EXC-1120).
  await daemon.seed({ plan: NESTED_PLAN });
  await page.goto("/");

  await jumpTo(page, "Charlie");
  await expect(page.locator(CRUMB)).toHaveText(["Alpha", "Bravo", "Charlie"]);
  await waitPastSafeModeGrace(page);

  const menu = page.locator(MENU);
  const search = page.getByRole("search");
  await page.keyboard.press("b");
  await expect(menu).toBeVisible();

  // The first Escape is unchanged: the menu goes, the crumb keeps focus.
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(page.locator(CRUMB).last()).toBeFocused();

  // The second leaves the bar entirely — still on screen, merely unfocused. Read
  // off the live document rather than through a locator: `BODY` is the acceptance
  // criterion's own wording, and it is the spelling the rest of this file and
  // plan-toc.e2e.ts already use for a focus-landed-here claim.
  await page.keyboard.press("Escape");
  await expect(page.locator(BAR)).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe("BODY");

  // Which is the whole point of landing on the body: the plan's window-level keys
  // reach it again, `/` opens the search HUD, and `b` brings the bar back.
  await page.keyboard.press("/");
  await expect(search).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(search).toHaveCount(0);
  await page.keyboard.press("b");
  await expect(menu).toBeVisible();

  // A mouse-opened menu takes the same two steps. It is the case the handler's
  // aria-expanded guard exists for, and the only one that would notice if the
  // primitive ever stopped taking focus into its portalled content on open.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.locator(CRUMB).last().click();
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(page.locator(CRUMB).last()).toBeFocused();
});

test("holding h walks out to the top of the trail and settles there", async ({ daemon, page }) => {
  // `h` is the one walk key whose move ENDS the hold from the inside: stepping out
  // shuts the open crumb's menu, which the bar answers by cancelling the run. The
  // hold has to survive that and stop cleanly at the outermost crumb, rather than
  // re-arming behind its own cancel — the shape ui/src/lib/keyRepeat.test.ts pins
  // directly, and the only place a browser can show what it looks like.
  await daemon.seed({ plan: DEEP_PLAN });
  await page.goto("/");

  await jumpTo(page, "Echo");
  const parked = await parkedAt(page);
  const menu = page.locator(MENU);

  await page.keyboard.press("b");
  await expect(menu.getByRole("menuitem")).toHaveText(["Echo"]);

  await page.keyboard.down("h");
  await expect(menu.getByRole("menuitem")).toHaveText(["Alpha"]);
  await page.keyboard.up("h");

  // Settled at the top: one menu, on the outermost crumb, and still there once the
  // window a run would have ticked in has passed. The plan never moved either — the
  // walk browses, only Enter travels.
  await pastKeyRepeatDelay(page);
  await expect(menu).toHaveCount(1);
  await expect(menu.getByRole("menuitem")).toHaveText(["Alpha"]);
  await expect(page.locator(CRUMB).first()).toHaveAttribute("aria-expanded", "true");
  expect(await scrollTop(page)).toBe(parked);
});

test("b shuts the bar from whatever crumb the walk reached", async ({ daemon, page }) => {
  // The key toggles the BAR, not the trailing crumb: `h` moves the open menu out
  // onto an ancestor, so the trigger `b` opened is no longer the open one, and
  // re-opening the trailing crumb left the ancestor's panel standing beside it —
  // nothing dismisses it, since a programmatic click carries no pointerdown.
  await daemon.seed({ plan: NESTED_PLAN });
  await page.goto("/");

  await jumpTo(page, "Charlie");
  await expect(page.locator(CRUMB)).toHaveText(["Alpha", "Bravo", "Charlie"]);
  await parkedAt(page);

  await page.keyboard.press("b");
  const menu = page.locator(MENU);
  await expect(menu.getByRole("menuitem")).toHaveText(["Charlie"]);

  await page.keyboard.press("h");
  await expect(menu.getByRole("menuitem")).toHaveText(["Bravo", "Delta", "Foxtrot"]);
  await expect(menu).toHaveCount(1);

  await page.keyboard.press("b");
  await expect(menu).toHaveCount(0);

  // And it opens again where it always does — the crumb the reader is on, not the
  // ancestor the walk reached.
  await page.keyboard.press("b");
  await expect(menu.getByRole("menuitem")).toHaveText(["Charlie"]);
});

test("every level of a deep walk is actually on screen", async ({ daemon, page }) => {
  // Stock shadcn-svelte leaves a submenu inside its parent panel, and that panel
  // is a scroll container (a max-height plus overflow), so from the second level
  // down each panel was clipped away — present in the DOM, sized, and invisible.
  // Playwright's own visibility check does not see overflow clipping, so this
  // hit-tests each panel's middle: a clipped one is not there to be hit.
  await daemon.seed({ plan: DEEP_PLAN });
  await page.goto("/");
  await jumpTo(page, "Echo");

  // Onto the top-level heading, then straight down the chain — each submenu opens
  // with its first row focused, and in this plan that row is the next level down.
  await page.locator(CRUMB).first().click();
  await page.keyboard.press("j");
  for (let level = 0; level < 4; level++) await page.keyboard.press("l");
  await expect(page.locator(SUBMENU)).toHaveCount(4);

  const painted = await page.locator(SUBMENU).evaluateAll((els) =>
    els.map((el) => {
      const box = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
    }),
  );
  expect(painted).toEqual([true, true, true, true]);
});

test("Enter on a heading that has children takes the reader there", async ({ daemon, page }) => {
  // The split the whole recursion rests on: a row can both open a level and be a
  // destination, and bits-ui flattens its own open keys into a click that looks
  // exactly like a press. Enter must land on the heading, not on its submenu.
  await daemon.seed({ plan: NESTED_PLAN });
  await page.goto("/");

  await jumpTo(page, "Charlie");
  await page.locator(CRUMB).first().click();
  await page.keyboard.press("j");
  await expect(page.locator(MENU).getByRole("menuitem", { name: "Alpha" })).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(page.locator(MENU)).toHaveCount(0);
  await expect(page.locator(CRUMB)).toHaveText(["Alpha"]);
});

test("Escape and an outside click leave the reader exactly where they were", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: NESTED_PLAN });
  await page.goto("/");

  await jumpTo(page, "Charlie");
  const parked = await parkedAt(page);
  const menu = page.locator(MENU);

  // Two levels deep, then Escape.
  await page.locator(CRUMB).first().click();
  await page.keyboard.press("j");
  await page.keyboard.press("l");
  await expect(page.locator(SUBMENU).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(page.locator(CRUMB)).toHaveText(["Alpha", "Bravo", "Charlie"]);
  expect(await scrollTop(page)).toBe(parked);

  // Two levels deep again, then a click outside the bar.
  await page.locator(CRUMB).first().click();
  await page.keyboard.press("j");
  await page.keyboard.press("l");
  await expect(page.locator(SUBMENU).first()).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(menu).toHaveCount(0);
  await expect(page.locator(CRUMB)).toHaveText(["Alpha", "Bravo", "Charlie"]);
  expect(await scrollTop(page)).toBe(parked);
});

test("a five-level trail shows whole while the row has room for it", async ({ daemon, page }) => {
  // The defect EXC-957 fixes: COLLAPSE_ABOVE elided anything past three levels on
  // a depth count, so this trail shortened on a 1600px window with the row half
  // empty. The marker stays in the list — that is what keeps the full trail
  // measurable — but it is not on screen, hence toBeHidden over toHaveCount(0).
  await daemon.seed({ plan: DEEP_PLAN });
  await page.goto("/");

  await jumpTo(page, "Echo");
  await expect(page.locator(SHOWN)).toHaveText(["Alpha", "Bravo", "Charlie", "Delta", "Echo"]);
  await expect(page.locator(MARKER)).toBeHidden();
});

test("the trail elides once the row cannot hold it, and the marker opens what it hid", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: DEEP_PLAN });
  await page.goto("/");
  await jumpTo(page, "Echo");
  await expect(page.locator(SHOWN)).toHaveCount(5);

  // MIN_APP_WIDTH_PX — the supported floor (ui/src/lib/layout.ts), where the row
  // genuinely cannot hold five levels.
  await page.setViewportSize({ width: 480, height: 900 });
  await expect(page.locator(MARKER)).toBeVisible();
  const shown = await page.locator(SHOWN).allTextContents();
  expect(shown.length).toBeLessThan(5);
  // Whatever is given up, the outermost level and where the reader is both stay.
  expect(shown[0]).toBe("Alpha");
  expect(shown.at(-1)).toBe("Echo");
  // And the trail elides rather than pushing the app past its floor.
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);

  // The marker says what it holds rather than "more", and opens it.
  await expect(page.locator(MARKER)).toHaveAttribute("aria-label", /Bravo/);
  await page.locator(MARKER).click();
  const menu = page.locator(MENU);
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Bravo" })).toBeVisible();

  // And a swallowed level is a destination from there, not just a label.
  await menu.getByRole("menuitem", { name: "Bravo" }).click();
  await expect(page.locator(SHOWN)).toHaveText(["Alpha", "Bravo"]);
});

test("the marker's menu takes the same two Escapes a crumb's does", async ({ daemon, page }) => {
  // The marker gets this for free from the bar-level handler — it is a button
  // inside the same <nav>, carrying the same aria-expanded (EXC-1120). Pinned
  // rather than left true by construction: moving that handler onto the crumb
  // button, the shape the issue first sketched, would drop the marker silently.
  await daemon.seed({ plan: DEEP_PLAN });
  await page.goto("/");
  await jumpTo(page, "Echo");
  await page.setViewportSize({ width: 480, height: 900 });
  await expect(page.locator(MARKER)).toBeVisible();

  await page.locator(MARKER).click();
  const menu = page.locator(MENU);
  await expect(menu).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(page.locator(MARKER)).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(page.locator(BAR)).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe("BODY");
});

// The bar's flat `/` filter (EXC-948, EXC-1098): a `command` inside a `popover`.
// What sits here is real browser behaviour — the key claim against the plan's own
// search, the swap between the two panels, the roving walk through a set that changes
// under it, the narration a screen reader reads off the live DOM, and Escape's step
// back to the hierarchy. The component unit pins the panel's structure and ARIA, and
// the half of the Tab walk a mount can see (see the file header).
//
// The arrows walk the results and `j`/`k` are ordinary query text, which is the one
// place this panel's keyboard differs from the bar's own menus. A combobox keeps
// focus in the textbox — the mechanism aria-activedescendant narration depends on —
// and a textbox that swallowed `j` and `k` could not search for "json", "keys" or
// "jump". The specs below pin both halves.

test("b then / then a query then Enter jumps across the hierarchy", async ({ daemon, page }) => {
  await daemon.seed({ plan: NESTED_PLAN });
  await page.goto("/");

  // Reading Charlie, whose crumb menu offers only Charlie — the hierarchy cannot
  // reach Echo from here without closing and reopening at two other depths.
  await jumpTo(page, "Charlie");
  await expect(page.locator(CRUMB)).toHaveText(["Alpha", "Bravo", "Charlie"]);

  await page.keyboard.press("b");
  const menu = page.locator(MENU);
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem")).toHaveText(["Charlie"]);

  await page.keyboard.press("/");
  await expect(queryField(page)).toBeFocused();
  // The hierarchy is swapped for the filter, not left standing behind it.
  await expect(menu).toHaveCount(0);
  // Every heading in the plan, at every level, not just that menu's siblings.
  await expect(results(page)).toHaveCount(6);

  await page.keyboard.type("echo");
  await expect(results(page)).toHaveText(["Echo Delta"]);
  await page.keyboard.press("Enter");

  // Echo sits under Delta — a different branch from the Bravo one being read.
  await expect(page.locator(CRUMB)).toHaveText(["Alpha", "Delta", "Echo"]);
  await expect.poll(() => new URL(page.url()).searchParams.get("heading")).toBe("echo");
});

test("the arrows walk the results without focus leaving the field, and it narrates", async ({
  daemon,
  page,
}) => {
  // The accessibility payoff the retrofit was for: the field is a real combobox, so
  // the list can be walked and narrowed while focus never leaves it and every stop
  // is announced. Read off the live DOM, which is where a screen reader reads it.
  await daemon.seed({ plan: NESTED_PLAN });
  await page.goto("/");
  await expect(page.locator(`${CRUMB}.current`)).toBeVisible();
  await waitPastSafeModeGrace(page);

  await page.keyboard.press("b");
  await page.keyboard.press("/");
  await expect(queryField(page)).toBeFocused();
  await page.keyboard.type("a");
  await expect(results(page)).toHaveText(["Alpha", "Bravo Alpha", "Charlie Bravo", "Delta Alpha"]);

  // The named row is whichever the walk is on, and it moves with the arrows.
  // Trimmed rather than read raw: a row also holds the command's check-indicator
  // span, so its textContent carries whitespace toHaveText would normalize away.
  const narrated = async () => {
    const id = await queryField(page).getAttribute("aria-activedescendant");
    return ((await filterPanel(page).locator(`[id="${id}"]`).textContent()) ?? "").trim();
  };
  await expect(walkedTo(page)).toHaveText("Alpha");
  await expect.poll(narrated).toBe("Alpha");

  await page.keyboard.press("ArrowDown");
  await expect(walkedTo(page)).toHaveText("Bravo Alpha");
  await expect.poll(narrated).toBe("Bravo Alpha");
  await page.keyboard.press("ArrowUp");
  await expect(walkedTo(page)).toHaveText("Alpha");
  // Focus never moved, which is the whole reason the narration works.
  await expect(queryField(page)).toBeFocused();

  // Narrowing drops three of the four rows, including ones the walk had visited —
  // and the walk re-seats at the top of the NEW set rather than chasing a row that
  // no longer exists.
  await page.keyboard.type("lph");
  await expect(results(page)).toHaveText(["Alpha"]);
  await expect(walkedTo(page)).toHaveText("Alpha");
});

test("j and k are query text in the filter, not walk keys", async ({ daemon, page }) => {
  // Pinned so the split reads as a decision rather than an oversight. The hierarchy
  // menus walk on j/k — asserted by the specs above — but inside the filter a bare
  // letter is a letter, because a field that swallowed it could not search for a
  // heading containing it.
  await daemon.seed({ plan: NESTED_PLAN });
  await page.goto("/");
  await expect(page.locator(`${CRUMB}.current`)).toBeVisible();
  await waitPastSafeModeGrace(page);

  await page.keyboard.press("b");
  await page.keyboard.press("/");
  await expect(queryField(page)).toBeFocused();
  await page.keyboard.type("k");

  await expect(queryField(page)).toHaveValue("k");
  // No heading in this plan holds a "k", so the letter narrowed the list rather
  // than stepping it.
  await expect(results(page)).toHaveCount(0);
  await expect(filterPanel(page).getByRole("status")).toHaveText("No headings match");
});

test("the flat filter drives the list, not the command's own filter engine", async ({
  daemon,
  page,
}) => {
  // The vendored command scores every row against the query and hides what scores 0.
  // Turning it off is what lets `headingMatches` own the list — the same one prop the
  // ToC popup sets, which is what the issue means by sharing the override rather than
  // copying it.
  await daemon.seed({ plan: NESTED_PLAN });
  await page.goto("/");
  await expect(page.locator(`${CRUMB}.current`)).toBeVisible();
  await waitPastSafeModeGrace(page);

  await page.keyboard.press("b");
  await page.keyboard.press("/");
  await page.keyboard.type("o");

  // Exactly the three matches, in document order, each naming its parent on its own
  // row. Both halves are falsifiable here: the command's engine scores rows on their
  // `value` — the source line — so with it on every row would score 0 and the panel
  // would empty; and the ToC's grouped filter would answer this query with breadcrumb
  // headers naming "Alpha" and "Delta" above their matches instead.
  await expect(results(page)).toHaveText(["Bravo Alpha", "Echo Delta", "Foxtrot Alpha"]);
});

test("the bar's / never reaches the plan's own search, and gives it back on close", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: NESTED_PLAN });
  await page.goto("/");
  await expect(page.locator(`${CRUMB}.current`)).toBeVisible();
  await waitPastSafeModeGrace(page);

  const menu = page.locator(MENU);
  const search = page.getByRole("search");
  await page.keyboard.press("b");
  await page.keyboard.press("/");
  await expect(queryField(page)).toBeFocused();
  // The bar's keydown handler called preventDefault, which the window dispatcher
  // honours by returning early — so actions.search never fired.
  await expect(search).toHaveCount(0);

  // Escape steps back to the hierarchy, a second one closes the menu; `/` on the
  // plan then opens the search pill exactly as it does with the bar untouched.
  await page.keyboard.press("Escape");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await page.keyboard.press("/");
  await expect(search).toBeVisible();
});

test("Escape restores the hierarchical menu without leaving the bar", async ({ daemon, page }) => {
  await daemon.seed({ plan: NESTED_PLAN });
  await page.goto("/");

  await jumpTo(page, "Charlie");
  await expect(page.locator(CRUMB)).toHaveText(["Alpha", "Bravo", "Charlie"]);

  const menu = page.locator(MENU);
  await page.keyboard.press("b");
  await page.keyboard.press("/");
  await expect(queryField(page)).toBeVisible();

  await page.keyboard.press("Escape");
  // The filter panel goes and the same crumb's menu comes back, on the hierarchy it
  // opened with — and focus landed on a row, which is what keeps the walk alive. A
  // restore that stranded focus on the body would still pass the assertions above.
  await expect(filterPanel(page)).toHaveCount(0);
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem")).toHaveText(["Charlie"]);
  await expect(menu.getByRole("menuitem", { name: "Charlie" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(page.locator(CRUMB).last()).toBeFocused();

  // And a third leaves the bar. Escape means one step out at every depth the bar
  // has, the filter panel included: hierarchy back, menu shut, bar unfocused.
  await page.keyboard.press("Escape");
  await expect(page.locator(BAR)).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe("BODY");
});

test("Tab walks the filter's results without leaving the panel", async ({ daemon, page }) => {
  // EXC-1121 supersedes the Tab-leaves-the-bar behaviour EXC-1098 pinned: the key
  // now walks this list the way it walks the hierarchy menus. Left to the browser it
  // would step off the END OF THE DOCUMENT, since the panel is portalled to the body
  // and nothing is tabbable after it — so "focus never moved" is half the claim and
  // "the selection did" is the other half.
  await daemon.seed({ plan: NESTED_PLAN });
  await page.goto("/");
  await expect(page.locator(`${CRUMB}.current`)).toBeVisible();
  await waitPastSafeModeGrace(page);

  await page.keyboard.press("b");
  await page.keyboard.press("/");
  await expect(queryField(page)).toBeFocused();
  await expect(walkedTo(page)).toHaveText("Alpha");

  await page.keyboard.press("Tab");
  await expect(walkedTo(page)).toHaveText("Bravo Alpha");
  await page.keyboard.press("Tab");
  await expect(walkedTo(page)).toHaveText("Charlie Bravo");
  await page.keyboard.press("Shift+Tab");
  await expect(walkedTo(page)).toHaveText("Bravo Alpha");

  // The panel is still standing and the field still has focus, which is what the
  // narration depends on.
  await expect(filterPanel(page)).toHaveCount(1);
  await expect(queryField(page)).toBeFocused();
});

test("the Tab walk wraps, and brings the row it lands on into view", async ({ daemon, page }) => {
  // `loop` on the command is what wraps here — it defaults OFF, where the menus'
  // own `loop` defaults on. And wrapping backwards off the first row is the cheapest
  // gesture that also proves the scroll: it lands on the last row of a list taller
  // than its box, which the re-dispatched arrow brings into sight and a hand-written
  // selection would not.
  await daemon.seed({ plan: LONG_PLAN });
  await page.goto("/");
  await expect(page.locator(`${CRUMB}.current`)).toBeVisible();
  await waitPastSafeModeGrace(page);

  await page.keyboard.press("b");
  await page.keyboard.press("/");
  await expect(queryField(page)).toBeFocused();
  await expect(walkedTo(page)).toHaveText("Alpha");

  const last = results(page).last();
  await expect(last).toHaveText("Section 12 Alpha");
  expect(await isWithinResults(page, last)).toBe(false);

  await page.keyboard.press("Shift+Tab");
  await expect(walkedTo(page)).toHaveText("Section 12 Alpha");
  await expect.poll(() => isWithinResults(page, last)).toBe(true);

  // And forwards off the last row comes back to the first.
  await page.keyboard.press("Tab");
  await expect(walkedTo(page)).toHaveText("Alpha");
});

test("holding Tab keeps walking the filter's results until it is released", async ({
  daemon,
  page,
}) => {
  // The filter's half of the hold (EXC-1122). It walks a SELECTION rather than focus,
  // so the row is read off the command's own marker — and a thirteen-row list gives
  // the run somewhere to go before it wraps.
  await daemon.seed({ plan: LONG_PLAN });
  await page.goto("/");
  await expect(page.locator(`${CRUMB}.current`)).toBeVisible();
  await waitPastSafeModeGrace(page);

  await page.keyboard.press("b");
  await page.keyboard.press("/");
  await expect(queryField(page)).toBeFocused();
  await expect(walkedTo(page)).toHaveText("Alpha");

  const selected = async () => (await walkedTo(page).allTextContents()).join("");
  await page.keyboard.down("Tab");
  await walkVisits(selected, 5);
  await page.keyboard.up("Tab");

  const stopped = await selected();
  expect(stopped).not.toBe("");
  await pastKeyRepeatDelay(page);
  expect(await selected()).toBe(stopped);

  // And the panel is still the reviewer's: a held Tab neither dismissed it nor let
  // the browser's own tab move out of it through.
  await expect(queryField(page)).toBeFocused();
});

test("a click outside dismisses the filter and leaves the plan where it was", async ({
  daemon,
  page,
}) => {
  // The filter is a panel of its own now, so the menu's dismissal no longer covers
  // it: a popover left standing over the plan after the reviewer clicks away is the
  // failure this pins.
  await daemon.seed({ plan: NESTED_PLAN });
  await page.goto("/");

  await jumpTo(page, "Charlie");
  const parked = await parkedAt(page);

  await page.keyboard.press("b");
  await page.keyboard.press("/");
  await expect(queryField(page)).toBeFocused();

  // Below the panel's own box rather than on a named element: the panel hangs off a
  // crumb at the top of the plan, so the first rows sit beneath it and a click there
  // would land on the dismiss layer instead of outside it.
  const panelBox = await filterPanel(page).boundingBox();
  const planBox = await page.locator(PLAN_SURFACE).boundingBox();
  expect(panelBox).not.toBeNull();
  expect(planBox).not.toBeNull();
  await page.mouse.click(planBox!.x + planBox!.width / 2, panelBox!.y + panelBox!.height + 40);

  await expect(filterPanel(page)).toHaveCount(0);
  await expect(page.locator(MENU)).toHaveCount(0);
  await expect(page.locator(CRUMB)).toHaveText(["Alpha", "Bravo", "Charlie"]);
  expect(await scrollTop(page)).toBe(parked);
});

test("/ reaches the filter from inside a submenu too", async ({ daemon, page }) => {
  // The handler sits on the SubContent as well as the Content, so the key works at
  // any depth — and that is the one path where the swap unmounts the submenu and
  // its trigger underneath the focus the field is about to take.
  await daemon.seed({ plan: NESTED_PLAN });
  await page.goto("/");

  await jumpTo(page, "Charlie");
  await expect(page.locator(CRUMB)).toHaveText(["Alpha", "Bravo", "Charlie"]);

  // Open the outermost crumb and step into its submenu, as the nested-walk spec does.
  await page.locator(CRUMB).first().click();
  await page.keyboard.press("j");
  await page.keyboard.press("ArrowRight");
  const submenu = page.locator(SUBMENU);
  await expect(submenu).toBeVisible();

  await page.keyboard.press("/");
  await expect(queryField(page)).toBeFocused();
  await expect(submenu).toHaveCount(0);
  await expect(page.locator(MENU)).toHaveCount(0);
  await expect(results(page)).toHaveCount(6);
});

test("a query matching nothing says so instead of emptying the panel", async ({ daemon, page }) => {
  await daemon.seed({ plan: NESTED_PLAN });
  await page.goto("/");
  await expect(page.locator(`${CRUMB}.current`)).toBeVisible();
  await waitPastSafeModeGrace(page);

  await page.keyboard.press("b");
  await page.keyboard.press("/");
  await page.keyboard.type("zzz");
  await expect(results(page)).toHaveCount(0);
  // Narrowing to nothing is the one change aria-activedescendant cannot carry —
  // there is no active row left to name — so a live region says it out loud.
  await expect(filterPanel(page).getByRole("status")).toHaveText("No headings match");

  // Enter with nothing to jump to leaves the plan where it was.
  await page.keyboard.press("Enter");
  await expect(filterPanel(page)).toBeVisible();
  await expect(page.locator(CRUMB)).toHaveText(["Alpha"]);
});

test("compare mode drops the bar, which tracks no heading there", async ({ daemon, page }) => {
  await daemon.seedVersions(2, [`# Alpha\n\n${filler("Alpha")}\n`, NESTED_PLAN]);
  await page.goto("/");

  await expect(page.locator(BAR)).toBeVisible();
  await page.getByRole("button", { name: /^Versions/ }).click();
  await expect(page.locator(BAR)).toHaveCount(0);

  // With the bar gone the picker stretches again, which is what keeps its display
  // toggles on the row's right edge — the half of the flex split the single-version
  // specs above cannot see.
  const controls = await page.locator(".control-row .controls").boundingBox();
  const row = await page.locator(".control-row").boundingBox();
  expect(controls).not.toBeNull();
  expect(row).not.toBeNull();
  expect(row!.x + row!.width - (controls!.x + controls!.width)).toBeLessThan(40);
});

// EXC-1123's exit pass. Every spec below needs a real engine for the reason plan-toc.e2e.ts
// records at length: happy-dom resolves no `animation` shorthand, fires no
// `animationstart`/`animationend`, and implements no Web Animations API, so a mount suite
// can reach nothing about motion at all.

/** What the bar's own elements really animated, captured from the engine.
 *
 * Sampled at `animationstart` rather than at `animationend`, because the exit's whole
 * point is that its element is leaving: the end races the removal, while the start is
 * guaranteed to happen with the crumb still in the list. `animationstart` bubbles, so one
 * listener on the bar covers every crumb and separator inside it — and the menus a jump
 * opens are portalled to the body, so their own motion never lands in this log.
 *
 * Arming a recorder first and running the gesture into it is what makes "a departure is
 * animated too" falsifiable: strip the exit and the array comes back empty rather than
 * merely different. */
type BarMotion = { name: string; slot: string; duration: number; easing: string }[];

async function armBarMotion(page: Page): Promise<void> {
  await page.locator(BAR).evaluate((bar) => {
    const w = window as Window & { __barMotion?: BarMotion };
    w.__barMotion = [];
    bar.addEventListener("animationstart", (event) => {
      const target = event.target as HTMLElement;
      const style = getComputedStyle(target);
      w.__barMotion?.push({
        name: (event as AnimationEvent).animationName,
        slot: target.dataset.slot ?? "",
        // Both read as the animation BEGINS, the one moment the leaving cascade is live on
        // a crumb that is about to stop existing.
        duration: Number.parseFloat(style.animationDuration),
        easing: style.animationTimingFunction,
      });
    });
  });
}

const barMotion = (page: Page): Promise<BarMotion> =>
  page.evaluate(() => (window as Window & { __barMotion?: BarMotion }).__barMotion ?? []);

/** Matched by SUFFIX, never by equality: Svelte hashes a component's `@keyframes` names,
 * so what the engine reports is `svelte-<hash>-crumb-out` and the hash moves whenever the
 * component's CSS is edited. */
const named = (log: BarMotion, keyframes: string): BarMotion =>
  log.filter((event) => event.name.endsWith(keyframes));

test("a level leaving the trail plays the exit, and its separator leaves with it", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: NESTED_PLAN });
  await page.goto("/");

  // Armed before the DEEPENING as well, so both halves of the pairing are sampled off the
  // same engine on the same elements. That is what lets the easing assertion below be a
  // comparison rather than two readings that happen to differ.
  await armBarMotion(page);
  await jumpTo(page, "Charlie");
  await expect(page.locator(CRUMB)).toHaveText(["Alpha", "Bravo", "Charlie"]);
  await jumpTo(page, "Bravo");
  await expect(page.locator(CRUMB)).toHaveText(["Alpha", "Bravo"]);

  const log = await barMotion(page);
  const leaving = named(log, "crumb-out");
  const arriving = named(log, "crumb-in");
  // The crumb AND the chevron that travelled in with it. A separator left hanging for a
  // frame after its level has gone is the artefact the pairing exists to avoid.
  expect([...new Set(leaving.map((event) => event.slot))].sort()).toEqual([
    "breadcrumb-item",
    "breadcrumb-separator",
  ]);

  // On the exit tier, not the enter one. The pairing is the claim, so the two tokens are
  // read as well — drifted to the same number they would make this assertion vacuous.
  const exitSeconds = await motionToken(page, "--dur-exit");
  const enterSeconds = await motionToken(page, "--dur-enter");
  expect(exitSeconds).not.toBe(enterSeconds);
  expect(arriving.length).toBeGreaterThan(0);
  for (const event of leaving) expect(event.duration).toBeCloseTo(exitSeconds, 3);
  for (const event of arriving) expect(event.duration).toBeCloseTo(enterSeconds, 3);

  // And the curve turns around with it: leaving accelerates out where arriving decelerated
  // in. Read off the animations that really ran, so --ease-in is pinned by the engine
  // rather than only by a regex over the stylesheet.
  expect(leaving[0]?.easing).not.toBe(arriving[0]?.easing);
});

test("walking to a sibling swaps the label without firing the exit", async ({ daemon, page }) => {
  // SIBLING_PLAN rather than NESTED_PLAN, and that is the spec rather than a convenience.
  // A jump between two sections that HAVE subsections scrolls through one of those
  // subsections, so the trail genuinely deepens and shortens on the way and an exit there
  // is correct. What must not animate out is the swap itself: a re-root that leaves the
  // depth where it was.
  await daemon.seed({ plan: SIBLING_PLAN });
  await page.goto("/");

  await jumpTo(page, "Bravo");
  await expect(page.locator(CRUMB)).toHaveText(["Alpha", "Bravo"]);

  await armBarMotion(page);
  await jumpTo(page, "Delta");
  await expect(page.locator(CRUMB)).toHaveText(["Alpha", "Delta"]);

  const log = await barMotion(page);
  // No level was destroyed: the crumb kept its box, keyed on depth, and swapped its label.
  // An exit here would read as the trail shortening when it did not.
  expect(named(log, "crumb-out")).toEqual([]);
  expect(named(log, "crumb-text-in").length).toBeGreaterThan(0);
});

test("reduced motion collapses the exit rather than removing it", async ({ daemon, page }) => {
  // AC5, emulated HERE rather than in playwright.config.ts, for the reason plan-toc.e2e.ts
  // gives: turning `reduce` on suite-wide would stop this file ever exercising the animated
  // path that is the whole subject of the change.
  //
  // The guard is the global one in styles/base.css, reaching the bar through its `#app *`
  // arm; there is deliberately no reduced-motion block in the component. It collapses the
  // duration rather than deleting the animation, and here that distinction is load-bearing
  // twice over: the same duration is what holds the leaving crumb in the DOM, so an
  // `animation: none` would leave a wait behind with nothing left to wait for.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await daemon.seed({ plan: NESTED_PLAN });
  await page.goto("/");

  await jumpTo(page, "Charlie");
  await expect(page.locator(CRUMB)).toHaveText(["Alpha", "Bravo", "Charlie"]);

  await armBarMotion(page);
  await jumpTo(page, "Bravo");
  await expect(page.locator(CRUMB)).toHaveText(["Alpha", "Bravo"]);

  const leaving = named(await barMotion(page), "crumb-out");
  expect(leaving.length).toBeGreaterThan(0);
  for (const event of leaving) expect(event.duration).toBeLessThan(0.001);

  // The vocabulary underneath is untouched — what changed is what the cascade computed on
  // the crumb. motionToken probes outside #app and carries no data-slot, so neither arm of
  // the guard reaches it.
  expect(await motionToken(page, "--dur-exit")).toBeGreaterThan(0.1);
});

test("a level that comes back mid-exit leaves no hole where its chevron was", async ({
  daemon,
  page,
}) => {
  // The trail re-roots continuously as the reader scrolls, so a level can start leaving and
  // be back before --dur-exit is up. Svelte aborts the outro there and keeps the node — but
  // `crumb-leaving` is added by crumbOut() rather than by Svelte, so nothing in the abort
  // path knows to take it off again. Left on, `crumb-out ... forwards` pins the last frame
  // at opacity 0 for good, while the element keeps `position: static` and its box: the row
  // still reserves the chevron's width and paints nothing into it.
  //
  // Scrolled directly rather than through jumpTo, which opens a menu and types: the abort
  // only happens INSIDE the exit window, and the gesture has to be quicker than the thing
  // it is racing.
  await daemon.seed({ plan: NESTED_PLAN });
  await page.goto("/");

  // The exit is widened for this spec, and that is the difference between a test and a coin
  // toss. What is under test is what an ABORTED outro leaves behind, not how quickly one can
  // be caught: at the real 140ms the abort has to win a race against whatever else the machine
  // is doing, which under a full gate it does not reliably. Stretching the token makes the
  // abort a certainty and changes nothing about the mechanism — crumbOut() reads its wait back
  // out of the cascade, so the longer exit is honoured end to end.
  await page.addStyleTag({ content: ":root { --dur-exit: 2s; }" });
  expect(await motionToken(page, "--dur-exit")).toBeGreaterThan(1);

  await jumpTo(page, "Charlie");
  await expect(page.locator(CRUMB)).toHaveText(["Alpha", "Bravo", "Charlie"]);

  const deep = await page.locator(PLAN_SURFACE).evaluate((el) => el.scrollTop);

  // Both scrolls happen in the PAGE: a round-trip per step would put the wire inside the
  // window this is trying to land in. The trail is shortened, the exit is waited for by
  // FRAME rather than by clock, and the levels go back the moment it is seen to have started.
  // What that wait observed is asserted below, so a version that stops aborting anything fails
  // instead of passing vacuously.
  const abortedAnExit = await page.evaluate(
    async ({ selector, y }) => {
      const surface = document.querySelector<HTMLElement>(selector);
      if (surface === null) return false;
      surface.scrollTop = 0;
      const leaving = await new Promise<boolean>((resolve) => {
        let frames = 0;
        const look = (): void => {
          if (document.querySelectorAll(".plan-breadcrumbs .crumb-leaving").length > 0) {
            resolve(true);
            return;
          }
          if (++frames > 120) {
            resolve(false);
            return;
          }
          requestAnimationFrame(look);
        };
        requestAnimationFrame(look);
      });
      surface.scrollTop = y;
      return leaving;
    },
    { selector: PLAN_SURFACE, y: deep },
  );
  expect(abortedAnExit).toBe(true);

  // The abort is only exercised if the levels really came back, so that is asserted before
  // the claim rather than assumed by it.
  await expect(page.locator(CRUMB)).toHaveText(["Alpha", "Bravo", "Charlie"]);

  // Settled on the engine rather than on a duration: mid-flight the exit is PART way down, so
  // an opacity read taken then says nothing, and `expect.poll` would take the first sample
  // that happened to look clean. Once nothing is running, a node still dark is one `forwards`
  // has pinned there for good — which is exactly the state under test.
  // RUNNING, not merely present: an exit pinned by `forwards` stays in getAnimations() for as
  // long as it is holding a frame, so counting them all would make this wait the assertion and
  // the real claim below unreachable.
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          document
            .querySelector(".plan-breadcrumbs")
            ?.getAnimations({ subtree: true })
            .filter((animation) => animation.playState === "running").length,
      ),
    )
    .toBe(0);

  // The reader's claim: every chevron the row is holding space for actually paints. Read off
  // computed opacity rather than the class, so it fails on what the reader sees rather than
  // on the mechanism that happens to cause it today.
  const holes = await page.evaluate(() => {
    const list = document.querySelector(".plan-breadcrumbs [data-slot='breadcrumb-list']");
    if (list === null) return [];
    return [...list.children]
      .filter((el) => {
        const style = getComputedStyle(el);
        const inFlow = style.position !== "absolute" && style.visibility !== "hidden";
        return (
          el.getAttribute("data-slot") === "breadcrumb-separator" &&
          inFlow &&
          Number(style.opacity) === 0
        );
      })
      .map((el) => (el as HTMLElement).className);
  });
  expect(holes).toEqual([]);

  // And the mechanism, so a regression is named at its cause: the class crumbOut() adds must
  // not outlive the transition it belongs to. It is the crumbs' own guard too — measure()
  // reads `.crumb-item:not(.crumb-leaving)`, so one stuck here drops that level out of the
  // widths the elision is computed from, for as long as the node lives.
  await expect(page.locator(`${BAR} .crumb-leaving`)).toHaveCount(0);
});

// The plan's table-of-contents popup (EXC-1095 built the surface, EXC-1096 gives it
// this contract). The popup is a bits-ui Popover holding a Command: a filter field
// over a listbox that shows TWO views of one heading model. With no query it is every
// heading nested by level, the one being read marked. With a query it is the matches
// only, gathered under one breadcrumb header per ancestor path and rendered flush left
// (EXC-1103).
//
// Everything asserted here needs a real browser, which is why it is a spec rather
// than an extension of ui/src/components/PlanToc.test.ts (browser-testing.md). The
// keyboard walk is bits-ui's roving selection driven by real keydown; Escape,
// outside-click and focus restoration are the popover's own interaction semantics;
// "the current heading is scrolled into view" is a scroll measurement against a real
// box; the narration attributes are read back off the live DOM, where a screen reader
// would find them; and a breadcrumb header naming its group is an aria-labelledby the
// ROLE ENGINE has to resolve, which a mount can only assert points somewhere. Clearing
// the query is browser work for a subtler reason: it crosses bits-ui's
// `{#key search === ""}` boundary, which destroys and rebuilds the whole viewport.
// The pure half — which groups exist and what sits in them, the marked row, the a11y
// attributes' presence on a mounted popup — is that unit suite, and the vendored
// primitive's own viewport wiring is pinned in
// ui/src/lib/shadcn-command-popover.test.ts.
//
// EXC-1097 adds the `\` key, and its specs sit here for the same reason: a bare
// keydown has to travel the real global dispatcher past the real safe-mode grace to
// reach a popup that is really portalled, and none of that exists under a mount. The
// pure half is again the unit suite — that the reservation carries the key and that
// PlanToc hands an open action up (keymap.test.ts, PlanToc.test.ts). Compare mode is
// a third thing still: what it needs is a review with TWO versions, which is daemon
// state no prop can stand in for, so it is e2e on the axis browser-testing.md calls
// the more interesting half.
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

// Twenty-four sections under one top-level heading — enough rows that the popup's list
// overflows its 36rem max-height, which is what makes "the current heading is scrolled
// into view on open" a claim about scrolling rather than about a list that fits whole.
// The count tracks that height and nothing else: EXC-1102 doubled the panel from 18rem,
// and a fixture left at twelve sections then fit whole, turning the out-of-view half of
// that assertion from a guard into a false alarm. Grow this list if the height grows
// again — never relax the assertion, which is the only thing proving the list scrolls.
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
  "Mike",
  "November",
  "Oscar",
  "Papa",
  "Quebec",
  "Romeo",
  "Sierra",
  "Tango",
  "Uniform",
  "Victor",
  "Whiskey",
  "Xray",
];
const TALL_PLAN = [
  "# Plan",
  filler("Plan"),
  ...SECTIONS.flatMap((s) => [`## ${s}`, filler(s)]),
  "",
].join("\n\n");

// Two matches for "notes" sitting in different branches, so filtering produces two
// distinct ancestor paths and puts a breadcrumb header BETWEEN the two selectable rows
// — the arrangement the roving walk has to cross without landing on it, and the
// hierarchy the flat breadcrumbs filter cannot express. "Wrapup" matches nothing, so it
// is what proves the filtered view is shorter than the tree.
const BRANCHED_PLAN = [
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
/** The breadcrumbs bar's dropdown — the OTHER heading surface, addressed here only
 * to prove `\` and `b` do not reach the same one. Same selector plan-breadcrumbs
 * hoists as MENU. */
const CRUMB_MENU = "[data-slot='dropdown-menu-content']";

const trigger = (page: Page) => page.getByRole("button", { name: "Contents" });
/** The popup itself. Every locator below is scoped through it, which is what lets them
 * be role queries: the breadcrumbs bar publishes a filter field with the SAME accessible
 * name, and an unscoped query would collect both (browser-testing.md § Locators). */
const panel = (page: Page) => page.locator(TOC);
const listbox = (page: Page) => panel(page).getByRole("listbox", { name: "Plan headings" });
/** Deliberately role queries rather than `[role=...]` CSS: Playwright's role engine reads
 * the ACCESSIBILITY TREE, and whether these rows are options in that tree is this spec's
 * entire subject — an attribute selector would still match a row that had been taken out
 * of it, which is exactly the regression the viewport's `role="none"` exists to prevent. */
const options = (page: Page) => panel(page).getByRole("option");
const field = (page: Page) => panel(page).getByRole("combobox", { name: "Filter headings" });
/** A breadcrumb group by the path it names (EXC-1103). A role-AND-name query, and the
 * choice is this spec's subject rather than style: whether the ancestor path reaches the
 * accessibility tree as the group's NAME is exactly what changed, and only the role
 * engine can answer it — an attribute selector would match the header element whether or
 * not anything was labelled by it. */
const group = (page: Page, name: string) => panel(page).getByRole("group", { name, exact: true });
/** Every breadcrumb header's text, in document order, for asserting the whole set at once
 * and for its ORDER, which a per-name lookup cannot see. The header publishes no role of
 * its own — it is the `aria-labelledby` target — so this is browser-testing.md's "no
 * accessible target" case and a `data-*` selector is the honest form. */
const crumbs = (page: Page) => panel(page).locator("[data-command-group-heading]");
/** The row the roving walk is on. bits-ui marks it `data-selected`; the reader is told
 * about it through the field's aria-activedescendant, asserted in its own test below. */
const walkedTo = (page: Page) => options(page).and(page.locator("[data-selected]"));

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
 * cannot make, since happy-dom lays nothing out.
 *
 * Throws rather than returning false when either box is unmeasurable: one caller asserts
 * this is FALSE, to prove the list really scrolls rather than showing every heading at
 * once, and a false-on-null would let "not measurable" pass as "correctly out of view".
 * `expect.poll` fails on a throw exactly as it should. */
async function isWithinList(page: Page, row: Locator): Promise<boolean> {
  const rowBox = await row.boundingBox();
  const listBox = await listbox(page).boundingBox();
  if (rowBox === null || listBox === null) throw new Error("row or list has no bounding box");
  return rowBox.y >= listBox.y - 1 && rowBox.y + rowBox.height <= listBox.y + listBox.height + 1;
}

test("opens on the heading being read, scrolled into view", async ({ daemon, page }) => {
  await daemon.seed({ plan: TALL_PLAN });
  await page.goto("/");
  // Whiskey, not the trailing Xray: the plan scrolls only a third of a viewport past its
  // end, which is not enough room to bring the FINAL heading up to the reading zone, so
  // a jump there clamps short and the tracked heading stays on the section above it.
  // Whiskey is still far enough down that a popup opening at the top would leave its row
  // below the list's 36rem fold.
  await readingAt(page, "Whiskey");

  await openToc(page);
  const current = options(page).and(page.locator('[aria-current="location"]'));
  await expect(current).toHaveText("Whiskey");

  // The status line is mounted even with rows on screen — it has to be idle in the DOM
  // before it announces — so it must cost no height while it has nothing to say.
  expect(await panel(page).getByRole("status").count()).toBe(1);
  expect((await panel(page).getByRole("status").boundingBox())?.height ?? -1).toBe(0);
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

test("the roving walk visits match rows only, never a breadcrumb header", async ({
  daemon,
  page,
}) => {
  // EXC-1103 removed the rows the walk used to have to step OVER, and the claim
  // inverts rather than disappearing: the headers are still between the matches
  // visually, and one arrow press still has to cross a header without landing on it.
  // Real-browser because it is bits-ui's roving selection under a real keydown.
  await daemon.seed({ plan: BRANCHED_PLAN });
  await page.goto("/");
  await readingAt(page, "Setup");

  await openToc(page);
  await field(page).fill("notes");

  await expect(options(page)).toHaveText(["Setup notes", "Rollout notes"]);
  await expect(crumbs(page)).toHaveText(["Plan › Setup", "Plan › Rollout"]);

  await expect(walkedTo(page)).toHaveText("Setup notes");
  await page.keyboard.press("ArrowDown");
  // Lands on the next MATCH, not on the "Plan › Rollout" header sitting between them.
  await expect(walkedTo(page)).toHaveText("Rollout notes");
  await expect(walkedTo(page)).toHaveCount(1);
});

test("each breadcrumb header names its group in the accessibility tree", async ({
  daemon,
  page,
}) => {
  // AC11, and the reason the header is a Command.Group heading rather than markup of
  // caret's own: the ancestor path has to reach a screen reader as the group's NAME.
  // Real-browser because only the role engine resolves aria-labelledby — the unit mount
  // can assert the attribute points somewhere, not that the name computes from it.
  await daemon.seed({ plan: BRANCHED_PLAN });
  await page.goto("/");
  await readingAt(page, "Setup");

  await openToc(page);
  await field(page).fill("notes");

  await expect(group(page, "Plan › Setup")).toBeVisible();
  await expect(group(page, "Plan › Rollout")).toBeVisible();
  // The match sits INSIDE the group its breadcrumb names, which is what makes the
  // header wayfinding rather than a caption that happens to be nearby.
  await expect(group(page, "Plan › Setup").getByRole("option")).toHaveText(["Setup notes"]);
  // The dimmed context rows this view used to render are gone (AC7).
  await expect(panel(page).locator(".toc-context")).toHaveCount(0);
});

test("the grouping filter drives the list, not the command's own filter engine", async ({
  daemon,
  page,
}) => {
  // The vendored command ships a fuzzy filter that both hides non-matching rows and
  // RE-SORTS the survivors by score. Turning it off is what lets `groupedHeadingMatches`
  // own the list. Falsifiable two ways: a score sort would shuffle the document order
  // the groups and their rows keep, and the stock engine — which scores a row against
  // its VALUE, the source line — would empty the panel outright rather than re-sort it.
  await daemon.seed({ plan: BRANCHED_PLAN });
  await page.goto("/");
  await readingAt(page, "Setup");

  await openToc(page);
  await field(page).fill("notes");

  await expect(crumbs(page)).toHaveText(["Plan › Setup", "Plan › Rollout"]);
  await expect(options(page)).toHaveText(["Setup notes", "Rollout notes"]);

  // Every match row is flush left now, whatever its own heading level: the breadcrumb
  // above it carries the hierarchy, so the indent no longer repeats it (AC5).
  const depths = await options(page).evaluateAll((els) =>
    els.map((el) => (el as HTMLElement).style.getPropertyValue("--toc-depth")),
  );
  expect(depths).toEqual(["0", "0"]);
});

// EXC-1104 marks the matched characters by cutting a row's label into runs, which turns
// the option's NAME into a name-from-content computation over several child nodes instead
// of over one text node. Only a role engine performs that computation — a mount can assert
// the label's textContent and nothing more — so it is pinned here, beside the
// aria-labelledby resolution above and for the same reason.
//
// The QUERY is the load-bearing part of this spec, and a word-boundary one would make it
// vacuous. Accessible names are whitespace-normalized, so a split at a space survives a
// stray separator intact: "Setup " + "notes" with a separator between is "Setup  notes",
// which normalizes straight back to the expected name and the assertion never reds. "ote"
// splits mid-word into "Setup n" + "ote" + "s", where a separator normalizes to
// "Setup n ote s" and cannot hide. Keep any future query here mid-word.
test("marking the matched characters leaves the option's accessible name alone", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: BRANCHED_PLAN });
  await page.goto("/");
  await readingAt(page, "Setup");

  await openToc(page);
  await field(page).fill("ote");

  // The mark is really rendered — otherwise the name below is trivially unchanged and
  // this spec would pass against a build that highlights nothing at all.
  await expect(panel(page).locator(".toc-hit")).toHaveText(["ote", "ote"]);
  await expect(options(page).first()).toHaveAccessibleName("Setup notes");
  await expect(options(page).nth(1)).toHaveAccessibleName("Rollout notes");
});

test("clearing the query puts the nested tree back", async ({ daemon, page }) => {
  // AC8: the breadcrumb form is a search affordance only. Real-browser because it
  // crosses bits-ui's `{#key search === ""}` boundary, which tears the whole viewport
  // down and rebuilds it — the one transition a mounted unit cannot exercise honestly.
  await daemon.seed({ plan: BRANCHED_PLAN });
  await page.goto("/");
  await readingAt(page, "Setup");

  await openToc(page);
  await field(page).fill("notes");
  await expect(crumbs(page)).toHaveCount(2);

  await field(page).fill("");
  await expect(crumbs(page)).toHaveCount(0);
  await expect(options(page)).toHaveText([
    "Plan",
    "Setup",
    "Setup notes",
    "Rollout",
    "Rollout notes",
    "Wrapup",
  ]);

  // Back to indenting by the heading's own level.
  const depths = await options(page).evaluateAll((els) =>
    els.map((el) => (el as HTMLElement).style.getPropertyValue("--toc-depth")),
  );
  expect(depths).toEqual(["0", "1", "2", "1", "2", "1"]);
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
  await daemon.seed({ plan: BRANCHED_PLAN });
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
  await daemon.seed({ plan: BRANCHED_PLAN });
  await page.goto("/");
  await readingAt(page, "Setup");

  await openToc(page);
  await expect(field(page)).toHaveAttribute("aria-controls", /.+/);

  // aria-controls resolves to the viewport the rows live in, inside the listbox.
  const controls = (await field(page).getAttribute("aria-controls")) ?? "";
  await expect(listbox(page).locator(`[id="${controls}"]`)).toHaveCount(1);

  // The named row is the heading being read, and it moves as the list narrows.
  // Trimmed rather than read raw: a row also holds the command's check-indicator
  // span, so its textContent carries the whitespace toHaveText would normalize away.
  const narrated = async () => {
    const id = await field(page).getAttribute("aria-activedescendant");
    return ((await panel(page).locator(`[id="${id}"]`).textContent()) ?? "").trim();
  };

  await expect(walkedTo(page)).toHaveText("Setup");
  await expect.poll(narrated).toBe("Setup");

  await field(page).fill("rollout notes");
  await expect(walkedTo(page)).toHaveText("Rollout notes");
  await expect.poll(narrated).toBe("Rollout notes");

  // Narrowing to nothing leaves no row to name, so the message says it out loud
  // instead — the one narrowing aria-activedescendant cannot carry.
  await field(page).fill("nothing matches this");
  await expect(options(page)).toHaveCount(0);
  await expect(panel(page).getByRole("status")).toHaveText("No headings match");
});

test("\\ opens the popup on the heading being read (EXC-1097)", async ({ daemon, page }) => {
  await daemon.seed({ plan: TALL_PLAN });
  await page.goto("/");
  // readingAt parks the reading position AND waits past the safe-mode grace, which
  // the bare key below cannot be pressed before.
  await readingAt(page, "Golf");

  await page.keyboard.press("\\");

  // Opened on the trigger's terms: the walk starts on the heading being read and
  // that row is scrolled into the list's box, with focus in the field so the
  // reviewer can type straight away. The SELECTION is the load-bearing assertion —
  // aria-current is derived from the activeLine prop and would read "Golf" even on
  // a popup that opened at the top of the list.
  await expect(listbox(page)).toBeVisible();
  await expect(walkedTo(page)).toHaveText("Golf");
  await expect
    .poll(() => isWithinList(page, options(page).and(page.locator('[aria-current="location"]'))))
    .toBe(true);
  await expect(field(page)).toBeFocused();
});

test("\\ and b reach different heading surfaces (EXC-1097)", async ({ daemon, page }) => {
  // Two keys, two surfaces: the property worth pinning is that neither one reaches
  // the other's.
  await daemon.seed({ plan: TALL_PLAN });
  await page.goto("/");
  await readingAt(page, "Golf");

  await page.keyboard.press("b");
  await expect(page.locator(CRUMB_MENU)).toBeVisible();
  await expect(panel(page)).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(page.locator(CRUMB_MENU)).toHaveCount(0);

  await page.keyboard.press("\\");
  await expect(listbox(page)).toBeVisible();
  await expect(page.locator(CRUMB_MENU)).toHaveCount(0);
});

test("compare mode drops both of the popup's entry points (EXC-1097)", async ({ daemon, page }) => {
  // Compare mode tracks no heading, so a contents popup there would open on a stale
  // plan. The trigger is dropped with the surface; the key has to be gated too, or
  // it would summon a component that is no longer mounted.
  await daemon.seedVersions(2, [`# Plan\n\n${filler("Plan")}\n`, TALL_PLAN]);
  await page.goto("/");
  await readingAt(page, "Golf");
  await expect(trigger(page)).toBeVisible();

  await page.getByRole("button", { name: /^Compare versions/ }).click();
  await expect(trigger(page)).toHaveCount(0);

  await page.keyboard.press("\\");
  await expect(panel(page)).toHaveCount(0);
});

// Heading breadcrumbs bar for the plan (EXC-946). The bar answers "where am I in
// this plan": the ancestor chain of the heading being read, updating as the
// reviewer scrolls, with each crumb opening that level's siblings.
//
// Everything asserted here needs a real browser. The trail is driven by the plan's
// scroll position measured with getBoundingClientRect, and the sibling menus are
// bits-ui popovers whose open/close, portalling, and submenu reveal are real
// interaction semantics — both e2e concerns per browser-testing.md. The bar's pure
// trail logic is unit-tested in ui/src/components/PlanBreadcrumbs.test.ts.

import type { Page } from "@playwright/test";

import { expect, test, waitPastSafeModeGrace } from "@test/e2e/support/fixtures.ts";
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

const BAR = ".plan-breadcrumbs";
const CRUMB = `${BAR} button.crumb`;
// The crumbs the row is actually showing. A level it cannot hold stays in the
// list, out of flow, so the bar can keep measuring the trail it would need
// (EXC-957) — which is why "visible" here is a class rather than a count.
const SHOWN = `${BAR} .crumb-item:not(.elided) button.crumb`;
const MARKER = `${BAR} .crumb-ellipsis`;
const MENU = "[data-slot='dropdown-menu-content']";
const SUBMENU = "[data-slot='dropdown-menu-sub-content']";
const QUERY = "input[aria-label='Filter headings']";

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

  // And it opens again where it always does — the crumb the reader is on. `\`
  // shares the binding, so the toggle is the same one from either key.
  await page.keyboard.press("\\");
  await expect(menu.getByRole("menuitem")).toHaveText(["Charlie"]);
  await page.keyboard.press("h");
  await page.keyboard.press("\\");
  await expect(menu).toHaveCount(0);
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

// EXC-948: `/` swaps the open menu for a flat filter over every heading. All of
// it is real browser behaviour — the key claim against the plan's own search, the
// roving walk through a set that changes under it, and Escape's step back to the
// hierarchy — so it lives here rather than in the component unit.

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
  await expect(menu.locator(QUERY)).toBeFocused();
  // Every heading in the plan, at every level, not just this menu's siblings.
  await expect(menu.getByRole("menuitem")).toHaveCount(6);

  await page.keyboard.type("echo");
  await expect(menu.getByRole("menuitem")).toHaveText(["Echo Delta"]);
  await page.keyboard.press("Enter");

  // Echo sits under Delta — a different branch from the Bravo one being read.
  await expect(page.locator(CRUMB)).toHaveText(["Alpha", "Delta", "Echo"]);
  await expect.poll(() => new URL(page.url()).searchParams.get("heading")).toBe("echo");
});

test("j and k walk the results, and stay coherent as the query narrows them", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: NESTED_PLAN });
  await page.goto("/");
  await expect(page.locator(`${CRUMB}.current`)).toBeVisible();
  await waitPastSafeModeGrace(page);

  await page.keyboard.press("b");
  const menu = page.locator(MENU);
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem")).toHaveCount(1);
  await page.keyboard.press("/");
  await expect(menu.locator(QUERY)).toBeVisible();
  await page.keyboard.type("a");
  await expect(menu.getByRole("menuitem")).toHaveText([
    "Alpha",
    "Bravo Alpha",
    "Charlie Bravo",
    "Delta Alpha",
  ]);

  // The arrows hand the field's focus to the list — the field is not one of the
  // menu's roving candidates, so it enters at the top going down and at the bottom
  // going up. From there the walk is the menu's own, so j/k step it one row at a
  // time in either direction.
  await page.keyboard.press("ArrowUp");
  await expect(menu.getByRole("menuitem", { name: "Delta Alpha" })).toBeFocused();
  await page.keyboard.press("/");
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "Alpha", exact: true })).toBeFocused();
  await page.keyboard.press("j");
  await page.keyboard.press("j");
  await expect(menu.getByRole("menuitem", { name: "Charlie Bravo" })).toBeFocused();
  await page.keyboard.press("k");
  await expect(menu.getByRole("menuitem", { name: "Bravo Alpha" })).toBeFocused();

  // `/` returns to the query from a walked-to row. Narrowing then drops three of
  // the four rows, including the one that had focus — and the walk still enters
  // the NEW set at its top rather than chasing a row that no longer exists.
  await page.keyboard.press("/");
  await expect(menu.locator(QUERY)).toBeFocused();
  await page.keyboard.type("lph");
  await expect(menu.getByRole("menuitem")).toHaveText(["Alpha"]);
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "Alpha", exact: true })).toBeFocused();
  await page.keyboard.press("j");
  await expect(menu.getByRole("menuitem", { name: "Alpha", exact: true })).toBeFocused();
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
  await expect(menu.locator(QUERY)).toBeFocused();
  // The bar's keydown handler called preventDefault, which the window dispatcher
  // honours by returning early — so actions.search never fired.
  await expect(search).toHaveCount(0);

  // Escape steps back to the hierarchy, a second one closes the menu; `/` on the
  // plan then opens the search pill exactly as it does with the bar untouched.
  await page.keyboard.press("Escape");
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
  await expect(menu.locator(QUERY)).toBeVisible();

  await page.keyboard.press("Escape");
  // Same menu, back on the hierarchy it opened with — and focus landed on a row,
  // which is the whole reason restoring waits a tick for the swap to render. A
  // restore that stranded focus on the body would still pass the assertions above.
  await expect(menu).toBeVisible();
  await expect(menu.locator(QUERY)).toHaveCount(0);
  await expect(menu.getByRole("menuitem")).toHaveText(["Charlie"]);
  await expect(menu.getByRole("menuitem", { name: "Charlie" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(page.locator(CRUMB).last()).toBeFocused();
});

test("Tab leaves the filter rather than being swallowed by the query field", async ({
  daemon,
  page,
}) => {
  // The field stops nearly every key to keep it out of the menu's typeahead, so
  // the keys it must NOT stop need pinning: swallowing Tab strands a keyboard user
  // inside the panel, because the menu's focus scope pulls focus straight back.
  await daemon.seed({ plan: NESTED_PLAN });
  await page.goto("/");
  await expect(page.locator(`${CRUMB}.current`)).toBeVisible();
  await waitPastSafeModeGrace(page);

  const menu = page.locator(MENU);
  await page.keyboard.press("b");
  await page.keyboard.press("/");
  await expect(menu.locator(QUERY)).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(menu).toHaveCount(0);
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
  const submenu = page.locator("[data-slot='dropdown-menu-sub-content']");
  await expect(submenu).toBeVisible();

  await page.keyboard.press("/");
  const menu = page.locator(MENU);
  await expect(menu.locator(QUERY)).toBeFocused();
  await expect(submenu).toHaveCount(0);
  await expect(menu.getByRole("menuitem")).toHaveCount(6);
});

test("a query matching nothing says so instead of emptying the panel", async ({ daemon, page }) => {
  await daemon.seed({ plan: NESTED_PLAN });
  await page.goto("/");
  await expect(page.locator(`${CRUMB}.current`)).toBeVisible();
  await waitPastSafeModeGrace(page);

  const menu = page.locator(MENU);
  await page.keyboard.press("b");
  await page.keyboard.press("/");
  await page.keyboard.type("zzz");
  await expect(menu.getByRole("menuitem")).toHaveCount(0);
  await expect(menu.locator(".crumb-filter-empty")).toHaveText("No headings match");

  // Enter with nothing to jump to leaves the plan where it was.
  await page.keyboard.press("Enter");
  await expect(menu).toBeVisible();
  await expect(page.locator(CRUMB)).toHaveText(["Alpha"]);
});

test("compare mode drops the bar, which tracks no heading there", async ({ daemon, page }) => {
  await daemon.seedVersions(2, [`# Alpha\n\n${filler("Alpha")}\n`, NESTED_PLAN]);
  await page.goto("/");

  await expect(page.locator(BAR)).toBeVisible();
  await page.getByRole("button", { name: /^Compare versions/ }).click();
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

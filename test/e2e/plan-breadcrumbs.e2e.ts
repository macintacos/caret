// Heading breadcrumbs bar for the plan (EXC-946). The bar answers "where am I in
// this plan": the ancestor chain of the heading being read, updating as the
// reviewer scrolls, with each crumb opening that level's siblings.
//
// Everything asserted here needs a real browser. The trail is driven by the plan's
// scroll position measured with getBoundingClientRect, and the sibling menus are
// bits-ui popovers whose open/close, portalling, and submenu reveal are real
// interaction semantics — both e2e concerns per browser-testing.md. The bar's pure
// trail logic is unit-tested in ui/src/components/PlanBreadcrumbs.test.ts.

import { expect, test, waitPastSafeModeGrace } from "@test/e2e/support/fixtures.ts";

// Each section must be taller than the viewport, so scrolling to a later one
// genuinely changes which heading is being read rather than leaving the whole plan
// in view (the same shape toc-active-heading.e2e.ts uses).
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

const BAR = ".plan-breadcrumbs";
const CRUMB = `${BAR} button.crumb`;

/** Scroll the plan to a heading through the ToC rail, which both surfaces share. */
const jumpTo = (page: import("@playwright/test").Page, heading: string) =>
  page.locator(".source-toc").getByRole("button", { name: heading, exact: true }).click();

test("the bar sits in the control row between the compare picker and the path", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: NESTED_PLAN });
  await page.goto("/");

  const bar = page.locator(`.control-row ${BAR}`);
  await expect(bar).toBeVisible();
  // A named nav landmark, so the rail's role in the a11y tree survives its removal.
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

  // The pick lands the heading where a ToC row jump does: the plan is now reading
  // Delta, which the trail and the URL's heading mirror both report.
  await expect(page.locator(CRUMB)).toHaveText(["Alpha", "Delta"]);
  await expect.poll(() => new URL(page.url()).searchParams.get("heading")).toBe("delta");
});

test("a crumb's own heading opens the level below it without leaving the menu", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: NESTED_PLAN });
  await page.goto("/");

  await jumpTo(page, "Charlie");
  await expect(page.locator(CRUMB)).toHaveText(["Alpha", "Bravo", "Charlie"]);

  // Open the level-2 crumb, then its own row — which nests level 3 rather than
  // jumping in place, so one menu walks down the hierarchy.
  await page.locator(CRUMB).nth(1).click();
  await page.locator("[data-slot='dropdown-menu-sub-trigger']").click();
  const submenu = page.locator("[data-slot='dropdown-menu-sub-content']");
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
  // even with the suppression broken — but the very first stray `j` tags a row.
  await expect(page.locator("[data-caret-cursor]")).toHaveCount(0);
});

// EXC-948: `/` swaps the open menu for a flat filter over every heading. All of
// it is real browser behaviour — the key claim against the plan's own search, the
// roving walk through a set that changes under it, and Escape's step back to the
// hierarchy — so it lives here rather than in the component unit.
const MENU = "[data-slot='dropdown-menu-content']";
const QUERY = "input[aria-label='Filter headings']";

test("b then / then a query then Enter jumps across the hierarchy", async ({ daemon, page }) => {
  await daemon.seed({ plan: NESTED_PLAN });
  await page.goto("/");

  // Reading Charlie, whose crumb menu offers only Charlie — the hierarchy cannot
  // reach Echo from here without closing and reopening at two other depths.
  await jumpTo(page, "Charlie");
  await expect(page.locator(CRUMB)).toHaveText(["Alpha", "Bravo", "Charlie"]);
  await waitPastSafeModeGrace(page);

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
  const search = page.locator(".plan-search");
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
  await expect(menu).toBeHidden();
  await page.keyboard.press("/");
  await expect(search).toBeVisible();
});

test("Escape restores the hierarchical menu without leaving the bar", async ({ daemon, page }) => {
  await daemon.seed({ plan: NESTED_PLAN });
  await page.goto("/");

  await jumpTo(page, "Charlie");
  await expect(page.locator(CRUMB)).toHaveText(["Alpha", "Bravo", "Charlie"]);
  await waitPastSafeModeGrace(page);

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
  await expect(menu).toBeHidden();
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
  await expect(menu).toBeHidden();
});

test("/ reaches the filter from inside a submenu too", async ({ daemon, page }) => {
  // The handler sits on the SubContent as well as the Content, so the key works at
  // any depth — and that is the one path where the swap unmounts the submenu and
  // its trigger underneath the focus the field is about to take.
  await daemon.seed({ plan: NESTED_PLAN });
  await page.goto("/");

  await jumpTo(page, "Charlie");
  await expect(page.locator(CRUMB)).toHaveText(["Alpha", "Bravo", "Charlie"]);
  await waitPastSafeModeGrace(page);

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

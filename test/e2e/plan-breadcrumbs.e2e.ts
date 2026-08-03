// Heading breadcrumbs bar for the plan (EXC-946). The bar answers "where am I in
// this plan": the ancestor chain of the heading being read, updating as the
// reviewer scrolls, with each crumb opening that level's siblings.
//
// Everything asserted here needs a real browser. The trail is driven by the plan's
// scroll position measured with getBoundingClientRect, and the sibling menus are
// bits-ui popovers whose open/close, portalling, and submenu reveal are real
// interaction semantics — both e2e concerns per browser-testing.md. The bar's pure
// trail logic is unit-tested in ui/src/components/PlanBreadcrumbs.test.ts.

import { expect, test } from "@test/e2e/support/fixtures.ts";

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

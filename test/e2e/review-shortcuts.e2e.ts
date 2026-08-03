// Review-verdict + chrome keyboard shortcuts. Approve (a), request changes (r),
// reject (shift+R, EXC-913), toggle compare/diff (d), open plan search (/,
// EXC-832), toggle the sidebar (\), and open settings (,) are all wired through
// the shortcut engine (EXC-786). These are real-browser keyboard behaviors — a
// keydown routed through the global dispatcher into the same guarded path a click
// takes — so they live here, not in a unit (browser-testing.md). Every action is
// driven with a REAL keystroke.
//
// waitPastSafeModeGrace is mandatory before the first key press: a key inside the
// post-mount grace window is swallowed by Safe Mode (safeMode.ts).

import type { Page } from "@playwright/test";

import { expect, test, waitPastSafeModeGrace } from "@test/e2e/support/fixtures.ts";

// Two headings so the contents pane (ToC) renders (toc.ts § shouldShowToc needs
// >= 2), giving the `/` shortcut a filter to focus.
const filler = (label: string) =>
  Array.from({ length: 6 }, (_, i) => `${label} body line ${i + 1}.`).join("\n\n");
const PLAN = ["# Alpha", filler("Alpha"), "## Bravo", filler("Bravo"), ""].join("\n\n");

// The `b` specs need a trail with real siblings to walk, so each section must be
// taller than the viewport — otherwise the whole plan stays in view and jumping
// never changes the heading being read (the shape plan-breadcrumbs.e2e.ts uses).
// Exactly one `#`: the daemon demotes every later top-level heading, so the
// siblings the menu offers are the `##` level. Echo is there only so Delta is not
// the last section — the plan scrolls barely past its own end, so a jump to the
// final heading clamps short and tracking stays on the section above it.
const tall = (label: string) =>
  Array.from(
    { length: 30 },
    (_, i) => `${label} detail line ${i + 1} keeps this section tall.`,
  ).join("\n");
const NESTED_PLAN = [
  "# Alpha",
  tall("Alpha"),
  "## Bravo",
  tall("Bravo"),
  "## Charlie",
  tall("Charlie"),
  "## Delta",
  tall("Delta"),
  "## Echo",
  tall("Echo"),
  "",
].join("\n\n");

async function loadPlan(page: Page): Promise<void> {
  await expect(page.locator(".diff-plan")).toBeVisible();
  await waitPastSafeModeGrace(page);
}

test("a opens the approve guard (never a raw approve) and Escape dismisses it", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: PLAN });
  await page.goto("/");
  await loadPlan(page);

  // The Approve button advertises its shortcut for a11y.
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toHaveAttribute(
    "aria-keyshortcuts",
    "a",
  );

  // `a` routes through the unsent-comments guard — the same "Approve this plan?"
  // confirmation the button opens, never a straight resolve.
  const confirm = page.getByRole("dialog", { name: "Approve this plan?" });
  await expect(confirm).toBeHidden();
  await page.keyboard.press("a");
  await expect(confirm).toBeVisible();

  // The review is still pending — the guard has not resolved anything.
  await page.keyboard.press("Escape");
  await expect(confirm).toBeHidden();
  await expect(page.locator(".diff-plan")).toBeVisible();
});

test("r opens the request-changes dialog", async ({ daemon, page }) => {
  await daemon.seed({ plan: PLAN });
  await page.goto("/");
  await loadPlan(page);

  await expect(page.getByRole("button", { name: "Request changes" })).toHaveAttribute(
    "aria-keyshortcuts",
    "r",
  );

  const dialog = page.getByRole("dialog", { name: "Send the plan back for revision" });
  await expect(dialog).toBeHidden();
  await page.keyboard.press("r");
  await expect(dialog).toBeVisible();
});

test("shift+R opens the reject guard and Escape dismisses it", async ({ daemon, page }) => {
  await daemon.seed({ plan: PLAN });
  await page.goto("/");
  await loadPlan(page);

  await expect(page.getByRole("button", { name: "Reject", exact: true })).toHaveAttribute(
    "aria-keyshortcuts",
    "Shift+R",
  );

  // Shift+R routes through onReject's confirm — the same alertdialog the button
  // opens, never a raw deny. Resolution behavior is covered by reject.e2e.ts.
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toBeHidden();
  await page.keyboard.press("R");
  await expect(confirm).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(confirm).toBeHidden();
  await expect(page.locator(".diff-plan")).toBeVisible();
});

test("comma opens Settings even with no active review; a, r and shift+R no-op there", async ({
  page,
}) => {
  // No review seeded — the empty state, where the review actions are inert but
  // Settings (persistent chrome) stays reachable.
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "No plans awaiting review" })).toBeVisible();
  await waitPastSafeModeGrace(page);

  await expect(page.getByRole("button", { name: "Settings" })).toHaveAttribute(
    "aria-keyshortcuts",
    ",",
  );

  // The review-verdict keys do nothing without a review.
  await page.keyboard.press("a");
  await page.keyboard.press("r");
  await page.keyboard.press("R");
  await expect(page.getByRole("dialog", { name: "Approve this plan?" })).toBeHidden();
  await expect(page.getByRole("dialog", { name: "Send the plan back for revision" })).toBeHidden();
  await expect(page.getByRole("alertdialog")).toBeHidden();

  // Settings opens regardless.
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings).toBeHidden();
  await page.keyboard.press(",");
  await expect(settings).toBeVisible();
});

test("d toggles the compare/diff view when there are multiple versions", async ({
  daemon,
  page,
}) => {
  await daemon.seedVersions(2, [
    `# Alpha\n\n${filler("alpha")}\n`,
    `# Alpha\n\n${filler("beta")}\n`,
  ]);
  await page.goto("/");
  await loadPlan(page);

  const toggle = page.getByRole("button", { name: "Compare versions" });
  await expect(toggle).toHaveAttribute("aria-keyshortcuts", "d");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");

  // `d` enters compare mode…
  await page.keyboard.press("d");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  // …and `d` again leaves it.
  await page.keyboard.press("d");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
});

test("slash opens the plan search, not the contents filter (EXC-832)", async ({ daemon, page }) => {
  await daemon.seed({ plan: PLAN });
  await page.goto("/");
  await loadPlan(page);

  // EXC-832 repurposed / from focusing the ToC filter (EXC-789) to opening a vim-style
  // plan search; the filter keeps no keybinding now (parks EXC-793). The full search
  // flow lives in plan-search.e2e.ts — here we only pin the key's new owner.
  const filter = page.getByLabel("Filter headings");
  await expect(filter).not.toHaveAttribute("aria-keyshortcuts", "/");

  await page.keyboard.press("/");
  await expect(page.locator(".plan-search")).toBeVisible();
  await expect(filter).not.toBeFocused();
});

test("b opens the breadcrumbs bar, and j/j/Enter jumps to the highlighted heading", async ({
  daemon,
  page,
}) => {
  // EXC-947: the bar's own menus are covered in plan-breadcrumbs.e2e.ts; this pins
  // the key that summons them and the vim walk inside them.
  await daemon.seed({ plan: NESTED_PLAN });
  await page.goto("/");
  await loadPlan(page);

  // Read Bravo, so the trailing crumb's menu offers siblings worth walking.
  await page.locator(".source-toc").getByRole("button", { name: "Bravo", exact: true }).click();
  const crumbs = page.locator(".plan-breadcrumbs button.crumb");
  await expect(crumbs).toHaveText(["Alpha", "Bravo"]);
  await expect(crumbs.last()).toHaveAttribute("aria-keyshortcuts", "b");

  // `b` opens that crumb's menu with focus already on a row, so the first j moves
  // rather than being spent entering the list.
  await page.keyboard.press("b");
  const menu = page.locator("[data-slot='dropdown-menu-content']");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Bravo" })).toBeFocused();

  await page.keyboard.press("j");
  await page.keyboard.press("j");
  await expect(menu.getByRole("menuitem", { name: "Delta" })).toBeFocused();

  // Enter lands the plan where a mouse pick would: the trail and the URL's heading
  // mirror both report Delta.
  await page.keyboard.press("Enter");
  await expect(crumbs).toHaveText(["Alpha", "Delta"]);
  await expect.poll(() => new URL(page.url()).searchParams.get("heading")).toBe("delta");
});

test("Escape closes the breadcrumbs menu and hands focus back to the crumb", async ({
  daemon,
  page,
}) => {
  // The dismissal half of EXC-947: a keyboard close must not strand focus on
  // document.body, or the reviewer's next key goes nowhere.
  await daemon.seed({ plan: NESTED_PLAN });
  await page.goto("/");
  await loadPlan(page);

  const crumb = page.locator(".plan-breadcrumbs button.crumb.current");
  await page.keyboard.press("b");
  const menu = page.locator("[data-slot='dropdown-menu-content']");
  await expect(menu).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(crumb).toBeFocused();
});

test("backslash toggles the sidebar rail", async ({ daemon, page }) => {
  // EXC-830: `\` fires the same toggleToc the sidebar float-chip runs. The rail
  // collapses by animating its lane width to 0 (not display:none), so the state
  // reads off the toggle's aria-expanded plus the #plan-toc lane width — mirroring
  // toc-collapse.e2e.ts. The fixture viewport is wide, so the rail starts open.
  await daemon.seed({ plan: PLAN });
  await page.goto("/");
  await loadPlan(page);

  const toggle = page.getByRole("button", { name: "Toggle sidebar" });
  const rail = page.locator("#plan-toc");
  await expect(toggle).toHaveAttribute("aria-keyshortcuts", "\\");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(rail).not.toHaveCSS("width", "0px");

  // `\` collapses the rail…
  await page.keyboard.press("\\");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(rail).toHaveCSS("width", "0px");

  // …and `\` again reopens it.
  await page.keyboard.press("\\");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(rail).not.toHaveCSS("width", "0px");
});

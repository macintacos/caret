// Review-verdict + chrome keyboard shortcuts. Approve (a), request changes (r),
// toggle compare/diff (d), open plan search (/, EXC-832), toggle the sidebar (\),
// and open settings (,) are all wired through the shortcut engine (EXC-786). These are
// real-browser keyboard behaviors — a keydown routed through the global
// dispatcher into the same guarded path a click takes — so they live here, not
// in a unit (browser-testing.md). Every action is driven with a REAL keystroke.
//
// waitPastSafeModeGrace is mandatory before the first key press: a key inside the
// post-mount grace window is swallowed by Safe Mode (safeMode.ts).

import type { Page } from "@playwright/test";

import { expect, test, waitPastSafeModeGrace } from "./support/fixtures.ts";

// Two headings so the contents pane (ToC) renders (toc.ts § shouldShowToc needs
// >= 2), giving the `/` shortcut a filter to focus.
const filler = (label: string) =>
  Array.from({ length: 6 }, (_, i) => `${label} body line ${i + 1}.`).join("\n\n");
const PLAN = ["# Alpha", filler("Alpha"), "## Bravo", filler("Bravo"), ""].join("\n\n");

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

test("comma opens Settings even with no active review; a and r no-op there", async ({ page }) => {
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
  await expect(page.getByRole("dialog", { name: "Approve this plan?" })).toBeHidden();
  await expect(page.getByRole("dialog", { name: "Send the plan back for revision" })).toBeHidden();

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

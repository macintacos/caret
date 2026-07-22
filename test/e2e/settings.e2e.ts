// The two-pane Settings shell (EXC-843): a category sidebar + a registry-rendered
// pane + a float chip that stages edits and commits on Save. Navigation, staging
// without live-apply, the dirty chip/dots, save-stays-open + applies + persists,
// discard, ⌘↩, and Esc-dismiss are all real-browser behavior (focus, portalled
// menus, keyboard, localStorage across reload), so this lives here, not in a unit
// (per doc/agents/browser-testing.md). The theme pick uses a mouse CLICK on the
// portalled option, sidestepping the keyboard-focus race that quarantined the old
// live-preview picker (EXC-796).

import { expect, test, waitPastSafeModeGrace } from "./support/fixtures.ts";

const topbarHints = ".topbar [data-slot='kbd']";
const keyboardButton = "button[aria-label='Keyboard shortcuts']";

async function openSettings(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
}

test("opens two panes, navigates categories, and renders each pane's fields", async ({
  daemon,
  page,
}) => {
  await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();

  await openSettings(page);

  // Appearance is the default pane: the theme select + the shortcut-hints switch.
  await expect(page.locator("[data-category='Appearance']")).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("button", { name: "Theme" })).toBeVisible();
  await expect(page.getByRole("switch", { name: "Shortcut hints" })).toBeVisible();

  // Navigating to Diff view swaps the pane to its fields; the theme control is gone.
  await page.locator("[data-category='Diff view']").click();
  await expect(page.getByRole("button", { name: "Layout" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Change markers" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Theme" })).toBeHidden();

  // And back.
  await page.locator("[data-category='Appearance']").click();
  await expect(page.getByRole("button", { name: "Theme" })).toBeVisible();
});

test("edits stage without applying, dirty the chip + dots, then Save applies and persists", async ({
  daemon,
  page,
}) => {
  await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  // Fresh origin defaults to caret dark, hints on.
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(topbarHints).first()).toBeVisible();

  await openSettings(page);
  await expect(page.locator(".save-chip")).toBeHidden();

  // Pick a theme: stages it. The whole UI must NOT retint (no live apply this issue).
  await page.getByRole("button", { name: "Theme" }).click();
  await page.getByRole("menuitemradio", { name: "caret light" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  // Toggle shortcut hints off: stages it. The hint chrome stays put until Save.
  await page.getByRole("switch", { name: "Shortcut hints" }).click();
  await expect(page.locator(topbarHints).first()).toBeVisible();

  // The chip counts both changes; the changed fields and their category wear dots.
  const chip = page.locator(".save-chip");
  await expect(chip).toBeVisible();
  await expect(chip).toContainText("2 unsaved changes");
  await expect(page.locator("[data-field='theme'] .dirty-dot")).toBeVisible();
  await expect(page.locator("[data-category='Appearance'] .dirty-dot")).toBeVisible();

  // Save commits: the modal STAYS OPEN, both settings apply live, the chip clears,
  // and a success toast confirms it.
  await chip.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator(topbarHints)).toHaveCount(0);
  await expect(page.getByText("Settings saved")).toBeVisible();
  await expect(page.locator(".save-chip")).toBeHidden();

  // The choices persist across a reload (browser localStorage, no daemon state).
  await page.reload();
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator(keyboardButton)).toBeHidden();
});

test("Discard reverts the staged edits and hides the chip, applying nothing", async ({
  daemon,
  page,
}) => {
  await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await openSettings(page);
  await page.getByRole("button", { name: "Theme" }).click();
  await page.getByRole("menuitemradio", { name: "caret light" }).click();
  await expect(page.locator(".save-chip")).toBeVisible();

  await page.locator(".save-chip").getByRole("button", { name: "Discard" }).click();
  await expect(page.locator(".save-chip")).toBeHidden();
  await expect(page.locator("[data-field='theme'] .dirty-dot")).toHaveCount(0);
  // Nothing was applied — the theme stays dark.
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("⌘↩ saves the staged changes while a control has focus", async ({ daemon, page }) => {
  await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();

  await openSettings(page);
  await page.getByRole("switch", { name: "Shortcut hints" }).click();
  await expect(page.locator(".save-chip")).toBeVisible();

  // The switch keeps focus; the capture-phase listener still catches ⌘↩.
  await page.keyboard.press("Meta+Enter");
  await expect(page.getByText("Settings saved")).toBeVisible();
  await expect(page.locator(".save-chip")).toBeHidden();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
});

test("Esc on a dirty modal plainly discards and closes", async ({ daemon, page }) => {
  await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();

  await openSettings(page);
  await page.getByRole("button", { name: "Theme" }).click();
  await page.getByRole("menuitemradio", { name: "caret light" }).click();
  await expect(page.locator(".save-chip")).toBeVisible();

  await waitPastSafeModeGrace(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeHidden();
  // The staged edit was discarded, not applied.
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  // Reopening shows a clean modal — no stale staged change.
  await openSettings(page);
  await expect(page.locator(".save-chip")).toBeHidden();
});

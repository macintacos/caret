// The two-pane Settings shell (EXC-843): a category sidebar + a registry-rendered
// pane whose edits apply IMMEDIATELY — no staged draft, no Save/Discard. Picking a
// value writes it, retints/reflows the app live, and confirms with a bottom-right
// toast. Navigation, live apply, persistence across reload, and Esc-dismiss are all
// real-browser behavior (focus, portalled menus, keyboard, localStorage across
// reload), so this lives here, not in a unit (per doc/agents/browser-testing.md). The
// theme pick uses a mouse CLICK on the portalled option, sidestepping the
// keyboard-focus race that quarantined the old live-preview picker (EXC-796).

import { expect, test, waitPastSafeModeGrace } from "./support/fixtures.ts";

const topbarHints = ".topbar [data-slot='kbd']";
const keyboardButton = "button[aria-label='Keyboard shortcuts']";

async function openSettings(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
}

test("opens the Appearance pane with theme, hints, and the folded-in Diff view section", async ({
  daemon,
  page,
}) => {
  await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();

  await openSettings(page);

  // Appearance is the (only) pane; Diff view is now a section within it, not its own
  // nav row.
  await expect(page.locator("[data-category='Appearance']")).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.locator("[data-category='Diff view']")).toHaveCount(0);

  // Its controls all live in the one pane: theme, shortcut hints, and the diff prefs.
  await expect(page.getByRole("button", { name: "Theme" })).toBeVisible();
  await expect(page.getByRole("switch", { name: "Shortcut hints" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Layout" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Change markers" })).toBeVisible();

  // No staged-edit chrome — edits apply immediately.
  await expect(page.locator(".save-chip")).toHaveCount(0);
});

test("picking a theme applies it immediately, confirms with a toast, and persists", async ({
  daemon,
  page,
}) => {
  await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  // Fresh origin defaults to caret dark.
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await openSettings(page);

  // Pick caret light: the whole UI retints AT ONCE, with no Save step, and the modal
  // stays open. A success toast confirms it.
  await page.getByRole("button", { name: "Theme" }).click();
  await page.getByRole("menuitemradio", { name: "caret light" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await expect(page.getByText("Theme updated")).toBeVisible();

  // The choice persists across a reload (browser localStorage, no daemon state).
  await page.reload();
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("toggling shortcut hints applies immediately and persists", async ({ daemon, page }) => {
  await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.locator(topbarHints).first()).toBeVisible();

  await openSettings(page);

  // Toggle off: the hint chrome disappears live (no Save), and a toast confirms it.
  await page.getByRole("switch", { name: "Shortcut hints" }).click();
  await expect(page.locator(topbarHints)).toHaveCount(0);
  await expect(page.locator(keyboardButton)).toBeHidden();
  await expect(page.getByText("Shortcut hints updated")).toBeVisible();

  // Persists across a reload.
  await page.reload();
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.locator(keyboardButton)).toBeHidden();
});

test("Esc closes the settings modal", async ({ daemon, page }) => {
  await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();

  await openSettings(page);
  await waitPastSafeModeGrace(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeHidden();
});

// Shortcut-hints toggle (EXC-826). A Settings switch (default on) hides the
// vim-shortcut discoverability chrome — the status bar's keyboard button and the
// TopBar's inline key-cap hints — live and persistently. Toggling, persistence
// across a reload, and the ? keystroke are real-browser behavior
// (browser-testing.md), so this lives here, not in a unit. The --fresh reset is
// unit-covered (ui/src/lib/prefs.test.ts: SHORTCUT_HINTS_KEY is a KNOWN_PREF_KEY
// that clearKnownPrefs removes), like the theme pref.

import { expect, test, waitPastSafeModeGrace } from "./support/fixtures.ts";

const keyboardButton = "button[aria-label='Keyboard shortcuts']";
const topbarHints = ".topbar [data-slot='kbd']";

test("the Settings toggle hides the shortcut affordances live and persists", async ({
  daemon,
  page,
}) => {
  await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();

  // Default on: the keyboard button and the TopBar key-cap hints are shown.
  await expect(page.locator(keyboardButton)).toBeVisible();
  await expect(page.locator(topbarHints).first()).toBeVisible();

  // Open Settings; the switch reads on.
  await page.getByRole("button", { name: "Settings" }).click();
  const toggle = page.getByRole("switch", { name: "Shortcut hints" });
  await expect(toggle).toBeVisible();
  await expect(toggle).toBeChecked();

  // Toggling off hides both affordances live — no reload.
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(page.locator(keyboardButton)).toBeHidden();
  await expect(page.locator(topbarHints)).toHaveCount(0);

  // Toggling back on brings them straight back.
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(page.locator(keyboardButton)).toBeVisible();

  // Turn off again and reload: the choice persists (browser localStorage), so the
  // affordances stay hidden across the reload with no daemon state.
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await page.reload();
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.locator(keyboardButton)).toBeHidden();

  // Hiding the hint chrome must not strand the docs: ? still opens the help modal.
  await waitPastSafeModeGrace(page);
  await page.keyboard.press("?");
  await expect(page.locator("[data-slot='dialog-content']")).toBeVisible();
});

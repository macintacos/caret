// Shortcut-hints toggle (EXC-826, restaged by EXC-843). A Settings switch (default
// on) hides the vim-shortcut discoverability chrome — the status bar's keyboard
// button and the TopBar's inline key-cap hints. Under the immediate-apply shell the
// switch applies (live + persistently) the moment it's toggled — no Save. Toggling,
// live apply, persistence across a reload, and the ? keystroke are real-browser
// behavior (browser-testing.md), so this lives here, not in a unit. The --fresh
// reset is unit-covered (ui/src/lib/prefs.test.ts: SHORTCUT_HINTS_KEY is a
// KNOWN_PREF_KEY that clearKnownPrefs removes), like the theme pref.

import { expect, test, waitPastSafeModeGrace } from "@test/e2e/support/fixtures.ts";
import { planSurface } from "@test/e2e/support/source-view.ts";

const keyboardButton = "button[aria-label='Keyboard shortcuts']";
const topbarHints = ".topbar [data-slot='kbd']";
// The ⇧C cap the status-strip comment tally advertises (EXC-792).
const tallyKey = ".comments-toggle [data-slot='kbd']";

// A short multi-line plan so the cursor can move and enter V-mode.
const PLAN = ["# Alpha", "Alpha one.", "Alpha two.", "Alpha three.", ""].join("\n\n");

test("the Settings toggle hides the shortcut affordances live and persists", async ({
  daemon,
  page,
}) => {
  await daemon.seed();
  await page.goto("/");
  await planSurface(page);

  // Default on: the keyboard button, the TopBar key-cap hints, and the comment
  // tally's ⇧C cap are all shown.
  await expect(page.locator(keyboardButton)).toBeVisible();
  await expect(page.locator(topbarHints).first()).toBeVisible();
  await expect(page.locator(tallyKey).first()).toBeVisible();

  // Open Settings; the switch reads on.
  await page.getByRole("button", { name: "Settings" }).click();
  const toggle = page.getByRole("switch", { name: "Shortcut hints" });
  await expect(toggle).toBeVisible();
  await expect(toggle).toBeChecked();

  // Toggling off applies at once: the affordances hide live and a toast confirms it,
  // with the modal still open.
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(page.getByText("Shortcut hints updated")).toBeVisible();
  await expect(page.locator(keyboardButton)).toBeHidden();
  await expect(page.locator(topbarHints)).toHaveCount(0);
  await expect(page.locator(tallyKey)).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();

  // The choice persists across a reload (browser localStorage), so the affordances
  // stay hidden with no daemon state.
  await page.reload();
  await planSurface(page);
  await expect(page.locator(keyboardButton)).toBeHidden();

  // Hiding the hint chrome must not strand the docs: ? still opens the help modal.
  await waitPastSafeModeGrace(page);
  await page.keyboard.press("?");
  await expect(page.locator("[data-slot='dialog-content']")).toBeVisible();
});

test("with hints off, V-mode still selects lines but the hint chip stays hidden", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: PLAN });
  await page.goto("/");
  await planSurface(page);
  await expect(page.locator(".diffview [data-content] [data-line]").first()).toBeVisible();

  // Turn shortcut hints off (applies at once), then Esc to close so keystrokes reach
  // the plan.
  await page.getByRole("button", { name: "Settings" }).click();
  const toggle = page.getByRole("switch", { name: "Shortcut hints" });
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(page.getByText("Shortcut hints updated")).toBeVisible();
  // Past the safe-mode grace before Escape, or the dismiss keystroke is swallowed
  // and the modal stays open (the guard window re-arms on the toggle interaction).
  await waitPastSafeModeGrace(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeHidden();

  // Enter V-mode (gg → V → j): the shortcut itself is NOT gated, so the amber
  // selection band still spans two lines — but the "c comment · Esc cancel" chip
  // is suppressed because hints are off.
  await page.keyboard.press("g");
  await page.keyboard.press("g");
  await page.keyboard.press("V");
  await page.keyboard.press("j");
  await expect(
    page.locator(".diffview [data-content] [data-line][data-selected-line]"),
  ).toHaveCount(2);
  await expect(page.locator(".visual-hint")).toHaveCount(0);
});

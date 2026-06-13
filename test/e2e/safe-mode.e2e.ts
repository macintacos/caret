// Safe mode: a keystroke landing right after the view gains focus is treated
// as an accidental in-flight keypress — swallowed, with a visible toast, until
// the suppression window elapses.
//
// Deterministic trigger, no production hook needed: App.svelte re-arms the
// guard's grace window on every `window` focus event, so dispatching a
// synthetic focus event and typing immediately reproduces the race that real
// refocus timing makes flaky to drive headless. The 2s suppression window is
// absorbed by the auto-retrying toBeHidden (timeout > 2000) — no fixed sleeps.

import { expect, test } from "./support/fixtures.ts";

test("a keystroke right after refocus triggers safe mode, which then releases", async ({
  daemon,
  page,
}) => {
  await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();

  // Re-open the grace window, then type inside it.
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.keyboard.press("a");

  // The keystroke was swallowed and the toast announces the suppression.
  const toast = page.locator(".safe-mode-toast");
  await expect(toast).toBeVisible();
  await expect(toast).toContainText("Safe Mode");

  // Keys pressed while active stay swallowed (the toast persists)...
  await page.keyboard.press("b");
  await expect(toast).toBeVisible();

  // ...and the window releases on its own (2s duration + margin).
  await expect(toast).toBeHidden({ timeout: 3_500 });
});

// Safe mode: a keystroke landing right after the view gains focus is treated
// as an accidental in-flight keypress — swallowed, with a visible toast, until
// the suppression window elapses.
//
// Deterministic trigger, no production hook needed: App.svelte re-arms the
// guard's grace window on every `window` focus event, so dispatching a
// synthetic focus event and typing immediately reproduces the race that real
// refocus timing makes flaky to drive headless. The 2s suppression window is
// absorbed by the auto-retrying toHaveCount(0) — no fixed sleeps.
//
// The guard's logic is already a unit and stays one: ui/src/lib/safeMode.ts
// takes now / graceMs / durationMs, so safeMode.test.ts drives the grace
// boundary, the swallowing, re-arming and the auto-release on an injected clock
// with no waiting at all. What only a browser adds is the wiring around it —
// that App.svelte re-arms on a real `window` focus event, that a real keydown is
// the thing being swallowed, and that the toast paints and then leaves on its
// own — which is why this spec is deliberately one test rather than a re-run of
// the unit's twelve.

import { expect, test, waitPastSafeModeGrace } from "@test/e2e/support/fixtures.ts";
import { planSurface } from "@test/e2e/support/source-view.ts";

test("a keystroke right after refocus triggers safe mode, which then releases", async ({
  daemon,
  page,
}) => {
  await daemon.seed();
  await page.goto("/");
  await planSurface(page);

  // Spend the keyboard handover BEFORE the window this test is about is open.
  // The first key press after a navigation waits for the renderer to start
  // taking keys at all (fixtures.ts § awaitKeyboardReady) and proves it with a
  // keystroke of its own; left until the press below, both would land inside the
  // 300ms window rather than before it, and the guard would see the probe rather
  // than the `a`. Past the mount grace first, so the warming press cannot arm the
  // very guard this test means to arm deliberately.
  await waitPastSafeModeGrace(page);
  await page.keyboard.press("Shift");

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

  // ...and the window releases on its own (2s duration, inside the suite's
  // assertion budget).
  await expect(toast).toHaveCount(0);
});

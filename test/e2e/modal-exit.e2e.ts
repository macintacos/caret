// Modal exit presence (EXC-891). The host keeps a modal mounted while `open` is
// false so bits-ui can play its exit, then unmounts it once the exit reports done.
//
// This layer is e2e and cannot be anything else: happy-dom has no getAnimations,
// which is exactly what bits-ui's PresenceManager waits on — the hold this ticket
// introduces does not exist there at all, so a unit could only assert the gate's
// bookkeeping (modalPresence.test.ts already does). Whether a real exit runs, and
// whether the surface actually leaves afterwards, is browser behavior.

import { expect, test, waitPastSafeModeGrace } from "@test/e2e/support/fixtures.ts";

const settingsDialog = "[data-slot='dialog-content']";

// The resolved animationName of the next animationend on the dialog content,
// parked on window so the listener is registered BEFORE the close intent fires.
type ExitWindow = { __exitAnimation: Promise<string> };

async function openSettings(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
}

/** Resolve once nothing is animating on the dialog content — the enter has
 * finished. Not a sleep: it reads the same getAnimations the presence layer does,
 * so a listener registered after it cannot catch the enter's tail. */
async function waitForEnterToSettle(page: import("@playwright/test").Page) {
  await page.waitForFunction(
    (sel) => (document.querySelector(sel)?.getAnimations().length ?? 1) === 0,
    settingsDialog,
  );
}

test("closing a modal plays its exit before the surface leaves the DOM", async ({
  daemon,
  page,
}) => {
  await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await waitPastSafeModeGrace(page);

  await openSettings(page);
  await waitForEnterToSettle(page);

  // Register before the close intent: the exit is over in ~100ms, so a listener
  // attached after Escape would race the very event it is waiting on. Only a
  // self-targeted event counts — animationend BUBBLES, and a descendant inside
  // Settings (the theme pane's IN USE marker) animates on its own schedule, so an
  // unfiltered listener resolves with whichever fired first.
  await page.evaluate((sel) => {
    const content = document.querySelector(sel);
    (window as unknown as ExitWindow).__exitAnimation = new Promise<string>((resolve) => {
      content?.addEventListener("animationend", (e) => {
        if (e.target === content) resolve((e as AnimationEvent).animationName);
      });
    });
  }, settingsDialog);

  await page.keyboard.press("Escape");

  // tw-animate-css's --animate-out keyframe. Before this ticket the dialog's
  // animation classes keyed on an attribute bits-ui never sets, so nothing ran.
  const played = await page.evaluate(() => (window as unknown as ExitWindow).__exitAnimation);
  expect(played).toBe("exit");

  // …and the surface still leaves. A hold that never released would be worse than
  // no animation at all.
  await expect(page.locator(settingsDialog)).toHaveCount(0);
});

test("re-opening a modal mounts it fresh", async ({ daemon, page }) => {
  await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await waitPastSafeModeGrace(page);

  await openSettings(page);
  await page.keyboard.press("Escape");
  await expect(page.locator(settingsDialog)).toHaveCount(0);

  // The on-open focus behavior fires again — a surface left permanently mounted
  // would have run it only for the first open.
  await openSettings(page);
  const focusInDialog = await page.evaluate(
    (sel) => document.activeElement?.closest(sel) != null,
    settingsDialog,
  );
  expect(focusInDialog).toBe(true);
});

test("a modal still unmounts under reduced motion", async ({ daemon, page }) => {
  // The serious failure this guards: an animation the preference collapses to a
  // single frame whose completion never resolves would strand the surface in the
  // DOM forever, and this assertion times out rather than passing.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await waitPastSafeModeGrace(page);

  await openSettings(page);
  await page.keyboard.press("Escape");
  await expect(page.locator(settingsDialog)).toHaveCount(0);
});

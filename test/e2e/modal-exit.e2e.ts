// Modal exit presence (EXC-891). The host keeps a modal mounted while `open` is
// false so bits-ui can play its exit, then unmounts it once the exit reports done.
//
// This layer is e2e and cannot be anything else: happy-dom has no getAnimations,
// which is exactly what bits-ui's PresenceManager waits on — the hold this ticket
// introduces does not exist there at all, so a unit could only assert the gate's
// bookkeeping (modalPresence.test.ts already does). Whether a real exit runs, and
// whether the surface actually leaves afterwards, is browser behavior.

import { expect, test, waitPastSafeModeGrace } from "@test/e2e/support/fixtures.ts";
import { planSurface } from "@test/e2e/support/source-view.ts";

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
  await planSurface(page);
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
  // Asserted through LOCAL component state, not DOM presence: bits-ui removes the
  // content node on its own, so a count assertion would pass with or without the
  // gate. A surface the gate failed to renew would re-open carrying the previous
  // session's search query. Two mechanisms deliver this — the unmount on a
  // completed close, and the {#key} remount per open — and either alone suffices
  // here; the {#key}'s own case (re-opening mid-exit, where the unmount never
  // happens) is pinned in modalPresence.test.ts.
  await daemon.seed();
  await page.goto("/");
  await planSurface(page);
  await waitPastSafeModeGrace(page);

  await openSettings(page);
  const search = page.getByPlaceholder("Search settings…");
  await search.fill("theme");
  await expect(search).toHaveValue("theme");

  // Dismiss by backdrop, not Escape: Escape in the search clears the query first
  // (settings.e2e.ts), which would hide exactly the state under test.
  await page.mouse.click(5, 5);
  await expect(page.locator(settingsDialog)).toHaveCount(0);

  await openSettings(page);
  await expect(page.getByPlaceholder("Search settings…")).toHaveValue("");
});

test("a confirm guard unmounts too — the alertdialog branch of the shell", async ({
  daemon,
  page,
}) => {
  // Modal selects a different bits-ui primitive per `kind`, and every other case
  // here drives the Dialog half. This covers the alertdialog half closing cleanly
  // under the gate — the guards are the sites where `active` can go null mid-exit.
  const id = await daemon.seed();
  await daemon.putDraft(id, {
    annotations: [{ id: "ann-1", startLine: 7, endLine: 8, comment: "explain cold cost" }],
  });
  await page.goto("/");
  await planSurface(page);
  await waitPastSafeModeGrace(page);

  await page.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-slot='alert-dialog-content']")).toHaveCount(0);
});

test("a modal still unmounts under reduced motion", async ({ daemon, page }) => {
  // The serious failure this guards: an animation the preference collapses to a
  // single frame whose completion never resolves would strand the surface in the
  // DOM forever, and this assertion times out rather than passing.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await daemon.seed();
  await page.goto("/");
  await planSurface(page);
  await waitPastSafeModeGrace(page);

  await openSettings(page);
  await page.keyboard.press("Escape");
  await expect(page.locator(settingsDialog)).toHaveCount(0);
});

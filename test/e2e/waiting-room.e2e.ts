// The waiting screen's lit key: a press, or `^` typed anywhere on the screen, turns to the
// next carrot fact; offline the key's light goes out, it sits disabled, and the listening
// stamp says offline in the same live region.
//
// What needs a real browser: `^` is a real keystroke routed through the global dispatcher
// and its press echo; the tooltip is a portalled bits-ui popover; the offline swap is the
// 2s poll failing against a live daemon; and the legend's light and the key's travel are
// computed styles under real media emulation. The pure half (one fact per turn, the timer
// under reduced motion, the cue, the shortcut live only on this screen) is in
// ui/src/components/EmptyState.test.ts.
//
// waitPastSafeModeGrace is mandatory before the first key press: a key inside the
// post-mount grace window is swallowed by Safe Mode (safeMode.ts).

import type { Page } from "@playwright/test";

import { expect, test, waitPastSafeModeGrace } from "@test/e2e/support/fixtures.ts";

const key = (page: Page) => page.getByRole("button", { name: "Next carrot fact" });
const fact = (page: Page) => page.locator(".carrot-fact");
const stamp = (page: Page) => page.locator(".empty").getByRole("status");

async function openWaitingRoom(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "No plans awaiting review" })).toBeVisible();
  await expect(fact(page)).toBeVisible();
}

test("a press on the key shows the next carrot fact", async ({ page }) => {
  await openWaitingRoom(page);
  const first = await fact(page).textContent();
  await key(page).click();
  await expect(fact(page)).not.toHaveText(first ?? "");
});

test("typing ^ shows the next fact and plays the key's press", async ({ page }) => {
  await openWaitingRoom(page);
  await waitPastSafeModeGrace(page);
  // Recorded by an observer rather than polled: the press lasts one hold, shorter than a
  // loaded host's polling interval.
  await key(page).evaluate((el) => {
    const record = window as unknown as { pressed?: boolean };
    new MutationObserver(() => {
      if (el.hasAttribute("data-key-pressed")) record.pressed = true;
    }).observe(el, { attributes: true, attributeFilter: ["data-key-pressed"] });
  });
  const first = await fact(page).textContent();
  await page.keyboard.press("^");
  await expect(fact(page)).not.toHaveText(first ?? "");
  const pressed = await page.evaluate(() => (window as unknown as { pressed?: boolean }).pressed);
  expect(pressed).toBe(true);
});

test("the key names what it does in a tooltip", async ({ page }) => {
  await openWaitingRoom(page);
  await key(page).hover();
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText("Next carrot fact");
});

test("the key's legend is lit, and its glow breathes, while caret is listening", async ({
  page,
}) => {
  await openWaitingRoom(page);
  await expect(stamp(page)).toHaveText("listening");
  await expect(key(page).locator(".lit-core")).toHaveCSS("opacity", "1");
  await expect(key(page).locator(".lit-off")).toHaveCSS("opacity", "0");
  const breathing = await key(page)
    .locator(".lit-glow")
    .evaluate((el) => el.getAnimations().length);
  expect(breathing).toBe(1);
});

test("when the daemon drops, the light goes out, the key sits down, and the stamp says offline", async ({
  page,
}) => {
  await openWaitingRoom(page);
  const status = stamp(page);
  await expect(status).toHaveText("listening");
  await page.route("**/api/reviews", (route) => route.abort());
  // The same live region swaps its word, so a screen reader hears the drop.
  await expect(status).toHaveText("offline");
  await expect(key(page)).toBeDisabled();
  await expect(key(page).locator(".lit-core")).toHaveCSS("opacity", "0");
  await expect(key(page).locator(".lit-off")).toHaveCSS("opacity", "1");
  await expect(fact(page)).toHaveCount(0);
  await expect(page.getByText("Not connected to the caret daemon.")).toBeVisible();
});

// The key is the pane's only control, so a keyboard reader whose key disables under them
// keeps their place in the pane instead of falling back to the top of the page.
test("a key that goes offline under keyboard focus hands focus to the heading", async ({
  page,
}) => {
  await openWaitingRoom(page);
  await key(page).focus();
  await page.route("**/api/reviews", (route) => route.abort());
  await expect(key(page)).toBeDisabled();
  await expect(page.getByRole("heading", { name: "No plans awaiting review" })).toBeFocused();
});

test("under reduced motion the glow holds lit, and a press changes only the key's shading", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openWaitingRoom(page);
  const glow = key(page).locator(".lit-glow");
  const full = await glow.evaluate((el) =>
    Number(getComputedStyle(el).getPropertyValue("--lit-glow")),
  );
  expect(full).toBeGreaterThan(0);
  await expect.poll(() => glow.evaluate((el) => Number(getComputedStyle(el).opacity))).toBe(full);
  expect(await glow.evaluate((el) => el.getAnimations().length)).toBe(0);

  const face = () =>
    key(page).evaluate((el) => {
      const style = getComputedStyle(el);
      return { y: el.getBoundingClientRect().y, background: style.backgroundColor };
    });
  const rest = await face();
  const box = await key(page).boundingBox();
  if (box === null) throw new Error("the key has no box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // A transition, however short, is sampled on the frame clock, so read the press once
  // a frame has run.
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  const down = await face();
  await page.mouse.up();
  expect(down.y).toBe(rest.y);
  expect(down.background).not.toBe(rest.background);
});

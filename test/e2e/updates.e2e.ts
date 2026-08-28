// The update surface (EXC-1207): a once-per-version toast on load, the settings-gear
// dot, and the Settings dialog's Updates pane.
//
// What needs a real browser here is the toast card actually rendering and its button
// actually opening and switching a PORTALLED dialog, and `localStorage` suppressing the
// second toast across a real reload — none of which a mounted component models, and the
// third of which no unit can even stage. The verdict→copy mapping is pure and lives in
// `ui/src/lib/updates.test.ts`; the pane's own render, the rail badge, and the gear's
// aria-label are component units (`UpdatesPane.test.ts`, `SettingsDialog.test.ts`,
// `TopBar.test.ts`).
//
// The e2e daemon (`test/e2e/support/daemon-entry.ts`) answers `/api/update` with a quiet
// synthetic verdict, alongside the synthetic build identity it already serves — App reads
// that route on every load, so an unwired one would 404 into every other spec's page load
// and red `assets.e2e.ts`. A spec that needs a verdict of its own therefore fulfils the
// route in the page, the technique `images.e2e.ts` and `file-refs.e2e.ts` already use,
// rather than the fixture staging one nothing else wants.

import type { Page } from "@playwright/test";

import { expect, test } from "@test/e2e/support/fixtures.ts";
import { planSurface } from "@test/e2e/support/source-view.ts";

const AVAILABLE = "9.9.9";
const COMMAND = "bunx --no-cache @macintacos/caret@latest install --refresh";

/** Answer `GET /api/update` with a behind-release verdict, overriding the fixture
 * daemon's quiet one. Installed before the page loads, so the app's one load-time read
 * sees it. */
async function routeBehindRelease(page: Page): Promise<void> {
  await page.route("**/api/update", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        install: "binary",
        version: "0.0.1",
        commit: "abc1234",
        status: { kind: "behind-release", available: AVAILABLE, command: COMMAND },
      }),
    }),
  );
}

/** Answer `GET /api/prefs` with the check turned OFF, leaving the POST half to reach the
 * real daemon so a write still round-trips. */
async function routeCheckOff(page: Page): Promise<void> {
  await page.route("**/api/prefs", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ approveMode: "default", updates: { check: false } }),
        })
      : route.fallback(),
  );
}

const toast = (page: Page) => page.locator(".alert-item", { hasText: "Update available" });
const markedGear = (page: Page) =>
  page.getByRole("button", { name: "Settings — update available" });

test("a pending update toasts on load and dots the settings gear", async ({ daemon, page }) => {
  await daemon.seed();
  await routeBehindRelease(page);
  await page.goto("/");
  await planSurface(page);

  await expect(toast(page)).toBeVisible();
  await expect(toast(page)).toContainText(AVAILABLE);
  // The gear's state is announced, not only painted.
  await expect(markedGear(page)).toBeVisible();
});

test("the toast's action opens Settings on the Updates pane, carrying the command", async ({
  daemon,
  page,
}) => {
  await daemon.seed();
  await routeBehindRelease(page);
  await page.goto("/");
  await planSurface(page);

  await toast(page).getByRole("button", { name: "View" }).click();

  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog).toBeVisible();
  await expect(page.locator("[data-category='Updates']")).toHaveAttribute("aria-current", "page");

  // The pane states the verdict and offers the exact command — the whole reason the
  // daemon puts `command` on the wire rather than letting the browser derive one.
  await expect(page.locator("[data-updates-pane] .update-headline")).toContainText(AVAILABLE);
  await expect(page.locator("[data-updates-pane] .update-command")).toHaveText(COMMAND);
  // And the toggle sits beneath it — the pane does not replace the category's fields.
  await expect(page.getByRole("switch", { name: "Check for updates" })).toBeVisible();
});

test("the opt-out silences a pending verdict — no toast, no marks", async ({ daemon, page }) => {
  // The gate the whole design rests on. The daemon settles its verdict at boot and holds
  // it for its whole life, so a reviewer who turns the check off is still SERVED
  // `behind-release` — the browser is the only place that can honour the opt-out.
  //
  // This is also the regression guard for the load race: the two reads are settled
  // together precisely so the verdict cannot arrive first and toast against the
  // still-default gate, burning that version's once-per-version marker on the way past.
  await daemon.seed();
  await routeBehindRelease(page);
  await routeCheckOff(page);
  await page.goto("/");
  await planSurface(page);

  await expect(markedGear(page)).toHaveCount(0);
  await expect(toast(page)).toHaveCount(0);

  // The marker was not spent either: turning the check back on must still toast this
  // version. Proven by reloading with the opt-out lifted.
  await page.unroute("**/api/prefs");
  await page.reload();
  await planSurface(page);
  await expect(toast(page)).toBeVisible();
});

test("flipping the toggle off clears the marks without a reload", async ({ daemon, page }) => {
  await daemon.seed();
  await routeBehindRelease(page);
  await page.goto("/");
  await planSurface(page);
  await expect(markedGear(page)).toBeVisible();

  await markedGear(page).click();
  await page.locator("[data-category='Updates']").click();
  await page.getByRole("switch", { name: "Check for updates" }).click();

  // App mirrors the accepted write rather than re-reading a daemon-owned value, so the
  // badges clear on the spot.
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
  await expect(markedGear(page)).toHaveCount(0);
  await expect(page.locator("[data-slot='sidebar-menu-badge']")).toHaveCount(0);
});

test("the fixture daemon answers the update route with a quiet verdict", async ({
  daemon,
  page,
}) => {
  // No stub here, deliberately. App reads /api/update on EVERY load, so a route that
  // 404s would put a failed same-origin request into every other spec's load — which is
  // what `assets.e2e.ts` exists to catch. The fixture answers with the honest verdict for
  // a from-source daemon, so the read succeeds and nothing is marked.
  await daemon.seed();
  await page.goto("/");
  await planSurface(page);

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.locator("[data-category='Updates']").click();

  // A real verdict, not the "could not be read" placeholder.
  await expect(page.locator("[data-updates-pane] .update-headline")).toBeVisible();
  await expect(page.locator("[data-updates-pane] .update-placeholder")).toHaveCount(0);
  // And quiet: nothing pending, so no command and no mark on the gear.
  await expect(page.locator("[data-updates-pane] .update-command")).toHaveCount(0);
  await expect(markedGear(page)).toHaveCount(0);
});

test("a reload does not re-toast the same version", async ({ daemon, page }) => {
  // The once-per-version marker is `localStorage`, so proving it takes a real origin
  // surviving a real navigation — the reason this case cannot be a unit.
  await daemon.seed();
  await routeBehindRelease(page);
  await page.goto("/");
  await planSurface(page);
  await expect(toast(page)).toBeVisible();

  await page.reload();
  await planSurface(page);

  // The gear still marks the pending update — the verdict has not changed, only the
  // nudge is spent. Asserting the mark first is what bounds the absence below: it proves
  // the report landed on this load, so a missing toast means suppressed rather than
  // not-yet-arrived.
  await expect(markedGear(page)).toBeVisible();
  await expect(toast(page)).toHaveCount(0);
});

// The settings Advanced pane (EXC-848): read-only, copyable diagnostics blocks
// for the running build, daemon liveness, system, and the parsed config. The
// values come from /api/health and /api/diagnostics — real browser fetch, plus the
// clipboard a copy writes and the layout that decides whether a block can wrap — so
// this is real-browser behavior, not a unit (per doc/agents/browser-testing.md). The block VALUES are the
// synthetic build identity + diagnostics wired in support/daemon-entry.ts; the two
// are kept in sync deliberately.

import { openSettings } from "@test/e2e/support/chrome.ts";
import { expect, test } from "@test/e2e/support/fixtures.ts";
import { planSurface } from "@test/e2e/support/source-view.ts";

async function openAdvanced(page: import("@playwright/test").Page) {
  const dialog = await openSettings(page);
  await page.locator("[data-category='Advanced']").click();
  await expect(dialog.getByRole("heading", { name: "Advanced" })).toBeVisible();
}

test("renders the diagnostics blocks and copies one to the clipboard", async ({ daemon, page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await daemon.seed();
  await page.goto("/");
  await planSurface(page);

  await openAdvanced(page);
  const pane = page.locator("[data-advanced-pane]");

  // VERSION comes from /api/health (build + commit are the synthetic identity).
  const version = pane.locator("[data-diag='version'] .diag-text");
  await expect(version).toContainText("caret");
  await expect(version).toContainText("build e2e-build");
  await expect(version).toContainText("commit e2ecomm");

  // DAEMON is live (the diagnostics probe answered), with the configured port and
  // humanized uptime; SYSTEM and CONFIG come from the same document.
  await expect(pane.locator("[data-diag='daemon'] .diag-text")).toHaveText(
    "live · port 42718 · up 2h 14m",
  );
  await expect(pane.locator("[data-diag='daemon'] .diag-dot")).toHaveAttribute("data-live", "true");
  await expect(pane.locator("[data-diag='system'] .diag-text")).toHaveText(
    "darwin (arm64) · bun 0.0.0",
  );
  await expect(pane.locator("[data-diag='config'] .diag-path")).toContainText("config.toml");
  await expect(pane.locator("[data-diag='config'] .diag-text")).toContainText("[daemon]");
  await expect(pane.locator("[data-diag='config'] .diag-text")).toContainText("port = 42718");

  // A block copies in place: its copy cap writes the block's text and confirms on itself.
  const daemonBlock = pane.locator("[data-diag='daemon']");
  await daemonBlock.getByRole("button", { name: "Copy Daemon" }).click();
  await expect(daemonBlock.getByRole("button", { name: "Copied Daemon" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "live · port 42718 · up 2h 14m",
  );
});

test("a block offers to wrap only once its value overflows, and wrapping fits it", async ({
  daemon,
  page,
}) => {
  await daemon.seed();
  await page.goto("/");
  await planSurface(page);

  await openAdvanced(page);
  const pane = page.locator("[data-advanced-pane]");
  const version = pane.locator("[data-diag='version']");
  await expect(version.locator(".diag-text")).toContainText("caret");
  // At a desktop width every value fits its block, so none offers to wrap.
  await expect(pane.getByRole("button", { name: /^Wrap long lines/ })).toHaveCount(0);

  // A phone-width modal pushes the version past its block's edge.
  await page.setViewportSize({ width: 390, height: 800 });
  const wrap = version.getByRole("button", { name: "Wrap long lines in Version" });
  await expect(wrap).toBeVisible();
  await wrap.click();
  await expect(wrap).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() => version.locator("pre").evaluate((pre) => pre.scrollWidth <= pre.clientWidth))
    .toBe(true);
});

test("degrades daemon/system/config per-block when diagnostics fails; version survives", async ({
  daemon,
  page,
}) => {
  await daemon.seed();
  // Fail only the diagnostics probe — health (VERSION) is untouched.
  await page.route("**/api/diagnostics", (route) => route.abort());
  await page.goto("/");
  await planSurface(page);

  await openAdvanced(page);
  const pane = page.locator("[data-advanced-pane]");

  // Health-sourced, so VERSION still renders.
  await expect(pane.locator("[data-diag='version'] .diag-text")).toContainText("caret");
  // The diagnostics-sourced blocks each degrade to a placeholder.
  await expect(pane.locator("[data-diag='daemon'] .diag-text")).toHaveText("Unavailable");
  await expect(pane.locator("[data-diag='system'] .diag-text")).toHaveText("Unavailable");
  await expect(pane.locator("[data-diag='config'] .diag-text")).toHaveText("Unavailable");
  // The live dot is muted and a degraded block offers no copy affordance.
  await expect(pane.locator("[data-diag='daemon'] .diag-dot")).toHaveAttribute(
    "data-live",
    "false",
  );
  await expect(pane.locator("[data-diag='system']").getByRole("button")).toHaveCount(0);
});

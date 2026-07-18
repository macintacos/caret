// Short/narrow-viewport dialog fit (EXC-813): the shared shadcn modal shell
// (dialog-content / alert-dialog-content) must cap its height to the viewport
// and scroll vertically when the content is taller — instead of clipping at the
// top and bottom with no way to reach the off-screen parts. RequestChangesDialog
// already did this for itself in .rcd-content; this proves the shared shell does
// it for EVERY modal (here SettingsDialog, which composes the bare shell). Real
// scroll + layout geometry is browser behavior, so this is an e2e, not a unit
// (per doc/agents/browser-testing.md).

import { expect, test } from "./support/fixtures.ts";

test("a tall dialog is height-capped to the viewport and scrolls instead of clipping", async ({
  daemon,
  page,
}) => {
  await daemon.seed();
  // A short viewport forces even the compact Settings dialog past the available
  // height, so the cap has to engage. Width stays wide (≥ --w-narrow, 960px) so
  // the Settings gear is a direct top-bar control, not consolidated into an
  // overflow menu at narrow widths.
  await page.setViewportSize({ width: 1000, height: 140 });
  await page.goto("/");

  await page.getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog).toBeVisible();

  const geom = await dialog.evaluate((el) => ({
    top: el.getBoundingClientRect().top,
    bottom: el.getBoundingClientRect().bottom,
    innerHeight: window.innerHeight,
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }));

  // The dialog stays within the viewport (with the shell's inset) — not clipped
  // off either edge.
  expect(geom.top).toBeGreaterThanOrEqual(0);
  expect(geom.bottom).toBeLessThanOrEqual(geom.innerHeight);
  // Its content is genuinely taller than the capped box, so the cap is doing
  // work and the overflow is reachable by scrolling rather than clipped away.
  expect(geom.scrollHeight).toBeGreaterThan(geom.clientHeight);
});

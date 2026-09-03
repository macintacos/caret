// Short/narrow-viewport dialog fit (EXC-813): the shared shadcn modal shell
// (dialog-content / alert-dialog-content) must cap its height to the viewport
// and scroll vertically when the content is taller — instead of clipping at the
// top and bottom with no way to reach the off-screen parts. RequestChangesDialog
// already did this for itself in .rcd-content; this proves the shared shell does
// it for EVERY modal (here SettingsDialog, which composes the bare shell). Real
// scroll + layout geometry is browser behavior, so this is an e2e, not a unit
// (per doc/agents/browser-testing.md).

import { openSettings } from "@test/e2e/support/chrome.ts";
import { openRejectGuard } from "@test/e2e/support/decision.ts";
import { expect, test, waitPastSafeModeGrace } from "@test/e2e/support/fixtures.ts";
import { planSurface } from "@test/e2e/support/source-view.ts";

// Read the geometry that proves a modal is capped, not clipped: its box stays
// within the viewport AND its content is taller than the box (so the cap is
// doing work and the overflow scrolls rather than clipping away).
async function readFit(locator: import("@playwright/test").Locator) {
  return locator.evaluate((el) => ({
    top: el.getBoundingClientRect().top,
    bottom: el.getBoundingClientRect().bottom,
    innerHeight: window.innerHeight,
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }));
}

function expectCappedAndScrolling(geom: {
  top: number;
  bottom: number;
  innerHeight: number;
  scrollHeight: number;
  clientHeight: number;
}) {
  // Within the viewport (with the shell's inset) — not clipped off either edge.
  expect(geom.top).toBeGreaterThanOrEqual(0);
  expect(geom.bottom).toBeLessThanOrEqual(geom.innerHeight);
  // Genuinely taller than the capped box — the overflow is reachable by
  // scrolling, not clipped.
  expect(geom.scrollHeight).toBeGreaterThan(geom.clientHeight);
}

// Both shells are exercised: the Dialog shell (dialog-content.svelte) via
// Settings, and the AlertDialog shell (alert-dialog-content.svelte) via the
// Reject guard — a distinct bits-ui primitive, so "same fix" is verified, not
// assumed. Width stays wide (≥ --w-narrow, 960px) so the top-bar control is a
// direct button, isolating height-clipping from narrow-width topbar
// consolidation (EXC-810).

test("a tall dialog is height-capped to the viewport and scrolls instead of clipping", async ({
  daemon,
  page,
}) => {
  await daemon.seed();
  // A short viewport forces even the compact Settings dialog past the available
  // height, so the cap has to engage.
  await page.setViewportSize({ width: 1000, height: 140 });
  await page.goto("/");

  const dialog = await openSettings(page);
  expectCappedAndScrolling(await readFit(dialog));
});

test("a tall alert-dialog is height-capped to the viewport and scrolls instead of clipping", async ({
  daemon,
  page,
}) => {
  const id = await daemon.seed();
  // Several pending comments make the Reject guard (an alertdialog) tall.
  await daemon.putDraft(id, {
    annotations: Array.from({ length: 8 }, (_, i) => ({
      id: `ann-${i}`,
      startLine: 7,
      endLine: 8,
      comment: `pending comment ${i}`,
    })),
  });
  await page.setViewportSize({ width: 1000, height: 160 });
  await page.goto("/");
  await planSurface(page);
  await waitPastSafeModeGrace(page);

  // Reject with pending comments opens the confirmation guard (UnsentCommentsDialog
  // kind="confirm" → AlertDialog shell), previewing the comments that won't be sent.
  const guard = await openRejectGuard(page);

  expectCappedAndScrolling(await readFit(guard));
});

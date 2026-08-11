// Bottom status bar layout (EXC-787, supersedes EXC-812's bottom-right corner
// de-collision). The build/version + review-status segments and the keyboard ?
// affordance now live in one full-width bottom bar that reserves space (a .shell
// grid row), so the plan content ends above it and the CommentNavigator docks
// above it — there is no longer a crowded corner where the strip has to yield.
//
// Layout and positioning are real-browser concerns (browser-testing.md), so this
// asserts on visibility + bounding-box geometry, not a component unit.

import { commentNavigator, commentTally } from "@test/e2e/support/chrome.ts";
import { expect, test, waitPastSafeModeGrace } from "@test/e2e/support/fixtures.ts";
import { PLAN_SURFACE, planSurface } from "@test/e2e/support/source-view.ts";

// A right-docked 21rem card is at most this wide; the full-bleed sheet is wider.
const CARD_MAX_PX = 21 * 16 + 4; // 21rem + rounding headroom
// The pinned elements inset ~0.7rem (11.2px) from the viewport edge.
const EDGE_INSET_PX = 16;

test("the status bar spans full width, reserves space, and holds the segments", async ({
  daemon,
  page,
}) => {
  await daemon.seed();
  await page.goto("/");
  await planSurface(page);
  await waitPastSafeModeGrace(page);

  const bar = page.getByRole("contentinfo", { name: "Status bar" });
  await expect(bar).toBeVisible();

  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  const barBox = await bar.boundingBox();
  expect(barBox).not.toBeNull();
  // Full-width, edge to edge, pinned to the bottom.
  expect(barBox!.x).toBeLessThanOrEqual(1);
  expect(barBox!.width).toBeGreaterThanOrEqual(viewport!.width - 1);
  expect(barBox!.y + barBox!.height).toBeGreaterThanOrEqual(viewport!.height - 1);

  // Reserves space: the plan's scroll area ends at (or above) the bar's top edge,
  // rather than the bar overlaying the last lines.
  const planBox = await page.locator(PLAN_SURFACE).boundingBox();
  expect(planBox).not.toBeNull();
  expect(planBox!.y + planBox!.height).toBeLessThanOrEqual(barBox!.y + 1);

  // The version + review-status segments and the keyboard affordance sit inside
  // the bar (vertically within its band).
  for (const sel of [
    ".version-badge",
    ".status-strip",
    "button[aria-label='Keyboard shortcuts']",
  ]) {
    const seg = await page.locator(sel).boundingBox();
    expect(seg).not.toBeNull();
    expect(seg!.y).toBeGreaterThanOrEqual(barBox!.y - 1);
    expect(seg!.y + seg!.height).toBeLessThanOrEqual(barBox!.y + barBox!.height + 1);
  }
});

test("the comment navigator opens from the bar tally and docks above the bar", async ({
  daemon,
  page,
}) => {
  const id = await daemon.seed();
  await daemon.putDraft(id, {
    annotations: [{ id: "ann-1", startLine: 7, endLine: 7, comment: "warm cache path" }],
  });
  await page.goto("/");
  await planSurface(page);
  await waitPastSafeModeGrace(page);

  const bar = page.getByRole("contentinfo", { name: "Status bar" });
  const nav = commentNavigator(page);

  // The comment tally lives in the bar's status strip and toggles the navigator.
  await commentTally(page).click();
  await expect(nav).toBeVisible();

  // The navigator docks ABOVE the bar — the two don't overlap.
  const barBox = await bar.boundingBox();
  const navBox = await nav.boundingBox();
  expect(barBox).not.toBeNull();
  expect(navBox).not.toBeNull();
  expect(navBox!.y + navBox!.height).toBeLessThanOrEqual(barBox!.y + 1);

  // Escape closes the navigator; the bar stays.
  await page.keyboard.press("Escape");
  await expect(nav).toHaveCount(0);
  await expect(bar).toBeVisible();
});

test("at narrow width the navigator widens to a full-bleed sheet above the bar", async ({
  daemon,
  page,
}) => {
  const id = await daemon.seed();
  await daemon.putDraft(id, {
    annotations: [{ id: "ann-1", startLine: 7, endLine: 7, comment: "warm cache path" }],
  });
  await page.setViewportSize({ width: 500, height: 900 });
  await page.goto("/");
  await planSurface(page);
  await waitPastSafeModeGrace(page);

  const nav = commentNavigator(page);
  await commentTally(page).click();
  await expect(nav).toBeVisible();

  const navBox = await nav.boundingBox();
  expect(navBox).not.toBeNull();
  // A full-bleed bottom sheet: left edge at the ~0.7rem inset, wider than a card.
  expect(navBox!.x).toBeLessThanOrEqual(EDGE_INSET_PX);
  expect(navBox!.width).toBeGreaterThan(CARD_MAX_PX);
  // Still docks above the full-width bar.
  const barBox = await page.getByRole("contentinfo", { name: "Status bar" }).boundingBox();
  expect(barBox).not.toBeNull();
  expect(navBox!.y + navBox!.height).toBeLessThanOrEqual(barBox!.y + 1);
});

test("at wide width the navigator stays a right-docked card above the bar", async ({
  daemon,
  page,
}) => {
  const id = await daemon.seed();
  await daemon.putDraft(id, {
    annotations: [{ id: "ann-1", startLine: 7, endLine: 7, comment: "warm cache path" }],
  });
  // The default fixture viewport is wide, so none of the narrow-width rules apply.
  await page.goto("/");
  await planSurface(page);
  await waitPastSafeModeGrace(page);

  const nav = commentNavigator(page);
  await commentTally(page).click();
  await expect(nav).toBeVisible();

  const navBox = await nav.boundingBox();
  expect(navBox).not.toBeNull();
  expect(navBox!.width).toBeLessThanOrEqual(CARD_MAX_PX);
  expect(navBox!.x).toBeGreaterThan(CARD_MAX_PX);
});

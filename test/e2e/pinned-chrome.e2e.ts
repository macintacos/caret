// Pinned chrome de-collides at narrow widths (EXC-812, parent EXC-770). The three
// viewport-pinned elements — VersionBadge (bottom-left), StatusStrip (bottom-right,
// with the comment tally that toggles the navigator), and CommentNavigator (docked
// above the strip) — are each position: fixed to the viewport, so at narrow widths
// they crowd. At/below --w-tight (640) the strip YIELDS while the navigator is open
// (the navigator's header already carries the count + close, so the tally-toggle is
// redundant), and the navigator widens to a full-bleed bottom sheet; the badge sits
// clear below it. Wide widths keep the strip visible and the navigator right-docked.
//
// Positioning is a real-browser concern (browser-testing.md), so this is an e2e
// asserting on visibility plus bounding-box non-overlap, not a component unit.

import { expect, test, waitPastSafeModeGrace } from "./support/fixtures.ts";

// A right-docked 21rem card is at most this wide; the full-bleed sheet is wider.
const CARD_MAX_PX = 21 * 16 + 4; // 21rem + rounding headroom
// The pinned elements inset ~0.7rem (11.2px) from the viewport edge.
const EDGE_INSET_PX = 16;

test("at narrow width the strip yields to the open navigator and the badge stays clear", async ({
  daemon,
  page,
}) => {
  const id = await daemon.seed();
  await daemon.putDraft(id, {
    annotations: [
      { id: "ann-1", startLine: 7, endLine: 7, comment: "warm cache path" },
      { id: "ann-2", startLine: 13, endLine: 13, comment: "verify sidecar replay" },
    ],
  });
  await page.setViewportSize({ width: 500, height: 900 });
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await waitPastSafeModeGrace(page);

  const strip = page.locator(".status-strip");
  const nav = page.locator(".comment-navigator");
  const badge = page.locator(".version-badge");

  // The strip is visible while closed; opening the navigator hides it — the yield.
  await expect(strip).toBeVisible();
  await page.locator("button.comments-toggle").click();
  await expect(nav).toBeVisible();
  await expect(strip).toBeHidden();

  // The navigator is a full-bleed sheet: its left edge sits at the ~0.7rem inset.
  const navBox = await nav.boundingBox();
  expect(navBox).not.toBeNull();
  expect(navBox!.x).toBeLessThanOrEqual(EDGE_INSET_PX);
  expect(navBox!.width).toBeGreaterThan(CARD_MAX_PX);

  // The sheet clears the VersionBadge — the two live pinned elements don't overlap.
  const badgeBox = await badge.boundingBox();
  expect(badgeBox).not.toBeNull();
  const overlap =
    navBox!.x < badgeBox!.x + badgeBox!.width &&
    badgeBox!.x < navBox!.x + navBox!.width &&
    navBox!.y < badgeBox!.y + badgeBox!.height &&
    badgeBox!.y < navBox!.y + navBox!.height;
  expect(overlap).toBe(false);

  // Escape closes the navigator and the strip returns — its info stays reachable.
  await page.keyboard.press("Escape");
  await expect(nav).toBeHidden();
  await expect(strip).toBeVisible();
});

test("at wide width the strip stays visible with the navigator open and the panel is right-docked", async ({
  daemon,
  page,
}) => {
  const id = await daemon.seed();
  await daemon.putDraft(id, {
    annotations: [{ id: "ann-1", startLine: 7, endLine: 7, comment: "warm cache path" }],
  });
  // The default fixture viewport is wide (REFERENCE_WIDTH_PX + headroom), so none
  // of the narrow-width rules apply.
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await waitPastSafeModeGrace(page);

  const strip = page.locator(".status-strip");
  const nav = page.locator(".comment-navigator");

  await page.locator("button.comments-toggle").click();
  await expect(nav).toBeVisible();
  // Wide-width unchanged: the strip stays visible alongside the open navigator...
  await expect(strip).toBeVisible();
  // ...and the navigator stays a right-docked card, not a full-bleed sheet.
  const navBox = await nav.boundingBox();
  expect(navBox).not.toBeNull();
  expect(navBox!.width).toBeLessThanOrEqual(CARD_MAX_PX);
  expect(navBox!.x).toBeGreaterThan(CARD_MAX_PX);
});

// The comment navigator, keyboard-driven (EXC-792). Shift+C summons it and moves
// focus into the list; j/k walk the rows, Enter reveals the focused comment while
// the panel stays open, "/" jumps to the search field, and Esc dismisses. While
// the panel holds focus it captures the keyboard, so the plan's own j/k don't also
// move the plan cursor. Real-browser focus/keyboard behavior, so it lives here
// rather than in a unit (browser-testing.md); every gesture is a REAL keystroke.
//
// waitPastSafeModeGrace is mandatory before the first key press — a key inside the
// post-mount grace window is swallowed by Safe Mode. Shift+C is pressed as the
// uppercase "C" (Playwright emits key="C"); a lowercase "c" is the comment-line
// shortcut instead (the case-sensitive matcher keeps the two distinct).

import type { Page } from "@playwright/test";

import { expect, test, waitPastSafeModeGrace } from "@test/e2e/support/fixtures.ts";
import { planSurface } from "@test/e2e/support/source-view.ts";

// The focused plan-cursor marker (SourceView tags the focused row data-caret-cursor;
// Playwright's CSS engine pierces the library's open shadow root).
const cursor = (page: Page) =>
  page.locator(".diffview [data-content] [data-line][data-caret-cursor]");

// Two committed inline comments on distinct lines with distinct text — the rows
// the keyboard walks.
const ANNOTATIONS = [
  { id: "ann-1", startLine: 7, endLine: 7, comment: "warm the cache path" },
  { id: "ann-2", startLine: 13, endLine: 13, comment: "verify the sidecar replay" },
];

test("Shift+C summons the navigator, focuses the list, and advertises its shortcut", async ({
  daemon,
  page,
}) => {
  const id = await daemon.seed();
  await daemon.putDraft(id, { annotations: ANNOTATIONS });
  await page.goto("/");
  await planSurface(page);
  await expect(page.locator(".diffview [data-content] [data-line]").first()).toBeVisible();
  await waitPastSafeModeGrace(page);

  const nav = page.getByRole("complementary", { name: "Comments" });
  const toggle = page.getByRole("button", { name: /^\d+ comments?$/ });
  await expect(toggle).toHaveAttribute("aria-keyshortcuts", "Shift+C");
  await expect(nav).toBeHidden();

  // Shift+C opens it and drops focus on the first row, so j/k work immediately.
  await page.keyboard.press("C");
  await expect(nav).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(nav.getByRole("listitem").getByRole("button").first()).toBeFocused();

  // Space reveals the focused comment (native button activation, like Enter) and
  // keeps the panel open.
  await page.keyboard.press("Space");
  await expect(page.locator('[data-annotation-card="ann-1"]')).toHaveClass(/focused/);
  await expect(nav).toBeVisible();

  // Esc dismisses (the documented close; a toggle-close via Shift+C is captured
  // while the panel holds focus, so Esc is the way out) and returns focus to the
  // summon tally (WAI-ARIA dismissable pattern).
  await page.keyboard.press("Escape");
  await expect(nav).toBeHidden();
  await expect(toggle).toBeFocused();
});

test("j/k walk the rows; Enter reveals without dismissing; / drops into search", async ({
  daemon,
  page,
}) => {
  const id = await daemon.seed();
  await daemon.putDraft(id, { annotations: ANNOTATIONS });
  await page.goto("/");
  await planSurface(page);
  await expect(page.locator(".diffview [data-content] [data-line]").first()).toBeVisible();
  await waitPastSafeModeGrace(page);

  const nav = page.getByRole("complementary", { name: "Comments" });
  const items = nav.getByRole("listitem").getByRole("button");

  await page.keyboard.press("C");
  await expect(items.first()).toBeFocused();
  // j moves the roving focus down a row.
  await page.keyboard.press("j");
  await expect(items.nth(1)).toBeFocused();

  // Enter reveals the focused comment — the source card highlights — and the
  // navigator stays open with the row marked active (focus never leaves it).
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-annotation-card="ann-2"]')).toHaveClass(/focused/);
  await expect(nav).toBeVisible();
  await expect(nav.locator('[aria-current="true"]')).toContainText("verify the sidecar replay");

  // "/" jumps into the search field; filtering narrows the list; Enter hands
  // focus back to the (filtered) list so j/k resume.
  const search = nav.getByRole("textbox", { name: "Search comments" });
  await page.keyboard.press("/");
  await expect(search).toBeFocused();
  await search.fill("warm");
  await expect(items).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(items.first()).toBeFocused();
  await expect(items.first()).toContainText("warm the cache path");
});

test("the navigator captures j/k, so the plan cursor stays put while it holds focus", async ({
  daemon,
  page,
}) => {
  const id = await daemon.seed();
  await daemon.putDraft(id, { annotations: ANNOTATIONS });
  await page.goto("/");
  await planSurface(page);
  await expect(page.locator(".diffview [data-content] [data-line]").first()).toBeVisible();
  await waitPastSafeModeGrace(page);

  const nav = page.getByRole("complementary", { name: "Comments" });
  const items = nav.getByRole("listitem").getByRole("button");
  await expect(cursor(page)).toHaveCount(0);

  // Open the navigator and walk it with j — the plan must NOT gain a cursor.
  await page.keyboard.press("C");
  await expect(items.first()).toBeFocused();
  await page.keyboard.press("j");
  await page.keyboard.press("j");
  await expect(items.nth(1)).toBeFocused();
  await expect(cursor(page)).toHaveCount(0);

  // Closing hands the keyboard back: the same j now drives the plan cursor.
  await page.keyboard.press("Escape");
  await expect(nav).toBeHidden();
  await page.keyboard.press("j");
  await expect(cursor(page)).toHaveCount(1);
});

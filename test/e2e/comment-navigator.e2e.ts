// The comment navigator: the status strip's comment tally opens a searchable,
// pinned index of the plan's inline comments. Searching filters the list by the
// comment text, and clicking an entry scrolls the plan to that comment and
// focuses (highlights) its card. Escape dismisses the panel.

import { expect, test, waitPastSafeModeGrace } from "./support/fixtures.ts";

test("opens from the status strip, filters by comment text, and reveals a comment", async ({
  daemon,
  page,
}) => {
  const id = await daemon.seed();
  // Two inline comments on different lines with distinct text, so the search can
  // single one out and the reveal has a specific card to focus.
  await daemon.putDraft(id, {
    annotations: [
      { id: "ann-1", startLine: 7, endLine: 7, comment: "warm the cache path" },
      { id: "ann-2", startLine: 13, endLine: 13, comment: "verify the sidecar replay" },
    ],
  });
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await waitPastSafeModeGrace(page);

  // The tally reads two comments and is the navigator's toggle.
  const toggle = page.locator("button.comments-toggle");
  await expect(toggle).toContainText("2");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");

  const nav = page.locator(".comment-navigator");
  await expect(nav).toBeHidden();
  await toggle.click();
  await expect(nav).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");

  // Both comments listed, in document order (line 7 before line 13).
  const items = nav.locator(".nav-item");
  await expect(items).toHaveCount(2);
  await expect(items.first()).toContainText("warm the cache path");

  // Search filters by comment text: "sidecar" appears only in the second comment.
  await nav.getByRole("textbox", { name: "Search comments" }).fill("sidecar");
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText("verify the sidecar replay");

  // Clicking the surviving entry reveals its comment — the source card focuses
  // (highlights + expands) and the navigator marks it current.
  await items.first().click();
  await expect(page.locator('[data-annotation-card="ann-2"]')).toHaveClass(/focused/);
  await expect(nav.locator(".nav-item.active")).toContainText("verify the sidecar replay");

  // Escape dismisses the panel.
  await page.keyboard.press("Escape");
  await expect(nav).toBeHidden();
});

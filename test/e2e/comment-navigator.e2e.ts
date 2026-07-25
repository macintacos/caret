// The comment navigator: the status strip's comment tally opens a searchable,
// pinned index of the plan's inline comments and unsent drafts. Searching filters
// the list by the comment text and underlines the matched substring live; unsent
// scratches show as distinct "draft" rows. Clicking any row scrolls the plan to it
// (and focuses/highlights a committed comment's card). Escape dismisses the panel.

import { expect, test, waitPastSafeModeGrace } from "@test/e2e/support/fixtures.ts";

test("opens from the strip, filters + underlines by text, and reveals comments and drafts", async ({
  daemon,
  page,
}) => {
  const id = await daemon.seed();
  // Two committed inline comments plus one unsent composer scratch (a draft), on
  // distinct lines with distinct text.
  await daemon.putDraft(id, {
    annotations: [
      { id: "ann-1", startLine: 7, endLine: 7, comment: "warm the cache path" },
      { id: "ann-2", startLine: 13, endLine: 13, comment: "verify the sidecar replay" },
    ],
    composerScratches: [{ startLine: 20, endLine: 20, text: "an unsent thought to finish later" }],
  });
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await waitPastSafeModeGrace(page);

  // The tally counts comments + drafts and toggles the navigator.
  const toggle = page.locator("button.comments-toggle");
  await expect(toggle).toContainText("3");
  const nav = page.locator(".comment-navigator");
  await expect(nav).toBeHidden();
  await toggle.click();
  await expect(nav).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");

  const items = nav.locator(".nav-item");
  await expect(items).toHaveCount(3);

  // The unsent scratch is a distinct draft row (tag + text).
  const draft = nav.locator(".nav-item.draft");
  await expect(draft).toHaveCount(1);
  await expect(draft).toContainText("draft");
  await expect(draft).toContainText("an unsent thought to finish later");

  // Search filters by comment text and underlines the match ("sidecar" is only in
  // the second comment).
  const search = nav.getByRole("textbox", { name: "Search comments" });
  await search.fill("sidecar");
  await expect(items).toHaveCount(1);
  await expect(items.first().locator(".nav-match")).toHaveText("sidecar");
  await expect(items.first()).toContainText("verify the sidecar replay");

  // Clicking a committed comment reveals it — the source card focuses (highlights).
  await items.first().click();
  await expect(page.locator('[data-annotation-card="ann-2"]')).toHaveClass(/focused/);
  await expect(nav.locator(".nav-item.active")).toContainText("verify the sidecar replay");

  // A draft reveals the same way (the row goes active); clear the search to see it.
  await search.fill("");
  await nav.locator(".nav-item.draft").click();
  await expect(nav.locator(".nav-item.active.draft")).toContainText("an unsent thought");

  // Escape dismisses the panel.
  await page.keyboard.press("Escape");
  await expect(nav).toBeHidden();
});

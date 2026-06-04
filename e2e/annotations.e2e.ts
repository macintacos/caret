// Annotations: selecting plan text opens the comment popover; a submitted
// comment lands in the annotation gutter; the draft autosaves (debounced
// PUT /draft) and survives a reload.
//
// Selection technique: a programmatic Range + a dispatched bubbling mouseup —
// not a pixel-math mouse drag. PlanView's onmouseup runs captureSelection(),
// which only requires a non-collapsed selection inside a `b{n}` block when the
// mouseup fires, so this drives the real listener path deterministically.

import { expect, test, waitPastSafeModeGrace } from "./support/fixtures.ts";

const TARGET_TEXT = "warm copy of each manifest";
const COMMENT = "Quantify the warm-up cost here.";

test("selection opens the popover; the comment lands, autosaves, and survives reload", async ({
  daemon,
  page,
}) => {
  const id = await daemon.seed();
  await page.goto("/");
  await expect(page.locator("article.plan h1")).toBeVisible();
  await waitPastSafeModeGrace(page);

  // Select TARGET_TEXT inside its structural block and fire mouseup on it.
  const selected = await page.evaluate((needle) => {
    const article = document.querySelector("article.plan");
    if (!article) return false;
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode as Text;
      const idx = text.data.indexOf(needle);
      if (idx === -1) continue;
      const range = document.createRange();
      range.setStart(text, idx);
      range.setEnd(text, idx + needle.length);
      const sel = window.getSelection();
      const host = text.parentElement;
      if (!sel || !host) return false;
      sel.removeAllRanges();
      sel.addRange(range);
      host.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      return true;
    }
    return false;
  }, TARGET_TEXT);
  expect(selected).toBe(true);

  // The popover trigger appears near the selection; open it and comment.
  const popover = page.getByRole("dialog", { name: "Add a comment" });
  await popover.getByRole("button", { name: "Comment" }).click();
  await popover.locator("textarea").fill(COMMENT);

  // Arm the autosave listener BEFORE submitting: confirming the comment
  // schedules the debounced (500ms) PUT /draft, and awaiting the response —
  // rather than sleeping — proves the flush landed.
  // Match on route alone (not r.ok()) so a non-2xx fails fast on the assert
  // below instead of stalling out the waitForResponse timeout.
  const saved = page.waitForResponse(
    (r) => r.url().includes(`/api/reviews/${id}/draft`) && r.request().method() === "PUT",
  );
  await page.keyboard.press("ControlOrMeta+Enter");

  // The highlight mark and the gutter card carry the comment.
  await expect(page.locator("mark[data-annotation]").first()).toBeVisible();
  const card = page.locator("[data-annotation-card]");
  await expect(card).toBeVisible();
  await expect(card.getByText(COMMENT)).toBeVisible();

  expect((await saved).ok()).toBe(true);

  // The draft survives a reload: the annotation comes back from the daemon.
  await page.reload();
  await expect(page.locator("mark[data-annotation]").first()).toBeVisible();
  await expect(page.locator("[data-annotation-card]").getByText(COMMENT)).toBeVisible();
});

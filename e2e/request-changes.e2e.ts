// Request changes: the dialog opens, Escape closes it, Cmd/Ctrl+Enter submits,
// and the review resolves as a rejection CARRYING the typed feedback — asserted
// daemon-side via GET /api/reviews/:id (a deny keeps the review in memory as
// `rejected` with the decision riding on it), not just by UI disappearance.

import { expect, test, waitPastSafeModeGrace } from "./support/fixtures.ts";

const FEEDBACK = "Please tighten the verification section.";

test("dialog opens, Escape closes, Cmd/Ctrl+Enter submits a rejection with feedback", async ({
  daemon,
  page,
}) => {
  const id = await daemon.seed();
  await page.goto("/");
  await expect(page.locator("article.plan h1")).toBeVisible();
  await waitPastSafeModeGrace(page);

  const dialog = page.getByRole("dialog", { name: "Request changes" });

  // Open → Escape closes. Anchor on the autofocused textarea before pressing so
  // the key event reliably originates inside the dialog.
  await page.getByRole("button", { name: "Request changes" }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("textarea")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // Reopen → type feedback → Cmd/Ctrl+Enter submits.
  await page.getByRole("button", { name: "Request changes" }).click();
  await expect(dialog).toBeVisible();
  await dialog.locator("textarea").fill(FEEDBACK);
  await page.keyboard.press("ControlOrMeta+Enter");

  // UI: the review leaves the pending set.
  await expect(page.getByRole("heading", { name: "No plans awaiting review" })).toBeVisible();

  // API: rejected, and the decision carries the feedback text.
  await expect
    .poll(async () => (await daemon.getReview(id)).body?.decision?.behavior)
    .toBe("deny");
  const review = (await daemon.getReview(id)).body;
  expect(review?.status).toBe("rejected");
  expect(review?.decision?.feedback).toContain(FEEDBACK);
});

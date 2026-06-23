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
  await expect(page.locator(".diff-plan")).toBeVisible();
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
  await expect.poll(async () => (await daemon.getReview(id)).body?.decision?.behavior).toBe("deny");
  const review = (await daemon.getReview(id)).body;
  expect(review?.status).toBe("rejected");
  expect(review?.decision?.feedback).toContain(FEEDBACK);
});

test("a line-anchored annotation reaches Decision.feedback as a line reference plus an abbreviated quote", async ({
  daemon,
  page,
}) => {
  const id = await daemon.seed();
  // Seed a line-anchored annotation on lines 7-8 of the fixture plan, the same
  // way the UI's autosave would, before the page loads its working copy.
  await daemon.putDraft(id, {
    annotations: [{ id: "ann-1", startLine: 7, endLine: 8, comment: "explain the cold cost" }],
  });

  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await waitPastSafeModeGrace(page);

  // Open the dialog and submit with no general comment — the seeded annotation
  // alone produces feedback, so the deny button is enabled.
  const dialog = page.getByRole("dialog", { name: "Request changes" });
  await page.getByRole("button", { name: "Request changes" }).click();
  await expect(dialog).toBeVisible();
  // The preview already shows the new format the agent will receive — the line
  // reference and the abbreviated quote, identical to the sent feedback.
  await expect(dialog.locator(".preview pre")).toContainText("Lines 7-8:");
  await expect(dialog.locator(".preview pre")).toContainText("The cache layer … full cold cost.");
  await dialog.getByRole("button", { name: "Send for revision" }).click();

  await expect(page.getByRole("heading", { name: "No plans awaiting review" })).toBeVisible();

  // The new format reached Decision.feedback: a line reference AND an
  // abbreviated quote (first/last few words around an ellipsis), so the agent
  // can locate the feedback by content without the full selection's token cost.
  await expect.poll(async () => (await daemon.getReview(id)).body?.decision?.behavior).toBe("deny");
  const feedback = (await daemon.getReview(id)).body?.decision?.feedback ?? "";
  expect(feedback).toContain("Lines 7-8:");
  expect(feedback).toContain("> The cache layer … full cold cost.");
  expect(feedback).toContain("explain the cold cost");
});

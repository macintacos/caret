// Reject (EXC-685): a one-click verdict that denies the plan with a concise
// canned "rejected — wait for the user" message and NO inline comments. Like
// approve, when inline work is queued it first routes through the shared guard
// so composed comments are never silently dropped. Asserted daemon-side via
// GET /api/reviews/:id (a deny keeps the review as `rejected` with the decision
// riding on it), not just by UI disappearance.
//
// That daemon read is the layer choice: what these tests prove is that the deny
// survived a real HTTP round-trip into the daemon's own retained review, which
// no mounted component can be handed as props. The browser half is the guard's
// deliberately asymmetric dismissal — Escape closes it, a backdrop click does
// not — driven as real gestures. The pure halves stay units: the guard's reject
// vocabulary, count and preview rows in
// ui/src/components/UnsentCommentsDialog.test.ts, and the canned
// reject-and-wait body (including that it never carries the queued inline
// comments) in ui/src/state/resolve.test.ts.

import { expect, test, waitPastSafeModeGrace } from "@test/e2e/support/fixtures.ts";
import { planSurface } from "@test/e2e/support/source-view.ts";

test("rejecting resolves the review as a deny carrying the wait message", async ({
  daemon,
  page,
}) => {
  const id = await daemon.seed();
  await page.goto("/");
  await planSurface(page);

  // Reject always confirms (EXC-685), even with nothing queued: the top-bar
  // button opens a plain "are you sure?" dialog — no "won't be sent" warning.
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toBeVisible();
  await expect(confirm).not.toContainText("won't be sent");
  await confirm.getByRole("button", { name: "Reject", exact: true }).click();

  // UI: the review leaves the pending set.
  await expect(page.getByRole("heading", { name: "No plans awaiting review" })).toBeVisible();

  // API: rejected, and the decision carries only the concise reject-and-wait
  // message (no reviewer prose).
  await expect.poll(async () => (await daemon.getReview(id)).body?.decision?.behavior).toBe("deny");
  const review = (await daemon.getReview(id)).body;
  expect(review?.status).toBe("rejected");
  const feedback = review?.decision?.feedback ?? "";
  expect(feedback).toContain("rejected");
  expect(feedback.toLowerCase()).toContain("wait");
});

test("a pending inline comment guards reject; 'Reject anyway' sends only the wait message", async ({
  daemon,
  page,
}) => {
  const id = await daemon.seed();
  // Seed a non-blank inline comment the same way the UI's autosave would.
  await daemon.putDraft(id, {
    annotations: [{ id: "ann-1", startLine: 7, endLine: 8, comment: "explain cold cost" }],
  });

  await page.goto("/");
  await planSurface(page);
  await waitPastSafeModeGrace(page);

  // Reject now opens the confirmation naming the count — it does NOT resolve.
  const guard = page.getByRole("alertdialog");
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(guard).toBeVisible();
  await expect(guard).toContainText("1 pending comment");
  await expect.poll(async () => (await daemon.listReviews()).map((r) => r.id)).toContain(id);

  // "Reject anyway" resolves as a deny whose feedback is the canned message —
  // never the queued inline comment.
  await guard.getByRole("button", { name: "Reject anyway" }).click();
  await expect.poll(async () => (await daemon.getReview(id)).body?.decision?.behavior).toBe("deny");
  const feedback = (await daemon.getReview(id)).body?.decision?.feedback ?? "";
  expect(feedback).toContain("rejected");
  expect(feedback).not.toContain("explain cold cost");
});

test("Escape dismisses the reject guard and leaves the review pending", async ({
  daemon,
  page,
}) => {
  const id = await daemon.seed();
  await daemon.putDraft(id, {
    annotations: [{ id: "ann-1", startLine: 7, endLine: 8, comment: "explain cold cost" }],
  });

  await page.goto("/");
  await planSurface(page);
  await waitPastSafeModeGrace(page);

  const guard = page.getByRole("alertdialog");
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(guard).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(guard).toHaveCount(0);

  // The review is untouched.
  await expect.poll(async () => (await daemon.listReviews()).map((r) => r.id)).toContain(id);
});

test("a backdrop click does NOT dismiss the reject guard (deliberate verdict, EXC-685)", async ({
  daemon,
  page,
}) => {
  const id = await daemon.seed();
  await page.goto("/");
  await planSurface(page);

  await page.getByRole("button", { name: "Reject", exact: true }).click();
  const guard = page.getByRole("alertdialog");
  await expect(guard).toBeVisible();

  // Unlike the approve confirm (which dismisses on a click outside, EXC-791), a
  // reject is a deliberate verdict: an alertdialog whose backdrop does NOT dismiss.
  // The guard survives the outside click and still rejects — proof it stayed open.
  await page.mouse.click(5, 5);
  await expect(guard).toBeVisible();
  await expect.poll(async () => (await daemon.listReviews()).map((r) => r.id)).toContain(id);
  await guard.getByRole("button", { name: "Reject", exact: true }).click();
  await expect.poll(async () => (await daemon.getReview(id)).body?.decision?.behavior).toBe("deny");
});

// Approve: approving resolves the review — observable in the UI (the review
// leaves the pending set) and via the API (the list no longer carries it). With
// pending inline comments, approve first routes through a guard so the comments
// are never silently dropped.

import { expect, test, waitPastSafeModeGrace } from "./support/fixtures.ts";

test("approving resolves the review in UI and API", async ({ daemon, page }) => {
  const id = await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();

  // Primary approve button ("Approve" in the remembered default mode); exact
  // match so the split-toggle's "Approve options" doesn't collide.
  await page.getByRole("button", { name: "Approve", exact: true }).click();

  // UI: the pending set is empty.
  await expect(page.getByRole("heading", { name: "No plans awaiting review" })).toBeVisible();

  // API: GET /api/reviews no longer lists the id (an allow removes the review
  // from the pending set).
  await expect.poll(async () => (await daemon.listReviews()).map((r) => r.id)).not.toContain(id);
});

test("a pending inline comment guards approve and routes to request-changes intact", async ({
  daemon,
  page,
}) => {
  const id = await daemon.seed();
  // Seed a non-blank inline comment the same way the UI's autosave would.
  await daemon.putDraft(id, {
    annotations: [{ id: "ann-1", startLine: 7, endLine: 8, comment: "explain the cold cost" }],
  });

  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();

  // Approve now opens a confirmation naming the count — it does NOT resolve.
  const guard = page.getByRole("alertdialog");
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(guard).toBeVisible();
  await expect(guard).toContainText("1 pending comment");
  // The guard previews the inline comment, anchored to its lines.
  await expect(guard.locator(".comments")).toContainText("Lines 7–8");
  await expect(guard.locator(".comments")).toContainText("explain the cold cost");

  // The review is still pending: nothing was sent.
  await expect.poll(async () => (await daemon.listReviews()).map((r) => r.id)).toContain(id);

  // Routing to "Request changes" carries the seeded comment into that dialog.
  await guard.getByRole("button", { name: "Request changes" }).click();
  const dialog = page.getByRole("dialog", { name: "Send the plan back for revision" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".summary")).toContainText("1 comment");
  await expect(dialog.locator(".preview pre")).toContainText("explain the cold cost");

  // And sending it through reaches the agent as a deny carrying that comment —
  // proof the inline work was never lost.
  await dialog.getByRole("button", { name: "Send for revision" }).click();
  await expect.poll(async () => (await daemon.getReview(id)).body?.decision?.behavior).toBe("deny");
  const feedback = (await daemon.getReview(id)).body?.decision?.feedback ?? "";
  expect(feedback).toContain("explain the cold cost");
});

test("an uncommitted composer scratch guards approve (EXC-745)", async ({ daemon, page }) => {
  const id = await daemon.seed();
  // Seed a retained-but-unsent composer scratch the same way the UI's autosave
  // persists one: a reviewer who typed an inline comment but never clicked
  // "Comment", so it never became a committed annotation.
  await daemon.putDraft(id, {
    composerScratches: [{ startLine: 7, endLine: 8, text: "half a thought to finish later" }],
  });

  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  // The scratch rehydrated on load — its Resume marker is proof it reached the UI.
  await expect(page.getByRole("button", { name: "Resume unsent comment" })).toBeVisible();

  // Approve must open the guard, not resolve: an uncommitted scratch is unsent
  // inline work that a plain approve would silently drop.
  const guard = page.getByRole("alertdialog");
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(guard).toBeVisible();
  await expect(guard).toContainText("1 pending comment");

  // The review is still pending: nothing was sent, the scratch was not dropped.
  await expect.poll(async () => (await daemon.listReviews()).map((r) => r.id)).toContain(id);
});

test("a lone general-comment draft guards approve (EXC-742)", async ({ daemon, page }) => {
  const id = await daemon.seed();
  // Seed only the review-scoped general-comment draft — the "overall note" typed
  // into the Request Changes dialog and never sent. No inline comments, no
  // scratches: before EXC-742 this left pendingCount at 0 and approve resolved
  // straight through, silently dropping the draft.
  await daemon.putDraft(id, { generalCommentDraft: "reconsider the migration order" });

  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();

  // Approve must open the guard, not resolve: the unsent general comment is
  // feedback a plain approve would leave behind.
  const guard = page.getByRole("alertdialog");
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(guard).toBeVisible();
  await expect(guard).toContainText("1 pending comment");
  // The guard previews the draft itself under the General label.
  await expect(guard.locator(".comments")).toContainText("General");
  await expect(guard.locator(".comments")).toContainText("reconsider the migration order");

  // The review is still pending: nothing was sent.
  await expect.poll(async () => (await daemon.listReviews()).map((r) => r.id)).toContain(id);
});

test("'Approve anyway' on the guard resolves as an allow", async ({ daemon, page }) => {
  const id = await daemon.seed();
  await daemon.putDraft(id, {
    annotations: [{ id: "ann-1", startLine: 7, endLine: 8, comment: "explain the cold cost" }],
  });

  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();

  const guard = page.getByRole("alertdialog");
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(guard).toBeVisible();

  // Choosing the deliberate path approves with the allow payload unchanged.
  await guard.getByRole("button", { name: "Approve anyway" }).click();
  await expect(page.getByRole("heading", { name: "No plans awaiting review" })).toBeVisible();
  await expect.poll(async () => (await daemon.listReviews()).map((r) => r.id)).not.toContain(id);
});

test("Enter confirms the approve guard, resolving it as an allow", async ({ daemon, page }) => {
  const id = await daemon.seed();
  await daemon.putDraft(id, {
    annotations: [{ id: "ann-1", startLine: 7, endLine: 8, comment: "explain the cold cost" }],
  });

  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await waitPastSafeModeGrace(page);

  const guard = page.getByRole("alertdialog");
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(guard).toBeVisible();

  // The confirm action is focused on open, so a bare Enter activates it — the
  // same primary-path shortcut the hand-rolled guard offered (EXC-761).
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "No plans awaiting review" })).toBeVisible();
  await expect.poll(async () => (await daemon.listReviews()).map((r) => r.id)).not.toContain(id);
});

test("Escape dismisses the approve guard and leaves the review pending", async ({
  daemon,
  page,
}) => {
  const id = await daemon.seed();
  await daemon.putDraft(id, {
    annotations: [{ id: "ann-1", startLine: 7, endLine: 8, comment: "explain the cold cost" }],
  });

  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await waitPastSafeModeGrace(page);

  const guard = page.getByRole("alertdialog");
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(guard).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(guard).toBeHidden();

  // The review is untouched and the approve button still works.
  await expect.poll(async () => (await daemon.listReviews()).map((r) => r.id)).toContain(id);
});

test("Cancel dismisses the approve guard and leaves the review pending", async ({
  daemon,
  page,
}) => {
  const id = await daemon.seed();
  await daemon.putDraft(id, {
    annotations: [{ id: "ann-1", startLine: 7, endLine: 8, comment: "explain the cold cost" }],
  });

  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await waitPastSafeModeGrace(page);

  const guard = page.getByRole("alertdialog");
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(guard).toBeVisible();

  // The explicit Cancel button routes to onCancel (distinct from Escape) — it
  // closes the guard and sends nothing.
  await guard.getByRole("button", { name: "Cancel" }).click();
  await expect(guard).toBeHidden();
  await expect.poll(async () => (await daemon.listReviews()).map((r) => r.id)).toContain(id);
});

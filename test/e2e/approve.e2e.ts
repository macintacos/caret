// Approve: approving ALWAYS routes through an "are you sure?" confirmation
// (EXC-791) — even with nothing queued — observable in the UI (the review leaves
// the pending set) and via the API (the list no longer carries it). The confirm
// is a dismissible dialog: Enter confirms; Escape, the Cancel button, and a click
// outside all dismiss. With pending inline comments it additionally previews what
// a plain approve would silently drop.
//
// Everything here needs a real browser or the live daemon. The verdict is only
// observable over HTTP — GET /api/reviews/:id for the stored decision, and the
// pending list for the cases that must NOT resolve — which is daemon state no
// mounted component can be handed as props. The dismissal semantics are real
// gestures (Enter, Escape, a backdrop click at 5,5), and the footer check is a
// measured scrollWidth. The pure halves are units: the guard's own shaping — the
// pluralized count, the preview rows, the approve vocabulary, the notes field —
// in ui/src/components/UnsentCommentsDialog.test.ts, and the request body it
// submits, reviewer notes included, in ui/src/state/resolve.test.ts.

import { expect, test, waitPastSafeModeGrace } from "@test/e2e/support/fixtures.ts";
import { planSurface } from "@test/e2e/support/source-view.ts";

// The approve confirmation is a role="dialog" (dismissible on outside click,
// EXC-791) titled "Approve this plan?" — named so the locator never collides with
// the Request-changes dialog, which is also role="dialog".
const APPROVE_CONFIRM = { name: "Approve this plan?" } as const;

test("approving opens a confirmation and resolves on confirm (UI and API)", async ({
  daemon,
  page,
}) => {
  const id = await daemon.seed();
  await page.goto("/");
  await planSurface(page);

  // Approve no longer resolves straight through: it opens a bare "are you sure?"
  // confirm (nothing queued, so no pending-comment warning).
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  const confirm = page.getByRole("dialog", APPROVE_CONFIRM);
  await expect(confirm).toBeVisible();
  await expect(confirm).not.toContainText("won't be sent");
  // Still pending until confirmed.
  await expect.poll(async () => (await daemon.listReviews()).map((r) => r.id)).toContain(id);

  // Confirming resolves the review (the bare confirm button reads "Approve").
  await confirm.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByRole("heading", { name: "No plans awaiting review" })).toBeVisible();
  await expect.poll(async () => (await daemon.listReviews()).map((r) => r.id)).not.toContain(id);
});

test("Enter confirms the bare approve dialog", async ({ daemon, page }) => {
  const id = await daemon.seed();
  await page.goto("/");
  await planSurface(page);
  await waitPastSafeModeGrace(page);

  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByRole("dialog", APPROVE_CONFIRM)).toBeVisible();

  // The confirm action is focused on open, so a bare Enter activates it.
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "No plans awaiting review" })).toBeVisible();
  await expect.poll(async () => (await daemon.listReviews()).map((r) => r.id)).not.toContain(id);
});

test("a reviewer note rides the approval to the agent's decision (EXC-791)", async ({
  daemon,
  page,
}) => {
  const id = await daemon.seed();
  await page.goto("/");
  await planSurface(page);

  await page.getByRole("button", { name: "Approve", exact: true }).click();
  const confirm = page.getByRole("dialog", APPROVE_CONFIRM);
  await expect(confirm).toBeVisible();

  // Type into the optional notes field (a CodeMirror textbox, located by its
  // accessible name), then confirm.
  await confirm.getByRole("textbox", { name: /notes for the agent/i }).fill("use the retry helper");
  await confirm.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByRole("heading", { name: "No plans awaiting review" })).toBeVisible();

  // The decision the hook long-polls for carries the note as feedback — the wire
  // proof the note reached the agent side.
  await expect
    .poll(async () => {
      const res = await fetch(`${daemon.url}/api/reviews/${encodeURIComponent(id)}/decision`);
      return ((await res.json()) as { behavior: string; feedback?: string }).feedback;
    })
    .toBe("use the retry helper");
});

test("clicking outside dismisses the approve dialog and leaves the review pending", async ({
  daemon,
  page,
}) => {
  const id = await daemon.seed();
  await page.goto("/");
  await planSurface(page);

  await page.getByRole("button", { name: "Approve", exact: true }).click();
  const confirm = page.getByRole("dialog", APPROVE_CONFIRM);
  await expect(confirm).toBeVisible();

  // A click on the backdrop (top-left corner, off the centered panel) dismisses —
  // the approve confirm is a dialog, not an alertdialog (EXC-791).
  await page.mouse.click(5, 5);
  await expect(confirm).toHaveCount(0);
  await expect.poll(async () => (await daemon.listReviews()).map((r) => r.id)).toContain(id);
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
  await planSurface(page);

  // Approve opens a confirmation naming the count — it does NOT resolve.
  const guard = page.getByRole("dialog", APPROVE_CONFIRM);
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

test("the approve guard fits its three-button footer without a horizontal scrollbar", async ({
  daemon,
  page,
}) => {
  // With a pending comment the guard's footer carries three buttons (Cancel ·
  // Request changes · Approve anyway). At the shadcn Dialog default (max-w-sm,
  // 384px) they overflowed, and the shell's overflow-y-auto forces overflow-x to
  // compute to auto — so the surplus width became a horizontal scrollbar and the
  // modal read as clipped/cutout. The guard is widened (guard-content) so the row
  // fits; the invariant is that its content never scrolls horizontally. A layout
  // fact only the browser can decide, so this is an e2e (doc/agents/browser-testing.md).
  const id = await daemon.seed();
  await daemon.putDraft(id, {
    annotations: [{ id: "ann-1", startLine: 7, endLine: 8, comment: "explain the cold cost" }],
  });

  await page.goto("/");
  await planSurface(page);

  const guard = page.getByRole("dialog", APPROVE_CONFIRM);
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(guard).toBeVisible();
  // All three footer buttons are present — the overflow only occurs with the full row.
  await expect(guard.getByRole("button", { name: "Cancel" })).toBeVisible();
  await expect(guard.getByRole("button", { name: "Request changes" })).toBeVisible();
  await expect(guard.getByRole("button", { name: "Approve anyway" })).toBeVisible();

  // No horizontal overflow: scrollWidth never exceeds the visible box (1px slack for
  // sub-pixel rounding). Before the fix this was ~12px over.
  const overflow = await guard.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
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
  await planSurface(page);
  // The scratch rehydrated on load — its Resume marker is proof it reached the UI.
  await expect(page.getByRole("button", { name: "Resume unsent comment" })).toBeVisible();

  // Approve must open the guard, not resolve: an uncommitted scratch is unsent
  // inline work that a plain approve would silently drop.
  const guard = page.getByRole("dialog", APPROVE_CONFIRM);
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
  await planSurface(page);

  // Approve must open the guard, not resolve: the unsent general comment is
  // feedback a plain approve would leave behind.
  const guard = page.getByRole("dialog", APPROVE_CONFIRM);
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
  await planSurface(page);

  const guard = page.getByRole("dialog", APPROVE_CONFIRM);
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
  await planSurface(page);
  await waitPastSafeModeGrace(page);

  const guard = page.getByRole("dialog", APPROVE_CONFIRM);
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
  await planSurface(page);
  await waitPastSafeModeGrace(page);

  const guard = page.getByRole("dialog", APPROVE_CONFIRM);
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(guard).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(guard).toHaveCount(0);

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
  await planSurface(page);
  await waitPastSafeModeGrace(page);

  const guard = page.getByRole("dialog", APPROVE_CONFIRM);
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(guard).toBeVisible();

  // The explicit Cancel button routes to onCancel (distinct from Escape) — it
  // closes the guard and sends nothing.
  await guard.getByRole("button", { name: "Cancel" }).click();
  await expect(guard).toHaveCount(0);
  await expect.poll(async () => (await daemon.listReviews()).map((r) => r.id)).toContain(id);
});

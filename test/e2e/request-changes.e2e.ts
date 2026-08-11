// Request changes: the dialog opens, Escape closes it, Cmd/Ctrl+Enter submits,
// and the review resolves as a rejection CARRYING the typed feedback — asserted
// daemon-side via GET /api/reviews/:id (a deny keeps the review in memory as
// `rejected` with the decision riding on it), not just by UI disappearance.

import { discardConfirm, inlineRows, unsentRows } from "@test/e2e/support/chrome.ts";
import { expect, test, waitPastSafeModeGrace } from "@test/e2e/support/fixtures.ts";
import { planSurface } from "@test/e2e/support/source-view.ts";

const FEEDBACK = "Please tighten the verification section.";

test("dialog opens, Escape closes, Cmd/Ctrl+Enter submits a rejection with feedback", async ({
  daemon,
  page,
}) => {
  const id = await daemon.seed();
  await page.goto("/");
  await planSurface(page);
  await waitPastSafeModeGrace(page);

  const dialog = page.getByRole("dialog", { name: "Send the plan back for revision" });
  // The general comment is now the live-markdown editor (a CodeMirror textbox),
  // located by its accessible name.
  const editor = dialog.getByRole("textbox", { name: "General comment" });

  // Open → Escape closes. The editor autofocuses on open, so the Escape key
  // originates inside it (the editor wires Esc → onCancel to dismiss the dialog).
  await page.getByRole("button", { name: "Request changes" }).click();
  await expect(dialog).toBeVisible();
  await expect(editor).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // Reopen → type feedback → Cmd/Ctrl+Enter submits. fill() focuses the editor
  // and populates it (CodeMirror registers it), leaving focus there so the chord
  // lands inside the editor.
  await page.getByRole("button", { name: "Request changes" }).click();
  await expect(dialog).toBeVisible();
  await editor.fill(FEEDBACK);
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
  await planSurface(page);
  await waitPastSafeModeGrace(page);

  // Open the dialog and submit with no general comment — the seeded annotation
  // alone produces feedback, so the deny button is enabled.
  const dialog = page.getByRole("dialog", { name: "Send the plan back for revision" });
  await page.getByRole("button", { name: "Request changes" }).click();
  await expect(dialog).toBeVisible();
  // The preview shows the new format the agent will receive — the line reference
  // and the abbreviated quote, identical to the sent feedback. (Behind a collapsed
  // disclosure but still in the DOM, so its text is readable without expanding.)
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

test("a scratch's Save shows without expanding the row and graduates it into the sent feedback (EXC-746)", async ({
  daemon,
  page,
}) => {
  const id = await daemon.seed();
  // Seed a retained-but-unsent composer scratch (the reviewer typed an inline
  // comment but never clicked "Comment"), the same way the UI's autosave persists
  // one, before the page loads its working copy.
  await daemon.putDraft(id, {
    composerScratches: [{ startLine: 7, endLine: 8, text: "a half-typed thought" }],
  });

  await page.goto("/");
  await planSurface(page);
  await waitPastSafeModeGrace(page);

  const dialog = page.getByRole("dialog", { name: "Send the plan back for revision" });
  await page.getByRole("button", { name: "Request changes" }).click();
  await expect(dialog).toBeVisible();

  // The regression (EXC-746): the scratch's Save is visible WITHOUT expanding any
  // row. Before the fix it lived inside the collapsed disclosure body and was
  // hidden, so a reviewer could hit "Send for revision" and drop the draft never
  // having seen Save. A unit test can't catch this — happy-dom keeps the collapsed
  // disclosure's content mounted — so this real-Chromium visibility check is the guard.
  const save = unsentRows(dialog).getByRole("button", { name: "Save", exact: true });
  await expect(save).toBeVisible();

  // Saving graduates the scratch into a committed comment: the live preview now
  // quotes it (the deny button enables with it), and it reaches Decision.feedback.
  await save.click();
  await expect(dialog.locator(".preview pre")).toContainText("a half-typed thought");
  await dialog.getByRole("button", { name: "Send for revision" }).click();

  await expect(page.getByRole("heading", { name: "No plans awaiting review" })).toBeVisible();
  await expect.poll(async () => (await daemon.getReview(id)).body?.decision?.behavior).toBe("deny");
  const feedback = (await daemon.getReview(id)).body?.decision?.feedback ?? "";
  expect(feedback).toContain("a half-typed thought");
});

test("discarding an unsent comment asks to confirm before dropping it (EXC-762)", async ({
  daemon,
  page,
}) => {
  const id = await daemon.seed();
  await daemon.putDraft(id, {
    composerScratches: [{ startLine: 7, endLine: 8, text: "a half-typed thought" }],
  });

  await page.goto("/");
  await planSurface(page);
  await waitPastSafeModeGrace(page);

  const dialog = page.getByRole("dialog", { name: "Send the plan back for revision" });
  await page.getByRole("button", { name: "Request changes" }).click();
  await expect(dialog).toBeVisible();

  const row = unsentRows(dialog);
  await expect(row).toHaveCount(1);
  // Discard opens a confirmation bubble — the scratch is NOT dropped yet. The
  // bubble portals to the body (viewport-aware, EXC-762), so it's a page locator,
  // not a descendant of the dialog element — which is also why scoping the row's
  // own Discard to the list item can't collect the bubble's confirm button.
  await row.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(discardConfirm(page)).toBeVisible();
  await expect(row).toHaveCount(1);
  // Confirming completes the drop.
  await discardConfirm(page).getByRole("button", { name: "Discard" }).click();
  await expect(row).toHaveCount(0);
});

test("marking an inline comment as a draft demotes it into Unsent and out of the send (EXC-762)", async ({
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

  const dialog = page.getByRole("dialog", { name: "Send the plan back for revision" });
  await page.getByRole("button", { name: "Request changes" }).click();
  await expect(dialog).toBeVisible();

  // It starts as a committed inline comment, and Send is enabled.
  await expect(inlineRows(dialog)).toHaveCount(1);
  await expect(unsentRows(dialog)).toHaveCount(0);
  const send = dialog.getByRole("button", { name: "Send for revision" });
  await expect(send).toBeEnabled();

  // Mark as draft demotes it: it leaves the inline list, appears under Unsent, and
  // with nothing left to include the primary action disables.
  await inlineRows(dialog).getByRole("button", { name: "Mark as draft", exact: true }).click();
  await expect(dialog.getByRole("region", { name: "Inline comments" })).toHaveCount(0);
  const scratchRow = unsentRows(dialog);
  await expect(scratchRow).toHaveCount(1);
  await expect(scratchRow).toContainText("explain the cold cost");
  await expect(send).toBeDisabled();
});

test("discarding a committed inline comment drops it and leaves the dialog open (EXC-765)", async ({
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

  const dialog = page.getByRole("dialog", { name: "Send the plan back for revision" });
  await page.getByRole("button", { name: "Request changes" }).click();
  await expect(dialog).toBeVisible();
  await expect(inlineRows(dialog)).toHaveCount(1);

  // Discard opens the confirmation; nothing is dropped yet.
  await inlineRows(dialog).getByRole("button", { name: "Discard", exact: true }).click();
  await expect(discardConfirm(page)).toBeVisible();
  await expect(inlineRows(dialog)).toHaveCount(1);

  // Confirming drops the comment AND the dialog must stay open — the confirm click
  // (on a bubble portaled to document.body, outside the dialog content) must reach
  // its button, not fall through to the modal's outside-dismiss (EXC-765).
  await discardConfirm(page).getByRole("button", { name: "Discard" }).click();
  await expect(dialog).toBeVisible();
  await expect(inlineRows(dialog)).toHaveCount(0);
});

test("an inline comment reveals a nested Context with the anchored source lines (EXC-762)", async ({
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

  const dialog = page.getByRole("dialog", { name: "Send the plan back for revision" });
  await page.getByRole("button", { name: "Request changes" }).click();
  await expect(dialog).toBeVisible();

  // Both disclosures are collapsed by default (a real-browser check — happy-dom
  // can't tell a collapsed disclosure from an open one). The Context lives nested
  // in the inline comment's own expansion, so it takes two clicks to reveal.
  const context = dialog.locator(".context-lines");
  await expect(context).toBeHidden();
  // The row's own disclosure trigger stays a class selector: its accessible name
  // is name-from-content over the comment text, i.e. fixture data.
  await inlineRows(dialog).locator(".row-head .row-trigger").click();
  await dialog.locator(".context-trigger").click();
  await expect(context).toBeVisible();
  // It quotes the actual plan lines the comment anchors to, not the abbreviated
  // preview quote — the reviewer sees the real code they commented on.
  await expect(context).toContainText("cache layer");
  await expect(context).toContainText("cold cost");
});

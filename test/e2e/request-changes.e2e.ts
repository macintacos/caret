// Request changes: the dialog opens, Escape closes it, Cmd/Ctrl+Enter submits,
// and the review resolves as a rejection CARRYING the typed feedback — asserted
// daemon-side via GET /api/reviews/:id (a deny keeps the review in memory as
// `rejected` with the decision riding on it), not just by UI disappearance.
//
// Everything here needs a real browser or the live daemon. The general comment
// is a CodeMirror textbox, so the autofocus, the ⌘/Ctrl+Enter chord and the Esc
// that originates inside it are real-browser behavior; the dialog's disclosures
// are collapsed rather than unmounted, a distinction happy-dom cannot make (see
// the Context case below); and the seeded drafts reach the UI only after the
// daemon persists and serves back a working copy, which no mounted component
// can be handed as props. The pure halves stay units: the dialog's own counts,
// empty state, preview text and submit gating in
// ui/src/components/RequestChangesDialog.test.ts, the line references and
// abbreviated quotes in ui/src/lib/feedback.test.ts, and the deny request body
// in ui/src/state/resolve.test.ts.

import { alerts, discardConfirm, inlineRows, unsentRows } from "@test/e2e/support/chrome.ts";
import {
  openRequestChangesDialog,
  openWithPendingAnnotation,
  openWithPendingScratch,
} from "@test/e2e/support/decision.ts";
import { expect, test, waitPastSafeModeGrace } from "@test/e2e/support/fixtures.ts";
import { awaitDenied, submitForRevision } from "@test/e2e/support/review-state.ts";
import { seedAndOpen } from "@test/e2e/support/source-view.ts";

const FEEDBACK = "Please tighten the verification section.";

test("dialog opens, Escape closes, Cmd/Ctrl+Enter submits a rejection with feedback", async ({
  daemon,
  page,
}) => {
  const id = await seedAndOpen(page, daemon);
  await waitPastSafeModeGrace(page);

  const dialog = page.getByRole("dialog", { name: "Send the plan back for revision" });
  const editor = dialog.getByRole("textbox", { name: "General comment" });

  // Open → Escape closes. The editor autofocuses on open, so the Escape key
  // originates inside it (the editor wires Esc → onCancel to dismiss the dialog).
  await openRequestChangesDialog(page);
  await expect(editor).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  // Reopen → type feedback → Cmd/Ctrl+Enter submits. fill() focuses the editor
  // and populates it (CodeMirror registers it), leaving focus there so the chord
  // lands inside the editor.
  await openRequestChangesDialog(page);
  await editor.fill(FEEDBACK);
  await page.keyboard.press("ControlOrMeta+Enter");

  // UI: the review leaves the pending set.
  await expect(page.getByRole("heading", { name: "No plans awaiting review" })).toBeVisible();

  // API: rejected, and the decision carries the feedback text.
  const review = await awaitDenied(daemon, id);
  expect(review?.status).toBe("rejected");
  expect(review?.decision?.feedback).toContain(FEEDBACK);
});

test("a line-anchored annotation reaches Decision.feedback as a line reference plus an abbreviated quote", async ({
  daemon,
  page,
}) => {
  const id = await openWithPendingAnnotation(daemon, page, "explain the cold cost");
  await waitPastSafeModeGrace(page);

  // Open the dialog and submit with no general comment — the seeded annotation
  // alone produces feedback, so the deny button is enabled.
  const dialog = await openRequestChangesDialog(page);
  // The preview shows the new format the agent will receive — the line reference
  // and the abbreviated quote, identical to the sent feedback. (Behind a collapsed
  // disclosure but still in the DOM, so its text is readable without expanding.)
  await expect(dialog.locator(".preview pre")).toContainText("Lines 7-8:");
  await expect(dialog.locator(".preview pre")).toContainText("The cache layer … full cold cost.");

  // The new format reached Decision.feedback: a line reference AND an
  // abbreviated quote (first/last few words around an ellipsis), so the agent
  // can locate the feedback by content without the full selection's token cost.
  const feedback = await submitForRevision(page, dialog, daemon, id);
  expect(feedback).toContain("Lines 7-8:");
  expect(feedback).toContain("> The cache layer … full cold cost.");
  expect(feedback).toContain("explain the cold cost");
});

test("a scratch's Save shows without expanding the row and graduates it into the sent feedback (EXC-746)", async ({
  daemon,
  page,
}) => {
  // Seed a retained-but-unsent composer scratch (the reviewer typed an inline
  // comment but never clicked "Comment"), the same way the UI's autosave persists
  // one, before the page loads its working copy.
  const id = await openWithPendingScratch(daemon, page, "a half-typed thought");
  await waitPastSafeModeGrace(page);

  const dialog = await openRequestChangesDialog(page);

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
  const feedback = await submitForRevision(page, dialog, daemon, id);
  expect(feedback).toContain("a half-typed thought");
});

test("discarding an unsent comment asks to confirm before dropping it (EXC-762)", async ({
  daemon,
  page,
}) => {
  await openWithPendingScratch(daemon, page, "a half-typed thought");
  await waitPastSafeModeGrace(page);

  const dialog = await openRequestChangesDialog(page);

  const row = unsentRows(dialog);
  await expect(row).toHaveCount(1);
  // Discard opens a confirmation bubble — the scratch is NOT dropped yet. The
  // bubble portals to the body (bits-ui Popover, EXC-1110), so it's a page locator,
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
  await openWithPendingAnnotation(daemon, page, "explain the cold cost");
  await waitPastSafeModeGrace(page);

  const dialog = await openRequestChangesDialog(page);

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
  await openWithPendingAnnotation(daemon, page, "explain the cold cost");
  await waitPastSafeModeGrace(page);

  const dialog = await openRequestChangesDialog(page);
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
  await openWithPendingAnnotation(daemon, page, "explain the cold cost");
  await waitPastSafeModeGrace(page);

  const dialog = await openRequestChangesDialog(page);

  // Both disclosures are collapsed by default (a real-browser check — happy-dom
  // can't tell a collapsed disclosure from an open one). The Context lives nested
  // in the inline comment's own expansion, so it takes two clicks to reveal.
  // toBeHidden, not toHaveCount(0): a collapsed disclosure keeps its content
  // mounted, which is the whole reason this check needs a real browser.
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

test("submitting confirms the outcome, and the waiting room arrives behind it", async ({
  daemon,
  page,
}) => {
  // The hand-off (EXC-894) on the request-changes arm — the third verdict, and the one
  // whose modal is a full dialog rather than a guard, so it proves the acknowledgment is
  // wired to the decision rather than to the alertdialog primitive.
  const id = await seedAndOpen(page, daemon);
  await waitPastSafeModeGrace(page);

  const dialog = await openRequestChangesDialog(page);
  await dialog.getByRole("textbox", { name: "General comment" }).fill(FEEDBACK);
  await page.keyboard.press("ControlOrMeta+Enter");

  await expect(alerts(page)).toContainText("Changes requested");
  await expect(page.getByRole("heading", { name: "No plans awaiting review" })).toBeVisible();
  await awaitDenied(daemon, id);
});

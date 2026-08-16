// The discard confirmation's own semantics, at each of its three call sites, after
// it was rebuilt on the vendored `popover` (EXC-1110). The flows those sites sit in
// are covered where they live — the composer's discard and the card's delete in
// diff-surface.e2e.ts, the dialog's two rows in request-changes.e2e.ts. What this
// spec pins is the behaviour that moved from caret's own code into bits-ui and
// Floating UI, and so needs re-proving against the real thing rather than against
// the props a mounted component is handed.
//
// Every case here needs a real browser. Escape and outside-click dismissal are
// layer-stack behaviour; where initial focus lands and where it returns are focus
// scope behaviour; and the anchored geometry — that the bubble tracks its trigger
// through a scroll instead of closing, which is the behaviour change this rebuild
// chose — is layout that happy-dom does not do. Its structure and ARIA stay units
// in ui/src/components/ConfirmPopover.test.ts, per doc/agents/browser-testing.md.

import { discardConfirm, inlineRows } from "@test/e2e/support/chrome.ts";
import { expect, test, waitPastSafeModeGrace } from "@test/e2e/support/fixtures.ts";
import { planSurface, revealGutterPlus } from "@test/e2e/support/source-view.ts";

/** Open the gutter composer on `line` with `draft` typed into it. The composer only
 * confirms a discard once it holds text, so the draft is what puts the bubble in
 * play at all. */
async function composerWithDraft(page: import("@playwright/test").Page, draft: string) {
  const plus = await revealGutterPlus(page, 3);
  await plus.click();
  const composer = page.getByRole("dialog", { name: "Add a comment" });
  await expect(composer).toBeVisible();
  const input = composer.getByRole("textbox", { name: "Comment" });
  await input.fill(draft);
  // CodeMirror applies input asynchronously, so acting immediately races the fill.
  await expect(input).toContainText(draft);
  return composer;
}

test("Escape backs out of the composer's discard and hands focus back to its trigger", async ({
  daemon,
  page,
}) => {
  await daemon.seed();
  await page.goto("/");
  await planSurface(page);
  await waitPastSafeModeGrace(page);

  const composer = await composerWithDraft(page, "do not lose me");
  const trigger = composer.getByRole("button", { name: "Discard" });
  await trigger.click();
  await expect(discardConfirm(page)).toBeVisible();

  // Escape can only ever cancel: the draft survives and the composer stays open.
  await page.keyboard.press("Escape");
  await expect(discardConfirm(page)).toHaveCount(0);
  await expect(composer).toBeVisible();
  // And focus comes back to the button that opened it, so a keyboard reviewer is
  // not stranded on the body after backing out.
  await expect(trigger).toBeFocused();
});

test("a click outside the composer's discard bubble cancels rather than confirms", async ({
  daemon,
  page,
}) => {
  const id = await daemon.seed();
  await page.goto("/");
  await planSurface(page);
  await waitPastSafeModeGrace(page);

  const composer = await composerWithDraft(page, "still here");
  await composer.getByRole("button", { name: "Discard" }).click();
  await expect(discardConfirm(page)).toBeVisible();

  // A click outside the bubble is a light dismiss, never a confirmation. The target
  // is the composer's own inert range label: clicking the plan behind it would also
  // dismiss the COMPOSER (clicking away keeps the draft for later), which would
  // conflate two dismissals in one assertion.
  await composer.getByText("Line 3").click();
  await expect(discardConfirm(page)).toHaveCount(0);
  await expect(composer).toBeVisible();
  await expect(composer.getByRole("textbox", { name: "Comment" })).toContainText("still here");
  // Nothing was committed either way, so the review carries no annotation.
  await expect
    .poll(async () => (await daemon.getReview(id)).body?.annotations?.length ?? 0)
    .toBe(0);
});

test("the card's delete confirmation opens with the confirm button focused", async ({
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

  await page.locator("[data-annotation-card]").getByRole("button", { name: "Discard" }).click();
  const confirm = discardConfirm(page).getByRole("button", { name: "Discard" });
  await expect(confirm).toBeFocused();

  // Focused means a bare Enter completes the action the reviewer already started.
  // Asserted daemon-side: the card's disappearance is the UI's half, but only the
  // persisted draft proves the delete was actually committed rather than repainted.
  await page.keyboard.press("Enter");
  await expect(discardConfirm(page)).toHaveCount(0);
  await expect
    .poll(async () => (await daemon.getReview(id)).body?.annotations?.length ?? -1)
    .toBe(0);
});

test("inside the scrolling dialog the bubble tracks its trigger and still takes the click", async ({
  daemon,
  page,
}) => {
  const id = await daemon.seed();
  await daemon.putDraft(id, {
    annotations: Array.from({ length: 24 }, (_, i) => ({
      id: `ann-${i}`,
      startLine: 7,
      endLine: 8,
      comment: `explain the cold cost, take ${i}`,
    })),
  });
  await page.goto("/");
  await planSurface(page);
  await waitPastSafeModeGrace(page);

  const dialog = page.getByRole("dialog", { name: "Send the plan back for revision" });
  await page.getByRole("button", { name: "Request changes" }).click();
  await expect(dialog).toBeVisible();
  await expect(inlineRows(dialog)).toHaveCount(24);

  const trigger = inlineRows(dialog).first().getByRole("button", { name: "Discard", exact: true });
  await trigger.click();
  await expect(discardConfirm(page)).toBeVisible();

  // The gap between the trigger and the bubble hanging off it, across a scroll of
  // the dialog body. The hand-rolled bubble this replaced could not follow a moving
  // anchor and so CLOSED on any scroll; Floating UI's autoUpdate tracks it, which is
  // the behaviour EXC-1110 chose — losing a destructive prompt to a stray wheel
  // nudge is worse than letting it follow.
  //
  // The scroll is deliberately small and the FIRST row is the trigger, so it stays
  // well inside the body: scrolling far enough to push the anchor out of view would
  // hand the assertion to Floating UI's collision handling instead of its tracking.
  const gap = async () => {
    const t = await trigger.boundingBox();
    const b = await discardConfirm(page).boundingBox();
    if (t === null || b === null) throw new Error("trigger or bubble is not laid out");
    return Math.round(b.y - t.y);
  };
  const triggerY = async () => Math.round((await trigger.boundingBox())?.y ?? Number.NaN);
  const before = await gap();
  const yBefore = await triggerY();
  const scrolled = await dialog.locator(".body").evaluate((el) => {
    el.scrollTop += 40;
    return el.scrollTop;
  });
  // The body must really have scrolled, or the assertion below proves nothing.
  expect(scrolled).toBeGreaterThan(0);
  // Wait for the anchor to have actually moved before reading the bubble, so a gap
  // that merely hasn't been recomputed yet cannot pass as a gap that tracked.
  await expect.poll(triggerY).not.toBe(yBefore);
  await expect(discardConfirm(page)).toBeVisible();
  await expect.poll(gap).toBe(before);

  // And the click still lands on the bubble rather than falling through: the dialog
  // is a bits-ui Dialog, whose scroll-lock sets pointer-events:none on <body>, and
  // the bubble is portalled to that same body. bits-ui re-enables them on the
  // floating wrapper and the content, so the confirm is live and the dialog beneath
  // treats the click as inside its own layer stack rather than as a dismiss.
  await discardConfirm(page).getByRole("button", { name: "Discard" }).click();
  await expect(dialog).toBeVisible();
  await expect(inlineRows(dialog)).toHaveCount(23);
});

test("Escape closes the dialog's bubble without closing the dialog", async ({ daemon, page }) => {
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

  await inlineRows(dialog).getByRole("button", { name: "Discard", exact: true }).click();
  await expect(discardConfirm(page)).toBeVisible();

  // One Escape per layer, innermost first — the bubble is the topmost escape layer,
  // so the dialog under it is untouched and the comment survives.
  await page.keyboard.press("Escape");
  await expect(discardConfirm(page)).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(inlineRows(dialog)).toHaveCount(1);

  // The second Escape reaches the dialog, which is now the topmost layer.
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

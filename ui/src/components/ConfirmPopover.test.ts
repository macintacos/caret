// ConfirmPopover is a `popover` composition (EXC-1110), so its content is portalled
// and deferred exactly as shadcn-foundation.test.ts recorded for Dialog: poll with
// flushUntil and query document.body, not the mount target. What stays unit here is
// STRUCTURE and ARIA — the bubble is an alertdialog named by its question, it carries
// the question and both labels, and only the confirm button reports back.
//
// The interaction semantics are bits-ui's now and are real-browser behaviours, so
// Escape-to-cancel, outside-click-to-cancel, initial focus on the confirm button and
// focus restoration to the trigger all live in test/e2e/confirm-popover.e2e.ts, per
// doc/agents/browser-testing.md. Asserting them here would be asserting happy-dom.
import "@ui/support/mount.ts";

import { expect, test } from "bun:test";

import { flushUntil, render } from "@ui/support/mount.ts";
import ConfirmPopoverFixture from "@/components/ConfirmPopover-fixture.svelte";

const bubble = () => document.body.querySelector<HTMLElement>(".confirm-popover");
const confirmBtn = () => bubble()?.querySelector<HTMLElement>(".confirm");
const cancelBtn = () => bubble()?.querySelector<HTMLElement>(".cancel");

/** Open the bubble by clicking the trigger, the way a reviewer does — `open` is the
 * popover's own state now, with no prop to set it from outside. The flush before the
 * click is load-bearing, not tidy: see flushUntil's note in ui/support/mount.ts. */
async function open(target: HTMLElement, flush: () => void): Promise<void> {
  flush();
  target.querySelector<HTMLButtonElement>(".fixture-trigger")?.click();
  await flushUntil(flush, () => bubble() !== null);
}

/** Dismiss before the test ends. Load-bearing rather than tidy, and the same guard
 * shadcn-command-popover.test.ts carries: bits-ui's portal presence waits for an
 * `animationend` that never fires under happy-dom, so content left open at unmount
 * keeps its effects alive into the next test, which then reads deriveds whose owner
 * is already destroyed and svelte warns `derived_inert`. mount.ts purges the DOM
 * half of that leak; only closing purges the effect half. */
async function close(flush: () => void): Promise<void> {
  if (bubble() === null) return;
  cancelBtn()?.click();
  await flushUntil(flush, () => bubble() === null);
}

test("the trigger renders in place and the bubble only appears once it is used", async () => {
  const { target, flush } = render(ConfirmPopoverFixture, {});
  const trigger = target.querySelector<HTMLElement>(".fixture-trigger");
  // The snippet receives bits-ui's trigger props, which is what makes the caller's
  // own button the anchor and the focus-restoration target.
  expect(trigger?.getAttribute("data-slot")).toBe("popover-trigger");
  expect(bubble()).toBeNull();

  await open(target, flush);
  expect(bubble()).not.toBeNull();
  await close(flush);
});

test("the bubble is an alertdialog labelled by the question", async () => {
  const { target, flush } = render(ConfirmPopoverFixture, {});
  await open(target, flush);
  // alertdialog: it announces an irreversible consequence to assistive tech.
  expect(bubble()?.getAttribute("role")).toBe("alertdialog");
  expect(bubble()?.getAttribute("aria-label")).toBe("Discard this comment?");
  await close(flush);
});

test("shows the question and both button labels", async () => {
  const { target, flush } = render(ConfirmPopoverFixture, { cancelLabel: "Keep editing" });
  await open(target, flush);
  expect(bubble()?.textContent).toContain("Discard this comment?");
  expect(confirmBtn()?.textContent?.trim()).toBe("Discard");
  expect(cancelBtn()?.textContent?.trim()).toBe("Keep editing");
  await close(flush);
});

test("defaults the cancel label to Cancel", async () => {
  const { target, flush } = render(ConfirmPopoverFixture, {});
  await open(target, flush);
  expect(cancelBtn()?.textContent?.trim()).toBe("Cancel");
  await close(flush);
});

test("confirming fires onConfirm exactly once and closes the bubble", async () => {
  // Counted rather than captured: `capture` keeps only the last value, so a double
  // invocation — the failure that would delete a comment twice — is invisible to it.
  let calls = 0;
  const { target, flush } = render(ConfirmPopoverFixture, {
    onConfirm: () => {
      calls += 1;
    },
  });
  await open(target, flush);
  confirmBtn()?.click();
  await flushUntil(flush, () => bubble() === null);
  expect(calls).toBe(1);
  expect(bubble()).toBeNull();
});

test("cancelling closes the bubble without firing onConfirm", async () => {
  let calls = 0;
  const { target, flush } = render(ConfirmPopoverFixture, {
    onConfirm: () => {
      calls += 1;
    },
  });
  await open(target, flush);
  cancelBtn()?.click();
  await flushUntil(flush, () => bubble() === null);
  // The whole point of the guard: backing out is never a confirmation.
  expect(calls).toBe(0);
  expect(bubble()).toBeNull();
});

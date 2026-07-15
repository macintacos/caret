// Proof-of-life for the shadcn-svelte + Tailwind foundation (EXC-757): a plain
// component (Button) and a bits-ui component (Dialog) copied from the registry
// both compile, resolve the `$lib` alias, and mount under the bun-test happy-dom
// harness. This test also RECORDS the bits-ui-under-happy-dom unit-vs-e2e verdict
// the ticket asks for:
//
//   • Button (no bits-ui) mounts SYNCHRONOUSLY — structure and its
//     tailwind-variants class output are unit-assertable.
//   • Dialog (bits-ui) mounts too, and the trigger reflects reactive open-state
//     synchronously — but the PORTALLED content (overlay + panel) is DEFERRED:
//     it appears only after effects flush AND a timer tick advances. A purely
//     synchronous assertion sees the trigger, not the panel.
//
// Takeaway for later tickets: bits-ui surfaces are unit-mountable for STRUCTURE /
// ARIA assertions (with an async flush), but their real interaction semantics —
// focus trap, Escape-to-close, outside-click, focus restoration, scroll lock —
// are real-browser behaviors that stay e2e per doc/agents/browser-testing.md.
import "../../test-setup.ts";
import { expect, test } from "bun:test";

import { Button } from "$lib/components/ui/button/index.js";
import DialogFixture from "$lib/shadcn-dialog-fixture.svelte";

import { render } from "../../test-mount.ts";

/** Flush effects and advance timer ticks until `done()` holds (or a bounded
 * number of tries elapses) — bits-ui's portal/presence mounts its content on a
 * deferred timer, so we poll rather than sleep a fixed interval (a fixed wait
 * risks flaking on a loaded box). Returns as soon as the condition is met. */
async function flushUntil(flush: () => void, done: () => boolean): Promise<void> {
  for (let i = 0; i < 40; i++) {
    flush();
    if (done()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  flush();
}

const dialogContentMounted = () =>
  document.body.querySelector("[data-slot='dialog-content']") !== null;

test("Button mounts as a native <button> carrying its tailwind-variants classes", () => {
  const { target } = render(Button, { children: undefined });
  const button = target.querySelector("button[data-slot='button']");
  expect(button).not.toBeNull();
  // Default variant → the tv() base + `default` variant classes are applied.
  expect(button?.className).toContain("inline-flex");
  expect(button?.className).toContain("bg-primary");
});

test("Button variant prop flows through buttonVariants into the class list", () => {
  const { target } = render(Button, { variant: "destructive", children: undefined });
  const button = target.querySelector("button[data-slot='button']");
  expect(button?.className).toContain("text-destructive");
  expect(button?.className).not.toContain("bg-primary");
});

test("Dialog (bits-ui) mounts: the trigger reflects reactive open-state synchronously", async () => {
  const { target, flush } = render(DialogFixture, { open: true });
  const trigger = target.querySelector("button[data-slot='dialog-trigger']");
  expect(trigger).not.toBeNull();
  expect(trigger?.getAttribute("data-state")).toBe("open");
  expect(trigger?.getAttribute("aria-expanded")).toBe("true");
  // Drain the deferred portal so its pending timer can't fire into teardown.
  await flushUntil(flush, dialogContentMounted);
});

test("Dialog portalled content renders after an async effect + timer flush", async () => {
  const { flush } = render(DialogFixture, { open: true });
  await flushUntil(flush, dialogContentMounted);

  const content = document.body.querySelector("[data-slot='dialog-content']");
  expect(content).not.toBeNull();
  expect(content?.getAttribute("role")).toBe("dialog");
  expect(content?.getAttribute("aria-modal")).toBe("true");
  const title = document.body.querySelector("[data-slot='dialog-title']");
  expect(title?.textContent).toContain("Proof of life");
});

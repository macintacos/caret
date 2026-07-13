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
import { render } from "../../test-mount.ts";
import { Button } from "$lib/components/ui/button/index.js";
import DialogFixture from "./shadcn-dialog-fixture.svelte";

/** Flush pending effects, advance one timer tick, flush again — the sequence
 * bits-ui's portal/presence needs before its deferred content is in the DOM. */
async function settle(flush: () => void): Promise<void> {
  flush();
  await new Promise((resolve) => setTimeout(resolve, 30));
  flush();
}

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
  await settle(flush);
});

test("Dialog portalled content renders after an async effect + timer flush", async () => {
  const { flush } = render(DialogFixture, { open: true });
  await settle(flush);

  const content = document.body.querySelector("[data-slot='dialog-content']");
  expect(content).not.toBeNull();
  expect(content?.getAttribute("role")).toBe("dialog");
  expect(content?.getAttribute("aria-modal")).toBe("true");
  const title = document.body.querySelector("[data-slot='dialog-title']");
  expect(title?.textContent).toContain("Proof of life");
});

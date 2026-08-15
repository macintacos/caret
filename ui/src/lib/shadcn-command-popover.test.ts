// Mount proof for the vendored Command + Popover primitives (EXC-1093). Nothing
// imports them yet — their consumers land on sibling branches — so svelte-check
// is otherwise the only thing that looks at this tree, and a type-check cannot
// tell whether the copies actually resolve against the installed bits-ui or
// whether the @lucide/svelte → Icon.svelte swap renders a glyph at all.
//
// Popover is portalled, so its content is deferred exactly as
// shadcn-foundation.test.ts recorded for Dialog: poll with flushUntil and query
// document.body, not the mount target. The real interaction semantics — focus
// trap, Escape-to-close, outside-click, filtering as you type — are
// real-browser behaviours and stay e2e per doc/agents/browser-testing.md.
import "@ui/test-mount.ts";

import { expect, test } from "bun:test";

import { flushUntil, render } from "@ui/test-mount.ts";
import CommandPopoverFixture from "$lib/shadcn-command-popover-fixture.svelte";

const popoverContent = () => document.body.querySelector("[data-slot='popover-content']");

test("Popover portals its content, which hosts the Command root", async () => {
  const { flush } = render(CommandPopoverFixture, { open: true });
  await flushUntil(flush, () => popoverContent() !== null);

  expect(popoverContent()).not.toBeNull();
  expect(popoverContent()?.querySelector("[data-slot='command']")).not.toBeNull();
});

test("Command renders its input and item rows", async () => {
  const { flush } = render(CommandPopoverFixture, { open: true });
  await flushUntil(flush, () => popoverContent() !== null);

  const input = document.body.querySelector("input[data-slot='command-input']");
  expect(input?.getAttribute("placeholder")).toBe("Jump to section");

  const labels = [...document.body.querySelectorAll("[data-slot='command-item']")].map((el) =>
    el.textContent?.trim(),
  );
  expect(labels).toEqual(["Overview", "Details"]);
});

test("the icon swap renders vendored SVGs, not the dropped @lucide/svelte components", async () => {
  const { flush } = render(CommandPopoverFixture, { open: true });
  await flushUntil(flush, () => popoverContent() !== null);

  // command-input's search glyph, inside the addon Icon.svelte was swapped into.
  const wrapper = document.body.querySelector("[data-slot='command-input-wrapper']");
  expect(wrapper?.querySelector("svg")).not.toBeNull();

  // command-item's check indicator, one per row.
  const indicators = document.body.querySelectorAll(".cn-command-item-indicator svg");
  expect(indicators.length).toBe(2);
});

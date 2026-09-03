// Mount proof for the vendored Command + Popover primitives (EXC-1093), and the
// guard doc/agents/shadcn-rules.md names for the viewport a registry re-sync would
// drop. A type-check cannot tell whether the copies actually resolve against the
// installed bits-ui, whether the @lucide/svelte → Icon.svelte swap renders a glyph,
// or whether the combobox still names the list it controls — so this suite mounts
// them for real. It asserts the PRIMITIVES; PlanToc.test.ts asserts the one surface
// composed from them.
//
// Popover is portalled, so its content is deferred exactly as
// shadcn-foundation.test.ts recorded for Dialog: poll with flushUntil and query
// document.body, not the mount target. The real interaction semantics — focus
// trap, Escape-to-close, outside-click, filtering as you type — are
// real-browser behaviours and stay e2e per doc/agents/browser-testing.md.
import "@ui/support/mount.ts";

import { expect, test } from "bun:test";

import { flushUntil, render } from "@ui/support/mount.ts";
import CommandPopoverFixture from "$lib/shadcn-command-popover-fixture.svelte";

const popoverContent = () => document.body.querySelector("[data-slot='popover-content']");
const commandInput = () => document.body.querySelector("input[data-slot='command-input']");

/** Dismiss the popover before the test ends. Load-bearing rather than tidy, and the
 * same guard PlanToc.test.ts carries: bits-ui's portal presence waits for an
 * `animationend` that never fires under happy-dom, so content left open at unmount
 * keeps its effects alive into the next test, which then reads deriveds whose owner
 * is already destroyed and svelte warns `derived_inert`. mount.ts purges the DOM
 * half of that leak; only closing purges the effect half. Guarded, so it is a no-op
 * if a test already closed. */
async function close(target: HTMLElement, flush: () => void): Promise<void> {
  if (popoverContent() === null) return;
  target.querySelector<HTMLButtonElement>("[data-slot='popover-trigger']")?.click();
  await flushUntil(flush, () => popoverContent() === null);
}

/** Mount the fixture already open, and wait for the portalled content. */
async function openedPopover() {
  const { target, flush } = render(CommandPopoverFixture, { open: true });
  await flushUntil(flush, () => popoverContent() !== null);
  return { target, flush };
}

test("Popover portals its content, which hosts the Command root", async () => {
  const { target, flush } = await openedPopover();

  expect(popoverContent()).not.toBeNull();
  expect(popoverContent()?.querySelector("[data-slot='command']")).not.toBeNull();
  await close(target, flush);
});

test("Command renders its input and item rows", async () => {
  const { target, flush } = await openedPopover();

  const input = commandInput();
  expect(input?.getAttribute("placeholder")).toBe("Jump to section");

  const labels = [...document.body.querySelectorAll("[data-slot='command-item']")].map((el) =>
    el.textContent?.trim(),
  );
  expect(labels).toEqual(["Overview", "Details"]);
  await close(target, flush);
});

// EXC-1096: the narration plumbing the whole `command` vendoring was justified by.
// bits-ui computes the input's `aria-controls` AND its `aria-activedescendant` from
// `CommandRootState.viewportNode`, which exactly one thing sets — the `attachRef` on
// `CommandViewportState`. A `Command.List` rendering no `Command.Viewport` leaves it
// null and both attributes come out undefined, on every Command in the app. Pinned
// here at the primitive rather than on the ToC popup because the defect is the
// primitive's, and a re-sync from the registry is what would reintroduce it.
test("the command input names the viewport it controls", async () => {
  const { target, flush } = await openedPopover();

  const input = commandInput();
  const controls = input?.getAttribute("aria-controls");
  expect(controls).toBeTruthy();

  // The viewport is real, and it sits INSIDE the listbox — so the options stay owned
  // by the listbox rather than by a stray generic element between the two. The `none`
  // role is what keeps that ownership intact across the extra wrapper.
  const viewport = document.getElementById(controls ?? "");
  expect(viewport?.getAttribute("data-slot")).toBe("command-viewport");
  expect(viewport?.getAttribute("role")).toBe("none");

  const listbox = document.body.querySelector("[data-slot='command-list']");
  expect(listbox?.getAttribute("role")).toBe("listbox");
  expect(listbox?.contains(viewport)).toBe(true);
  await close(target, flush);
});

// The half that narrates as a list narrows: the active row's id rides on the input,
// so a screen reader is told which option the selection landed on without focus ever
// leaving the field.
test("the command input names the option the selection is on", async () => {
  const { target, flush } = await openedPopover();

  const input = commandInput();
  await flushUntil(flush, () => input?.getAttribute("aria-activedescendant") != null);

  const active = document.getElementById(input?.getAttribute("aria-activedescendant") ?? "");
  expect(active?.getAttribute("data-slot")).toBe("command-item");
  // The command selects its first row on mount, so that is the row named.
  expect(active?.textContent?.trim()).toBe("Overview");
  await close(target, flush);
});

test("the icon swap renders vendored SVGs, not the dropped @lucide/svelte components", async () => {
  const { target, flush } = await openedPopover();

  // command-input's search glyph, inside the addon Icon.svelte was swapped into.
  const wrapper = document.body.querySelector("[data-slot='command-input-wrapper']");
  expect(wrapper?.querySelector("svg")).not.toBeNull();

  // command-item's check indicator, one per row. Queried through the data-slot
  // contract rather than the `cn-*` marker class the registry style ships, which is
  // undefined in caret and renamed freely upstream.
  const indicators = document.body.querySelectorAll("[data-slot='command-item'] svg");
  expect(indicators.length).toBe(2);
  await close(target, flush);
});

// The second caret addition to the vendored command tree, alongside the Viewport
// above (EXC-1103). The registry's command-group hardcodes its heading's classes and
// offers no override, so a caret surface wanting its own label vocabulary — the ToC
// popup dresses the breadcrumb header in the shared `.eyebrow` atom — has nowhere to
// put one. The guard belongs HERE rather than only on that surface: it is the
// PRIMITIVE a re-sync reverts, and a guard living on the one consumer disappears the
// day that consumer restyles, leaving the vendored edit to rot silently — which is
// the whole failure mode doc/agents/shadcn-rules.md § Edits a re-sync will silently
// undo exists to prevent.
//
// Asserted on `data-command-group-heading`, which is what bits-ui 2.x actually
// stamps. The `**:[[cmdk-group-heading]]:…` Tailwind variants the registry source
// still carries target a cmdk-era attribute that appears nowhere in this tree.
test("Command.Group forwards headingClass onto the heading element", async () => {
  const { target, flush } = await openedPopover();

  const heading = document.body.querySelector("[data-command-group-heading]");
  expect(heading?.textContent?.trim()).toBe("Sections");
  expect(heading?.classList.contains("fixture-eyebrow")).toBe(true);
  // Merged with the stock classes rather than replacing them, so a re-sync that
  // drops the prop degrades the look instead of breaking the group.
  expect(heading?.classList.contains("text-xs")).toBe(true);
  await close(target, flush);
});

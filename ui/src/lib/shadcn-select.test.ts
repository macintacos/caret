// Composition guard for the vendored Select tree (EXC-1109). Select only exists
// composed — Root → Trigger → Content → Group → Item — so it takes a fixture plus
// this suite rather than a file beside the component, per
// doc/agents/shadcn-rules.md § Where the test goes. A type-check cannot tell
// whether the copies resolve against the installed bits-ui, whether the
// @lucide/svelte → Icon.svelte swap renders a glyph, or whether a dropped
// sub-part quietly takes the listbox semantics with it.
//
// Select portals its content, so it behaves exactly as shadcn-foundation.test.ts
// recorded for Dialog: poll with flushUntil and query document.body, not the
// mount target. The real interaction semantics — keyboard roving, typeahead,
// outside-click, focus restoration — are real-browser behaviours and stay e2e
// per doc/agents/browser-testing.md.
import "@ui/test-mount.ts";

import { expect, test } from "bun:test";

import { flushUntil, render } from "@ui/test-mount.ts";
import SelectFixture from "$lib/shadcn-select-fixture.svelte";

const content = () => document.body.querySelector("[data-slot='select-content']");
const trigger = (target: HTMLElement) => target.querySelector("[data-slot='select-trigger']");

/** Dismiss the select before the test ends. Load-bearing rather than tidy, and the
 * same guard shadcn-command-popover.test.ts carries: bits-ui's portal presence
 * waits for an `animationend` that never fires under happy-dom, so content left
 * open at unmount keeps its effects alive into the next test, which then reads
 * deriveds whose owner is already destroyed and svelte warns `derived_inert`.
 * test-mount.ts purges the DOM half of that leak; only closing purges the effect
 * half. Guarded, so it is a no-op if a test never opened. */
async function close(target: HTMLElement, flush: () => void): Promise<void> {
  if (content() === null) return;
  (trigger(target) as HTMLButtonElement | null)?.click();
  await flushUntil(flush, () => content() === null);
}

test("the trigger renders closed, announcing the listbox it opens", async () => {
  const { target, flush } = render(SelectFixture, { open: false });
  await flushUntil(flush, () => trigger(target) !== null);

  expect(trigger(target)?.getAttribute("aria-haspopup")).toBe("listbox");
  expect(trigger(target)?.getAttribute("aria-expanded")).toBe("false");
  expect(content()).toBeNull();
});

test("opening portals the content as a listbox of its items", async () => {
  const { target, flush } = render(SelectFixture, { open: true });
  await flushUntil(flush, () => content() !== null);

  expect(trigger(target)?.getAttribute("aria-expanded")).toBe("true");
  expect(content()?.getAttribute("role")).toBe("listbox");

  // Every part the tree is made of, present at once: a dropped one is what this
  // guard exists to red on.
  expect(content()?.querySelector("[data-slot='select-group']")).not.toBeNull();
  expect(content()?.querySelector("[data-slot='select-group-heading']")?.textContent?.trim()).toBe(
    "Themes",
  );
  const labels = [...document.body.querySelectorAll("[data-slot='select-item']")].map((el) =>
    el.textContent?.trim(),
  );
  expect(labels).toEqual(["Light", "Dark"]);
  await close(target, flush);
});

// The indicator is the row's only "this one is chosen" signal until a call site
// adds its own, so it has to be the vendored glyph and it has to be on exactly
// one row. `data-icon` is what Icon.svelte stamps and the only thing in the DOM
// that names an inlined SVG.
test("the icon swap renders vendored SVGs, not the dropped @lucide/svelte components", async () => {
  const { target, flush } = render(SelectFixture, { open: true });
  await flushUntil(flush, () => content() !== null);

  expect(trigger(target)?.querySelector("[data-icon='chevron-down']")).not.toBeNull();

  const rows = [...document.body.querySelectorAll("[data-slot='select-item']")];
  const selected = rows.find((el) => el.getAttribute("aria-selected") === "true");
  const unselected = rows.find((el) => el.getAttribute("aria-selected") !== "true");
  expect(selected?.textContent?.trim()).toBe("Dark");
  expect(selected?.querySelector("[data-icon='check']")).not.toBeNull();
  expect(unselected?.querySelector("[data-icon]")).toBeNull();
  await close(target, flush);
});

// The one conforming edit the vendoring makes beyond the icon swap: a Select row
// wears dropdown-menu-item's radius and cursor so it reads as the same control as
// the menu row EXC-1111 replaces. Pinned here because a registry re-sync reverts
// it silently, exactly like the Command.Viewport case in
// doc/agents/shadcn-rules.md § Edits a re-sync will silently undo.
test("select rows carry caret's menu-row geometry", async () => {
  const { target, flush } = render(SelectFixture, { open: true });
  await flushUntil(flush, () => content() !== null);

  const row = document.body.querySelector("[data-slot='select-item']");
  expect(row?.classList.contains("rounded-lg")).toBe(true);
  expect(row?.classList.contains("cursor-pointer")).toBe(true);
  await close(target, flush);
});

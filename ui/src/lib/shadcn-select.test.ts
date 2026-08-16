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
import { join } from "node:path";

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
 * half. Guarded, so it is a no-op if a test never opened.
 *
 * The gesture is a real `pointerdown`, NOT the `.click()` the Popover suite uses:
 * `SelectTriggerState.onpointerdown` is what toggles, and its `onclick` only calls
 * `focus()` (bits/select/select.svelte.js) — so a click leaves the select open and
 * this helper silently stops guarding anything. The closing assertion is what keeps
 * that from happening again, since `flushUntil` exhausts its budget without throwing. */
async function close(target: HTMLElement, flush: () => void): Promise<void> {
  if (content() === null) return;
  trigger(target)?.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      pointerId: 1,
      pointerType: "mouse",
    }),
  );
  await flushUntil(flush, () => content() === null);
  expect(content()).toBeNull();
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

// The two invariants a mount cannot reach, pinned against select-content.svelte's
// source the way motion.test.ts pins the four modal surfaces. Both are exactly the
// re-sync hazard doc/agents/shadcn-rules.md § Edits a re-sync will silently undo
// describes: an overwrite restores stock and every mounted assertion above stays green.
// Comment lines are stripped first: both assertions below look for a literal that the
// file's own explanatory comments also spell, so an unstripped read matches the prose
// rather than the markup it describes.
const selectContentSource = (
  await Bun.file(join(import.meta.dir, "components/ui/select/select-content.svelte")).text()
).replace(/^\s*\/\/.*$/gm, "");

test("the content keys its enter/exit on the attribute bits-ui actually stamps", () => {
  // Stock's bare `data-open:` compiles to an `[data-open]` presence selector nothing
  // sets, so the panel would pop in untransitioned (EXC-891). Asserted on the source
  // because the class is inert either way — the DOM cannot tell the two spellings apart.
  expect(selectContentSource).toContain("data-[state=open]:animate-in");
  expect(selectContentSource).toContain("data-[state=closed]:animate-out");
  expect(selectContentSource).not.toContain("data-open:");
  expect(selectContentSource).not.toContain("data-closed:");
});

test("the content composes both scroll buttons", () => {
  // bits-ui renders a scroll button only while the viewport is actually scrollable,
  // which never happens under happy-dom's layout-free DOM — so the mounted assertions
  // above cannot see them, and dropping either one would go unnoticed. This is the
  // `Command.Viewport` shape of defect (EXC-1096): a missing sub-part that degrades a
  // real surface silently, here leaving a long option list with no scroll affordance.
  expect(selectContentSource).toContain("<SelectScrollUpButton />");
  expect(selectContentSource).toContain("<SelectScrollDownButton />");
});

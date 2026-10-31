import "@ui/support/mount.ts";
import { describe, expect, test } from "bun:test";

import { render } from "@ui/support/mount.ts";
import { reactiveProps } from "@ui/support/props.svelte.ts";
import PlanSearch from "@/components/PlanSearch.svelte";

const base = {
  query: "foo",
  matchCount: 3,
  currentIndex: 0,
  oncommit: () => {},
  onnext: () => {},
  onprev: () => {},
  onclose: () => {},
};

function input(target: HTMLElement): HTMLInputElement | null {
  // Both halves matter: the slot proves the field is the group's control, and the
  // accessible name is a production contract — DiffPlanView reaches the field by it
  // to refocus a reopened search.
  return target.querySelector<HTMLInputElement>(
    "[data-slot='input-group-control'][aria-label='Search plan']",
  );
}

const count = (target: HTMLElement) =>
  target.querySelector(".search-count")?.textContent?.replace(/\s+/g, " ").trim();

const step = (target: HTMLElement, label: string) =>
  target.querySelector<HTMLButtonElement>(`[aria-label='${label}']`);

const lipHints = (target: HTMLElement) =>
  Array.from(target.querySelectorAll(".search-lip .search-key"));

// A hint's words, less its keycap.
const caption = (hint: Element) =>
  Array.from(hint.childNodes)
    .filter((n) => !(n instanceof Element && n.matches("[data-slot='kbd']")))
    .map((n) => n.textContent)
    .join("")
    .trim();

describe("PlanSearch", () => {
  test("renders the query in the input and the current-of-total counter", () => {
    const { target } = render(PlanSearch, base);
    expect(input(target)?.value).toBe("foo");
    // currentIndex is 0-based; the counter reads 1-based.
    expect(count(target)).toBe("1 / 3");
  });

  // The caps stay out of the input group: an addon's click-to-focus handler would
  // otherwise pull focus into the field from a click between them.
  test("the field leads with the / glyph, and the caps share a tray beside it", () => {
    const { target } = render(PlanSearch, base);
    const group = target.querySelector("[data-slot='input-group']");
    const addons = Array.from(target.querySelectorAll("[data-slot='input-group-addon']"));
    expect(addons.map((a) => a.textContent?.trim())).toEqual(["/"]);
    const tray = target.querySelector(".tray");
    expect(tray?.querySelectorAll("button").length).toBe(3);
    expect(group?.contains(tray ?? null)).toBe(false);
  });

  test("the counter stays blank until there is a query", () => {
    const { target } = render(PlanSearch, { ...base, query: "", matchCount: 0, currentIndex: -1 });
    expect(count(target)).toBe("");
  });

  test("a query with no matches reads No matches, marks the field invalid and disables the steps", () => {
    const { target } = render(PlanSearch, { ...base, matchCount: 0, currentIndex: -1 });
    expect(count(target)).toBe("No matches");
    expect(input(target)?.getAttribute("aria-invalid")).toBe("true");
    expect(step(target, "Next match")?.disabled).toBe(true);
    expect(step(target, "Previous match")?.disabled).toBe(true);
  });

  test("a query with matches leaves the field valid", () => {
    const { target } = render(PlanSearch, base);
    expect(input(target)?.getAttribute("aria-invalid")).not.toBe("true");
  });

  // A committed search must not hold a focusable field: any focused input is an editing
  // context to the shortcut dispatcher, which would swallow the bare n / N.
  test("a committed search stamps its query in place of the field", () => {
    const { target } = render(PlanSearch, { ...base, committed: true });
    expect(input(target) != null).toBe(false);
    expect(target.querySelector(".search-stamp")?.textContent?.replace(/\s+/g, "")).toBe("/foo");
  });

  test("reopening a committed search brings the field back focused, its query selected", () => {
    const props = reactiveProps({ ...base, committed: true });
    const { target, flush } = render(PlanSearch, props);
    props.committed = false;
    flush();
    const field = input(target);
    expect(document.activeElement === field).toBe(true);
    expect([field?.selectionStart, field?.selectionEnd]).toEqual([0, 3]);
  });

  // pressEcho finds the control to press by its aria-keyshortcuts.
  test("next and previous carry n and Shift+N", () => {
    const { target } = render(PlanSearch, base);
    expect(step(target, "Next match")?.getAttribute("aria-keyshortcuts")).toBe("n");
    expect(step(target, "Previous match")?.getAttribute("aria-keyshortcuts")).toBe("Shift+N");
  });

  test("the lip offers the keys that apply in each mode", () => {
    const captions = (props: Partial<typeof base> & { committed?: boolean }) =>
      lipHints(render(PlanSearch, { ...base, hints: true, ...props }).target).map(caption);
    expect(captions({})).toEqual(["go to match", "close"]);
    expect(captions({ matchCount: 0, currentIndex: -1 })).toEqual(["close"]);
    expect(captions({ committed: true })).toEqual(["next", "previous", "edit"]);
  });

  test("the lip's key hints are aria-hidden, so touch devices drop them", () => {
    const { target } = render(PlanSearch, { ...base, hints: true });
    const hints = lipHints(target);
    expect(hints.length).toBeGreaterThan(0);
    expect(hints.every((h) => h.getAttribute("aria-hidden") === "true")).toBe(true);
  });

  test("with hints off the lip holds only the counter", () => {
    const { target } = render(PlanSearch, { ...base, hints: false });
    expect(lipHints(target).length).toBe(0);
    expect(count(target)).toBe("1 / 3");
  });

  test("the step and close buttons fire their callbacks", () => {
    let next = 0;
    let prev = 0;
    let closed = 0;
    const { target } = render(PlanSearch, {
      ...base,
      onnext: () => next++,
      onprev: () => prev++,
      onclose: () => closed++,
    });
    step(target, "Next match")?.click();
    step(target, "Previous match")?.click();
    step(target, "Close search")?.click();
    expect([next, prev, closed]).toEqual([1, 1, 1]);
  });

  test("the closing prop toggles the collapse-back animation class", () => {
    const open = render(PlanSearch, base);
    // Boolean, not toBeNull, per the happy-dom circular-node serialization hang.
    expect(open.target.querySelector(".plan-search.closing") !== null).toBe(false);
    const closing = render(PlanSearch, { ...base, closing: true });
    expect(closing.target.querySelector(".plan-search.closing") !== null).toBe(true);
  });

  test("Enter commits and Escape closes from the focused field", () => {
    let committed = 0;
    let closed = 0;
    const { target } = render(PlanSearch, {
      ...base,
      oncommit: () => committed++,
      onclose: () => closed++,
    });
    const el = input(target)!;
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect([committed, closed]).toEqual([1, 1]);
  });
});

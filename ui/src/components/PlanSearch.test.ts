import "@ui/test-mount.ts";
import { describe, expect, test } from "bun:test";

import { render } from "@ui/test-mount.ts";
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

function input(target: HTMLElement): HTMLInputElement {
  return target.querySelector<HTMLInputElement>("[data-slot='input-group-control']")!;
}

describe("PlanSearch", () => {
  test("renders the query in the input and the current-of-total counter", () => {
    const { target } = render(PlanSearch, base);
    expect(input(target).value).toBe("foo");
    // currentIndex is 0-based; the counter reads 1-based.
    expect(target.querySelector(".search-count")?.textContent?.replace(/\s+/g, "")).toBe("1/3");
  });

  // The leading `/` glyph and the step / close chips ride input-group addon slots
  // (EXC-1113) rather than a hand-rolled flex row that spaces them by gap.
  test("the row composes input-group with the / glyph and the chips in addons", () => {
    const { target } = render(PlanSearch, base);
    expect(target.querySelector("[data-slot='input-group']") !== null).toBe(true);
    const addons = Array.from(target.querySelectorAll("[data-slot='input-group-addon']"));
    expect(addons.length).toBe(2);
    expect(addons[0]?.getAttribute("data-align")).toBe("inline-start");
    expect(addons[0]?.textContent?.trim()).toBe("/");
    expect(addons[1]?.getAttribute("data-align")).toBe("inline-end");
    expect(addons[1]?.querySelectorAll("button").length).toBe(3);
  });

  test("counter reads 0 / 0 with no matches, and prev/next are disabled", () => {
    const { target } = render(PlanSearch, { ...base, matchCount: 0, currentIndex: -1 });
    expect(target.querySelector(".search-count")?.textContent?.replace(/\s+/g, "")).toBe("0/0");
    expect(target.querySelector<HTMLButtonElement>("[aria-label='Next match']")?.disabled).toBe(
      true,
    );
    expect(target.querySelector<HTMLButtonElement>("[aria-label='Previous match']")?.disabled).toBe(
      true,
    );
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
    target.querySelector<HTMLButtonElement>("[aria-label='Next match']")?.click();
    target.querySelector<HTMLButtonElement>("[aria-label='Previous match']")?.click();
    target.querySelector<HTMLButtonElement>("[aria-label='Close search']")?.click();
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
    const el = input(target);
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect([committed, closed]).toEqual([1, 1]);
  });
});

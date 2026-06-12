import "../../../test-setup.ts";
import { describe, expect, test } from "bun:test";
import { scrollToLine } from "./scroll.ts";

// @pierre/diffs renders each source line as a <div data-line="N"> inside the
// container's shadow root. scrollToLine finds that row and scrolls it into
// view; these tests build the shadow root by hand (no library mount needed).

function container(lines: number[]): { el: HTMLElement; scrolled: Map<number, boolean> } {
  const el = document.createElement("div");
  const root = el.attachShadow({ mode: "open" });
  const scrolled = new Map<number, boolean>();
  for (const n of lines) {
    const row = document.createElement("div");
    row.setAttribute("data-line", String(n));
    // happy-dom has no layout, so stub scrollIntoView to record the call.
    row.scrollIntoView = () => scrolled.set(n, true);
    root.append(row);
  }
  return { el, scrolled };
}

describe("scrollToLine", () => {
  test("scrolls the matching line's row into view and returns true", () => {
    const { el, scrolled } = container([1, 5, 9]);
    expect(scrollToLine(el, 5)).toBe(true);
    expect(scrolled.get(5)).toBe(true);
    expect(scrolled.has(1)).toBe(false);
    expect(scrolled.has(9)).toBe(false);
  });

  test("returns false when no row carries the requested line", () => {
    const { el, scrolled } = container([1, 2, 3]);
    expect(scrollToLine(el, 99)).toBe(false);
    expect(scrolled.size).toBe(0);
  });

  test("returns false when the container has no shadow root", () => {
    const el = document.createElement("div");
    expect(scrollToLine(el, 1)).toBe(false);
  });
});

import "../../../test-setup.ts";
import { afterEach, describe, expect, test } from "bun:test";
import { scrollToLine } from "./scroll.ts";

// @pierre/diffs renders each source line as a <div data-line="N"> inside the
// container's shadow root. scrollToLine finds that row and scrolls the nearest
// scrollable ancestor so the row rests near the top; these tests build the
// shadow root and a scroll container by hand (no library mount needed). happy-dom
// has no layout, so getBoundingClientRect is all zeros and the computed target is
// 0 — enough to assert the call shape, container resolution, and fallback.

interface Harness {
  host: HTMLElement;
  scrollCalls: ScrollToOptions[];
}

/** A scroll container wrapping a shadow host whose root holds the given rows. */
function harness(lines: number[], scrollable = true): Harness {
  const scroller = document.createElement("div");
  if (scrollable) scroller.style.overflowY = "auto";
  const host = document.createElement("div");
  const root = host.attachShadow({ mode: "open" });
  for (const n of lines) {
    const row = document.createElement("div");
    row.setAttribute("data-line", String(n));
    root.append(row);
  }
  const scrollCalls: ScrollToOptions[] = [];
  scroller.scrollTo = ((opts: ScrollToOptions) =>
    scrollCalls.push(opts)) as typeof scroller.scrollTo;
  scroller.append(host);
  document.body.append(scroller);
  return { host, scrollCalls };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("scrollToLine", () => {
  test("scrolls the surrounding container to the matching row and returns true", () => {
    const { host, scrollCalls } = harness([1, 5, 9]);
    expect(scrollToLine(host, 5)).toBe(true);
    expect(scrollCalls.length).toBeGreaterThanOrEqual(1);
    // Smooth by default (no reduced-motion preference in the test env).
    expect(scrollCalls[0]?.behavior).toBe("smooth");
    expect(typeof scrollCalls[0]?.top).toBe("number");
  });

  test("returns false when no row carries the requested line", () => {
    const { host, scrollCalls } = harness([1, 2, 3]);
    expect(scrollToLine(host, 99)).toBe(false);
    expect(scrollCalls.length).toBe(0);
  });

  test("returns false when the container has no shadow root", () => {
    const el = document.createElement("div");
    document.body.append(el);
    expect(scrollToLine(el, 1)).toBe(false);
  });

  test("falls back to the row's scrollIntoView when there is no scroll container", () => {
    const { host } = harness([1, 5, 9], false);
    const row = host.shadowRoot?.querySelector<HTMLElement>('[data-line="5"]');
    let scrolledIntoView = false;
    if (row != null) row.scrollIntoView = () => (scrolledIntoView = true);
    expect(scrollToLine(host, 5)).toBe(true);
    expect(scrolledIntoView).toBe(true);
  });
});

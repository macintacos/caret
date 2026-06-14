import "../../test-mount.ts";
import { describe, expect, test } from "bun:test";
import type { TocHeading } from "../lib/toc.ts";
import { capture, render } from "../../test-mount.ts";
import SourceToc from "./SourceToc.svelte";

const headings: TocHeading[] = [
  { level: 1, text: "Context", line: 1 },
  { level: 2, text: "Approach", line: 5 },
  { level: 2, text: "Verification", line: 9 },
];

function rows(target: HTMLElement): HTMLElement[] {
  return [...target.querySelectorAll<HTMLElement>(".toc-row")];
}

function filterInput(target: HTMLElement): HTMLInputElement {
  return target.querySelector<HTMLInputElement>(".toc-filter")!;
}

describe("SourceToc visibility (shouldShowToc)", () => {
  test("renders nothing with no headings", () => {
    const { target } = render(SourceToc, { headings: [], activeLine: null, onJump: () => {} });
    expect(target.querySelector(".source-toc")).toBeNull();
  });

  test("renders nothing with a single heading", () => {
    const { target } = render(SourceToc, {
      headings: [{ level: 1, text: "Only", line: 1 }],
      activeLine: null,
      onJump: () => {},
    });
    expect(target.querySelector(".source-toc")).toBeNull();
  });

  test("renders the pane from two headings up", () => {
    const { target } = render(SourceToc, { headings, activeLine: null, onJump: () => {} });
    expect(target.querySelector(".source-toc")).not.toBeNull();
    expect(rows(target)).toHaveLength(3);
  });
});

describe("SourceToc content", () => {
  test("each row shows the heading text and a level class", () => {
    const { target } = render(SourceToc, { headings, activeLine: null, onJump: () => {} });
    const r = rows(target);
    expect(r[0]!.textContent).toContain("Context");
    expect(r[0]!.classList.contains("lvl-1")).toBe(true);
    expect(r[1]!.classList.contains("lvl-2")).toBe(true);
  });

  test("marks the active heading row by its line", () => {
    const { target } = render(SourceToc, { headings, activeLine: 5, onJump: () => {} });
    const r = rows(target);
    expect(r[1]!.classList.contains("active")).toBe(true);
    expect(r[1]!.getAttribute("aria-current")).toBe("location");
    expect(r[0]!.classList.contains("active")).toBe(false);
  });

  // The per-level lvl-{n} class is the only positioning hook the indent-guide
  // rules key off (each nested level paints its own vertical guide via a ::before
  // rule selected by this class). Guard that every row carries its level class so
  // a future markup change can't silently strip the guides' anchor; happy-dom has
  // no layout, so the guide's paint itself is an e2e/browser concern, not this.
  test("every nested row carries its level class so the indent guides anchor", () => {
    const nested: TocHeading[] = [
      { level: 1, text: "Top", line: 1 },
      { level: 2, text: "Mid", line: 3 },
      { level: 3, text: "Deep", line: 5 },
    ];
    const { target } = render(SourceToc, { headings: nested, activeLine: null, onJump: () => {} });
    const r = rows(target);
    expect(r[0]!.classList.contains("lvl-1")).toBe(true);
    expect(r[1]!.classList.contains("lvl-2")).toBe(true);
    expect(r[2]!.classList.contains("lvl-3")).toBe(true);
  });
});

describe("SourceToc filtering (hide non-matches)", () => {
  test("typing a query hides non-matching rows", async () => {
    const { target, flush } = render(SourceToc, {
      headings,
      activeLine: null,
      onJump: () => {},
    });
    const input = filterInput(target);
    input.value = "ver";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    flush();
    const r = rows(target);
    expect(r).toHaveLength(1);
    expect(r[0]!.textContent).toContain("Verification");
  });

  test("clearing the query restores all rows", async () => {
    const { target, flush } = render(SourceToc, {
      headings,
      activeLine: null,
      onJump: () => {},
    });
    const input = filterInput(target);
    input.value = "ver";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    flush();
    expect(rows(target)).toHaveLength(1);
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    flush();
    expect(rows(target)).toHaveLength(3);
  });
});

describe("SourceToc jump", () => {
  test("clicking a row jumps to its line", () => {
    const jumped = capture<number>();
    const { target } = render(SourceToc, { headings, activeLine: null, onJump: jumped.cb });
    rows(target)[2]!.click();
    expect(jumped.last()).toBe(9);
  });
});

describe("SourceToc keyboard navigation", () => {
  test("ArrowDown then Enter jumps to the next visible row", () => {
    const jumped = capture<number>();
    const { target } = render(SourceToc, { headings, activeLine: null, onJump: jumped.cb });
    const input = filterInput(target);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    // Cursor starts before the first row; one ArrowDown lands on row 0.
    expect(jumped.last()).toBe(1);
  });

  test("ArrowDown twice then Enter jumps to the third visible row", () => {
    const jumped = capture<number>();
    const { target } = render(SourceToc, { headings, activeLine: null, onJump: jumped.cb });
    const input = filterInput(target);
    for (let i = 0; i < 3; i++) {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    }
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(jumped.last()).toBe(9);
  });

  test("ArrowUp clamps at the first row", () => {
    const jumped = capture<number>();
    const { target } = render(SourceToc, { headings, activeLine: null, onJump: jumped.cb });
    const input = filterInput(target);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(jumped.last()).toBe(1);
  });

  test("keyboard nav runs over the filtered (visible) rows only", () => {
    const jumped = capture<number>();
    const { target, flush } = render(SourceToc, {
      headings,
      activeLine: null,
      onJump: jumped.cb,
    });
    const input = filterInput(target);
    input.value = "app";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    flush();
    // Only "Approach" (line 5) is visible; ArrowDown lands on it.
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(jumped.last()).toBe(5);
  });

  test("scrolls the cursored row into view so keyboard focus stays visible", () => {
    const { target } = render(SourceToc, { headings, activeLine: null, onJump: () => {} });
    const r = rows(target);
    const scrolled: number[] = [];
    // happy-dom has no layout, so record which row index scrollIntoView ran on.
    r.forEach((row, i) => {
      row.scrollIntoView = () => scrolled.push(i);
    });
    const input = filterInput(target);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    // Two ArrowDowns land the cursor on row index 1.
    expect(scrolled.at(-1)).toBe(1);
  });
});

import "@ui/support/setup.ts";
import { expect, test } from "bun:test";

import {
  type CursorContext,
  type CursorMotion,
  resolveCursorLine,
  tagCursorRow,
} from "$lib/diffview/lineCursor.ts";

// A 10-line document with headings on lines 1, 4, 8; blank lines on 2, 5, 9; a
// 4-line half-page; the reading position (seed) at line 3. Individual tests
// override fields as needed.
function ctx(over: Partial<CursorContext> = {}): CursorContext {
  return {
    cursor: 3,
    lineCount: 10,
    headingLines: [1, 4, 8],
    blankLines: [2, 5, 9],
    halfPage: 4,
    seed: 3,
    ...over,
  };
}

function resolve(motion: CursorMotion, over: Partial<CursorContext> = {}): number {
  return resolveCursorLine(motion, ctx(over));
}

test("line motions step one line each way", () => {
  expect(resolve("down")).toBe(4);
  expect(resolve("up")).toBe(2);
});

test("line motions clamp at both ends of the document", () => {
  expect(resolve("down", { cursor: 10 })).toBe(10);
  expect(resolve("up", { cursor: 1 })).toBe(1);
});

test("half-page motions jump by the half-page size and clamp", () => {
  expect(resolve("halfDown")).toBe(7);
  expect(resolve("halfUp", { cursor: 8 })).toBe(4);
  expect(resolve("halfDown", { cursor: 8 })).toBe(10);
  expect(resolve("halfUp")).toBe(1);
});

test("top and bottom go to the document extremes", () => {
  expect(resolve("top", { cursor: 5 })).toBe(1);
  expect(resolve("bottom", { cursor: 5 })).toBe(10);
});

test("heading motions move to the next / previous heading line", () => {
  expect(resolve("nextHeading", { cursor: 3 })).toBe(4);
  expect(resolve("nextHeading", { cursor: 4 })).toBe(8);
  expect(resolve("prevHeading", { cursor: 8 })).toBe(4);
  expect(resolve("prevHeading", { cursor: 3 })).toBe(1);
});

test("heading motions stay put when there is no heading in that direction", () => {
  expect(resolve("nextHeading", { cursor: 8 })).toBe(8);
  expect(resolve("nextHeading", { cursor: 9 })).toBe(9);
  expect(resolve("prevHeading", { cursor: 1 })).toBe(1);
});

test("heading motions are a no-op when the document has no headings", () => {
  expect(resolve("nextHeading", { headingLines: [] })).toBe(3);
  expect(resolve("prevHeading", { headingLines: [] })).toBe(3);
});

test("blank-line motions move to the next / previous blank line", () => {
  expect(resolve("nextBlank", { cursor: 3 })).toBe(5);
  expect(resolve("nextBlank", { cursor: 5 })).toBe(9);
  expect(resolve("prevBlank", { cursor: 5 })).toBe(2);
  expect(resolve("prevBlank", { cursor: 3 })).toBe(2);
});

test("blank-line motions stay put when there is no blank in that direction", () => {
  expect(resolve("nextBlank", { cursor: 9 })).toBe(9);
  expect(resolve("prevBlank", { cursor: 2 })).toBe(2);
  expect(resolve("prevBlank", { cursor: 1 })).toBe(1);
});

test("blank-line motions are a no-op when the document has no blank lines", () => {
  expect(resolve("nextBlank", { blankLines: [] })).toBe(3);
  expect(resolve("prevBlank", { blankLines: [] })).toBe(3);
});

test("a null cursor honors blank-line motions from the reading position", () => {
  expect(resolve("nextBlank", { cursor: null, seed: 3 })).toBe(5);
  expect(resolve("prevBlank", { cursor: null, seed: 6 })).toBe(5);
});

test("a null cursor reveals at the reading position for relative motions", () => {
  for (const m of ["down", "up", "halfDown", "halfUp"] as const) {
    expect(resolve(m, { cursor: null, seed: 3 })).toBe(3);
  }
});

test("a null cursor still honors absolute motions", () => {
  expect(resolve("top", { cursor: null, seed: 3 })).toBe(1);
  expect(resolve("bottom", { cursor: null, seed: 3 })).toBe(10);
  expect(resolve("nextHeading", { cursor: null, seed: 3 })).toBe(4);
  expect(resolve("prevHeading", { cursor: null, seed: 3 })).toBe(1);
});

test("the reveal seed is clamped into the document", () => {
  expect(resolve("down", { cursor: null, seed: 99 })).toBe(10);
  expect(resolve("up", { cursor: null, seed: 0 })).toBe(1);
});

test("a single-line document clamps every motion to line 1", () => {
  const one: Partial<CursorContext> = { lineCount: 1, headingLines: [1], cursor: 1 };
  expect(resolve("down", one)).toBe(1);
  expect(resolve("bottom", one)).toBe(1);
  expect(resolve("halfDown", one)).toBe(1);
});

// tagCursorRow marks the shadow row for the cursor line so the override sheet
// paints its band; a hand-built DOM stands in for the library's shadow root
// (the live behavior is covered by e2e).
function rows(...lines: number[]): HTMLElement {
  const host = document.createElement("div");
  for (const n of lines) {
    const row = document.createElement("div");
    row.setAttribute("data-line", String(n));
    host.appendChild(row);
  }
  return host;
}

function cursorLine(host: HTMLElement): string | null {
  return host.querySelector("[data-caret-cursor]")?.getAttribute("data-line") ?? null;
}

// A gutter + content grid, like the library's shadow root: each line has a gutter
// cell (data-column-number) and a content cell (data-line).
function grid(...lines: number[]): HTMLElement {
  const host = document.createElement("div");
  const gutter = document.createElement("div");
  gutter.setAttribute("data-gutter", "");
  const content = document.createElement("div");
  content.setAttribute("data-content", "");
  for (const n of lines) {
    const g = document.createElement("div");
    g.setAttribute("data-column-number", String(n));
    gutter.appendChild(g);
    const c = document.createElement("div");
    c.setAttribute("data-line", String(n));
    content.appendChild(c);
  }
  host.append(gutter, content);
  return host;
}

test("tagCursorRow marks exactly the cursor line", () => {
  const host = rows(1, 2, 3);
  tagCursorRow(host, 2);
  expect(cursorLine(host)).toBe("2");
  expect(host.querySelectorAll("[data-caret-cursor]").length).toBe(1);
});

test("tagCursorRow marks both the content cell and its gutter cell", () => {
  const host = grid(1, 2, 3);
  tagCursorRow(host, 2);
  expect(host.querySelector("[data-line][data-caret-cursor]")?.getAttribute("data-line")).toBe("2");
  expect(
    host
      .querySelector("[data-column-number][data-caret-cursor]")
      ?.getAttribute("data-column-number"),
  ).toBe("2");
  expect(host.querySelectorAll("[data-caret-cursor]").length).toBe(2);
});

test("tagCursorRow moves the tag off the old line", () => {
  const host = rows(1, 2, 3);
  tagCursorRow(host, 2);
  tagCursorRow(host, 3);
  expect(cursorLine(host)).toBe("3");
  expect(host.querySelectorAll("[data-caret-cursor]").length).toBe(1);
});

test("tagCursorRow clears the tag when the line is null or absent", () => {
  const host = rows(1, 2, 3);
  tagCursorRow(host, 2);
  tagCursorRow(host, null);
  expect(cursorLine(host)).toBe(null);
  tagCursorRow(host, 2);
  tagCursorRow(host, 99); // no such row — still clears the prior tag
  expect(cursorLine(host)).toBe(null);
});

test("tagCursorRow is a no-op on a null root", () => {
  expect(() => tagCursorRow(null, 1)).not.toThrow();
});

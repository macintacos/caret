import "@ui/support/setup.ts";
import { describe, expect, test } from "bun:test";

import { fillLines, gutterContentRoot, openComment } from "@ui/support/diffview-dom.ts";
import { unwrappedSlice } from "$lib/diffview/cardSlice.ts";

// unwrappedSlice answers "which children does this card take" for both card kinds, so its
// branches are pinned here rather than twice over in the two caller suites. The refusal
// branches matter most: an unrecognized DOM shape (a missing, reordered, or nested row)
// must produce no card rather than a malformed one.

/** A slice's members by their keying attribute, or `annotation` for the rows the library
 * interleaves — `null` passed through, so a refusal is distinguishable from an empty run. */
function keys(slice: Element[] | null, attr = "data-line"): string[] | null {
  return slice?.map((el) => el.getAttribute(attr) ?? "annotation") ?? null;
}

/** A content column of `lineCount` rows, with the root `openComment` needs to find them. */
function content(lineCount: number): { root: HTMLElement; content: HTMLElement } {
  const parts = gutterContentRoot();
  fillLines(parts.content, lineCount);
  return { root: parts.root, content: parts.content };
}

describe("unwrappedSlice", () => {
  test("takes the contiguous run between the range's first and last line", () => {
    const { content: column } = content(5);
    expect(keys(unwrappedSlice(column, "data-line", [2, 3, 4]))).toEqual(["2", "3", "4"]);
  });

  test("absorbs an annotation row interleaved mid-range", () => {
    const { root, content: column } = content(5);
    openComment(root, 3);
    expect(keys(unwrappedSlice(column, "data-line", [2, 3, 4]))).toEqual([
      "2",
      "3",
      "annotation",
      "4",
    ]);
  });

  test("absorbs an annotation anchored to the range's LAST line", () => {
    // The trailing while-loop's whole purpose: the library emits the row after its own, so
    // stopping at `last` would draw a comment on the final line at a different width from
    // one on any other line of the same card.
    const { root, content: column } = content(5);
    openComment(root, 4);
    expect(keys(unwrappedSlice(column, "data-line", [2, 3, 4]))).toEqual([
      "2",
      "3",
      "4",
      "annotation",
    ]);
  });

  test("stops at a trailing sibling that is not an annotation row", () => {
    const { content: column } = content(5);
    const stray = document.createElement("div");
    column.insertBefore(stray, column.children[4] ?? null);
    expect(keys(unwrappedSlice(column, "data-line", [2, 3, 4]))).toEqual(["2", "3", "4"]);
  });

  test("refuses a range whose first line is absent", () => {
    const { content: column } = content(5);
    column.querySelector('[data-line="2"]')?.remove();
    expect(unwrappedSlice(column, "data-line", [2, 3, 4])).toBeNull();
  });

  test("refuses a range with a line missing mid-run", () => {
    const { content: column } = content(5);
    column.querySelector('[data-line="3"]')?.remove();
    expect(unwrappedSlice(column, "data-line", [2, 3, 4])).toBeNull();
  });

  test("refuses a range whose lines are out of order in the column", () => {
    const { content: column } = content(5);
    const third = column.querySelector('[data-line="3"]');
    const fourth = column.querySelector('[data-line="4"]');
    if (third !== null && fourth !== null) column.insertBefore(fourth, third);
    expect(unwrappedSlice(column, "data-line", [2, 3, 4])).toBeNull();
  });

  test("refuses a range whose rows are not all direct children", () => {
    // A nested row is one insertBefore would throw NotFoundError on, taking every
    // decoration below it down with the repaint pass.
    const { content: column } = content(5);
    const third = column.querySelector('[data-line="3"]');
    const wrapper = document.createElement("div");
    if (third !== null) {
      column.insertBefore(wrapper, third);
      wrapper.appendChild(third);
    }
    expect(unwrappedSlice(column, "data-line", [2, 3, 4])).toBeNull();
  });

  test("refuses an empty range", () => {
    const { content: column } = content(5);
    expect(unwrappedSlice(column, "data-line", [])).toBeNull();
  });

  test("reads the gutter column by its own key attribute, buffer included", () => {
    // The helper is attribute-agnostic precisely so both columns come from one walk — the
    // two lists agreeing by construction is what keeps the mirrors balanced.
    const { root, gutter, content: column } = gutterContentRoot();
    fillLines(column, 5);
    for (let n = 1; n <= 5; n++) {
      const cell = document.createElement("div");
      cell.setAttribute("data-column-number", String(n));
      gutter.appendChild(cell);
    }
    openComment(root, 3);
    expect(
      keys(unwrappedSlice(gutter, "data-column-number", [2, 3, 4]), "data-column-number"),
    ).toEqual(["2", "3", "annotation", "4"]);
  });
});

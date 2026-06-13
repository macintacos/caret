import "../../../test-setup.ts";
import { afterEach, describe, expect, test } from "bun:test";
import {
  annotationSlotName,
  shouldCommentOnLineClick,
  slotInto,
  toLineAnnotations,
} from "./annotationSlot.ts";

afterEach(() => {
  document.body.replaceChildren();
});

describe("annotationSlotName", () => {
  test("matches the library's per-line slot name", () => {
    expect(annotationSlotName(40)).toBe("annotation-40");
  });
});

describe("toLineAnnotations", () => {
  test("emits one annotation per line, deduped and sorted", () => {
    expect(toLineAnnotations([5, 3, 5, 8, 3])).toEqual([
      { lineNumber: 3 },
      { lineNumber: 5 },
      { lineNumber: 8 },
    ]);
  });

  test("is empty for no lines", () => {
    expect(toLineAnnotations([])).toEqual([]);
  });
});

describe("shouldCommentOnLineClick", () => {
  const ok = { numberColumn: false, linkConsumed: false, selectionCollapsed: true };
  test("opens on a plain content click with no selection", () => {
    expect(shouldCommentOnLineClick(ok)).toBe(true);
  });
  test("stands down on the number column (gutter owns it)", () => {
    expect(shouldCommentOnLineClick({ ...ok, numberColumn: true })).toBe(false);
  });
  test("stands down when the click opened a link", () => {
    expect(shouldCommentOnLineClick({ ...ok, linkConsumed: true })).toBe(false);
  });
  test("stands down while text is selected", () => {
    expect(shouldCommentOnLineClick({ ...ok, selectionCollapsed: false })).toBe(false);
  });
});

describe("slotInto", () => {
  test("projects the node into the host with the line's slot name", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const node = document.createElement("div");
    slotInto(node, { host, line: 7 });
    expect(node.slot).toBe("annotation-7");
    expect(node.dataset.annotationSlot).toBe("");
    expect(node.style.whiteSpace).toBe("normal");
    expect(node.parentElement).toBe(host);
  });

  test("re-slots when the line changes and removes the node on destroy", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const node = document.createElement("div");
    const action = slotInto(node, { host, line: 7 });
    action.update({ host, line: 9 });
    expect(node.slot).toBe("annotation-9");
    expect(node.parentElement).toBe(host);
    action.destroy();
    expect(node.parentElement).toBeNull();
  });

  test("sets the slot name but does not place the node until the host exists", () => {
    const node = document.createElement("div");
    const action = slotInto(node, { host: undefined, line: 3 });
    expect(node.slot).toBe("annotation-3");
    expect(node.parentElement).toBeNull();
    const host = document.createElement("div");
    document.body.append(host);
    action.update({ host, line: 3 });
    expect(node.parentElement).toBe(host);
  });
});

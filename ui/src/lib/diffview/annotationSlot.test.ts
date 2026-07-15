import "../../../test-setup.ts";
import { afterEach, describe, expect, test } from "bun:test";

import {
  annotationSlotName,
  groupAnnotationsByLine,
  shouldCommentOnLineClick,
  slotInto,
  toLineAnnotations,
} from "$lib/diffview/annotationSlot.ts";

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

describe("groupAnnotationsByLine", () => {
  const at = (id: string, line: number) => ({ id, endLine: line });
  const line = (a: { endLine: number }) => a.endLine;

  test("buckets annotations sharing a line into one ordered group", () => {
    const groups = groupAnnotationsByLine([at("a", 7), at("b", 7)], line);
    expect(groups).toEqual([{ line: 7, annotations: [at("a", 7), at("b", 7)] }]);
  });

  test("orders groups by line ascending, preserving input order within a line", () => {
    const groups = groupAnnotationsByLine([at("a", 9), at("b", 3), at("c", 9), at("d", 3)], line);
    expect(groups).toEqual([
      { line: 3, annotations: [at("b", 3), at("d", 3)] },
      { line: 9, annotations: [at("a", 9), at("c", 9)] },
    ]);
  });

  test("a single annotation yields one group of one", () => {
    expect(groupAnnotationsByLine([at("solo", 4)], line)).toEqual([
      { line: 4, annotations: [at("solo", 4)] },
    ]);
  });

  test("is empty for no annotations", () => {
    expect(groupAnnotationsByLine([], line)).toEqual([]);
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
    // Prose, not code: the node also opts out of the code column's monospace
    // font so a rendered-markdown comment reads as sans-serif prose (EXC-802).
    expect(node.style.fontFamily).toBe("var(--font-sans)");
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

  test("keeps a focused descendant focused across the relocation into the host", () => {
    // The composer autofocuses its editor before slotInto relocates it into the
    // library slot; the appendChild move blurs a focused descendant, so slotInto
    // must restore focus — otherwise the reviewer has to click the field again.
    const host = document.createElement("div");
    document.body.append(host);
    const node = document.createElement("div");
    const input = document.createElement("input");
    node.append(input);
    document.body.append(node); // connected, like the composer before it is slotted
    input.focus();
    expect(document.activeElement).toBe(input);

    slotInto(node, { host, line: 4 });

    expect(node.parentElement).toBe(host);
    expect(document.activeElement).toBe(input);
  });
});

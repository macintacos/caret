import "../../test-setup.ts";
import { beforeEach, describe, expect, test } from "bun:test";
import { captureSelection } from "./selection.ts";

function container(html: string): HTMLElement {
  const root = document.createElement("article");
  root.className = "plan";
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

/** Selects [start,end) chars within the first text node path of `block`. */
function selectRange(block: HTMLElement, startOffset: number, endOffset: number): Range {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  const node = walker.nextNode() as Text;
  const range = document.createRange();
  range.setStart(node, startOffset);
  range.setEnd(node, endOffset);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  return range;
}

describe("captureSelection", () => {
  test("captures blockId, offsets and quote for a selection inside a block", () => {
    const root = container('<p id="b0">Deploy on Friday afternoon.</p>');
    const block = root.querySelector("#b0") as HTMLElement;
    selectRange(block, 0, 6); // "Deploy"

    const cap = captureSelection(root);
    expect(cap).not.toBeNull();
    expect(cap!.blockId).toBe("b0");
    expect(cap!.startOffset).toBe(0);
    expect(cap!.endOffset).toBe(6);
    expect(cap!.quote).toBe("Deploy");
  });

  test("captures correct offsets for a mid-block selection", () => {
    const root = container('<p id="b2">alpha beta gamma</p>');
    const block = root.querySelector("#b2") as HTMLElement;
    selectRange(block, 6, 10); // "beta"

    const cap = captureSelection(root);
    expect(cap!.blockId).toBe("b2");
    expect(cap!.startOffset).toBe(6);
    expect(cap!.endOffset).toBe(10);
    expect(cap!.quote).toBe("beta");
  });

  test("returns null when the selection is collapsed", () => {
    const root = container('<p id="b0">Hello</p>');
    const block = root.querySelector("#b0") as HTMLElement;
    selectRange(block, 2, 2);
    expect(captureSelection(root)).toBeNull();
  });

  test("returns null when there is no selection", () => {
    const root = container('<p id="b0">Hello</p>');
    window.getSelection()!.removeAllRanges();
    expect(captureSelection(root)).toBeNull();
  });

  test("uses the nearest ancestor carrying a b-id as the blockId", () => {
    const root = container('<p id="b3">prefix <strong>bold word</strong> suffix</p>');
    const block = root.querySelector("#b3") as HTMLElement;
    const strongText = block.querySelector("strong")!.firstChild as Text;
    const range = document.createRange();
    range.setStart(strongText, 0);
    range.setEnd(strongText, 4); // "bold"
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    const cap = captureSelection(root);
    expect(cap!.blockId).toBe("b3");
    expect(cap!.quote).toBe("bold");
    // textContent = "prefix bold word suffix"; "bold" starts at 7
    expect(cap!.startOffset).toBe(7);
    expect(cap!.endOffset).toBe(11);
  });

  test("returns null when selection is outside the plan root", () => {
    const root = container('<p id="b0">inside</p>');
    const outside = document.createElement("p");
    outside.textContent = "outside";
    document.body.appendChild(outside);
    const t = outside.firstChild as Text;
    const range = document.createRange();
    range.setStart(t, 0);
    range.setEnd(t, 7);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    expect(captureSelection(root)).toBeNull();
  });
});

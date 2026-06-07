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

  test("returns null for a whitespace-only selection", () => {
    const root = container('<p id="b0">a    b</p>');
    const block = root.querySelector("#b0") as HTMLElement;
    selectRange(block, 1, 5); // the run of spaces between a and b
    expect(captureSelection(root)).toBeNull();
  });
});

// The W3C TextQuoteSelector context (EXC-543): up to 32 chars of the block's
// textContent on each side of the quote, clamped at the block boundaries.
describe("captureSelection prefix/suffix context", () => {
  test("captures the text immediately before and after the quote", () => {
    const root = container('<p id="b0">alpha beta gamma</p>');
    const block = root.querySelector("#b0") as HTMLElement;
    selectRange(block, 6, 10); // "beta"
    const cap = captureSelection(root);
    expect(cap!.prefix).toBe("alpha ");
    expect(cap!.suffix).toBe(" gamma");
  });

  test("clamps to empty at the start and end of the block", () => {
    const root = container('<p id="b0">Deploy now</p>');
    const block = root.querySelector("#b0") as HTMLElement;
    selectRange(block, 0, 6); // "Deploy" — nothing precedes it
    const cap = captureSelection(root);
    expect(cap!.prefix).toBe("");
    expect(cap!.suffix).toBe(" now");

    selectRange(block, 7, 10); // "now" — nothing follows it
    const cap2 = captureSelection(root);
    expect(cap2!.prefix).toBe("Deploy ");
    expect(cap2!.suffix).toBe("");
  });

  test("caps each side at 32 chars", () => {
    // 40 'x' before and 40 'y' after the quote "Q".
    const before = "x".repeat(40);
    const after = "y".repeat(40);
    const root = container(`<p id="b0">${before}Q${after}</p>`);
    const block = root.querySelector("#b0") as HTMLElement;
    selectRange(block, 40, 41); // the lone "Q"
    const cap = captureSelection(root);
    expect(cap!.quote).toBe("Q");
    expect(cap!.prefix).toBe("x".repeat(32));
    expect(cap!.suffix).toBe("y".repeat(32));
  });
});

// nearestBlock is module-private; it is exercised through its only caller,
// captureSelection. These cases pin its block-resolution branches: the /^b\d+$/
// id match, the climb up through nested markup, the innermost-block tiebreak,
// and the root-boundary stop that yields no block.
describe("captureSelection block resolution (nearestBlock)", () => {
  test("returns null when the selection is inside root but in no b-block", () => {
    // Loose prose directly under root with no id="b{n}" ancestor.
    const root = container("loose prose with no structural block");
    selectRange(root, 0, 5);
    expect(captureSelection(root)).toBeNull();
  });

  test("returns null when the enclosing element id is not the b{n} shape", () => {
    const root = container('<h2 id="header">Title text</h2>');
    const heading = root.querySelector("#header") as HTMLElement;
    selectRange(heading, 0, 5); // "Title"
    expect(captureSelection(root)).toBeNull();
  });

  test("resolves the block from a deeply nested selection node", () => {
    const root = container('<p id="b7">lead <strong><em>deep text</em></strong> tail</p>');
    const em = root.querySelector("em") as HTMLElement;
    selectRange(em, 0, 4); // "deep", several elements below the b-block
    const cap = captureSelection(root);
    expect(cap!.blockId).toBe("b7");
    expect(cap!.quote).toBe("deep");
  });

  test("picks the innermost b-block when blocks are nested", () => {
    const root = container('<div id="b1"><div id="b2">inner content</div></div>');
    const inner = root.querySelector("#b2") as HTMLElement;
    selectRange(inner, 0, 5); // "inner"
    const cap = captureSelection(root);
    expect(cap!.blockId).toBe("b2"); // nearest ancestor wins over the outer b1
  });
});

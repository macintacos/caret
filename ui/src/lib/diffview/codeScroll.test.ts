import "../../../test-setup.ts";
import { describe, expect, test } from "bun:test";
import { attachCodeBlockScrollSync, syncCodeBlockScroll } from "./codeScroll.ts";

// EXC-729: a fenced code block renders as independent [data-line] rows (no wrapper),
// and coreStyles.ts makes each code row its own horizontal scroll container. This module
// mirrors a scrolled code row's scrollLeft onto the other rows of the SAME block so the
// block scrolls as one unit (keeping tabular content aligned). The fixture below mirrors
// the @pierre/diffs content column and the data-code-line / -start / -end tags codeBlocks.ts
// applies; happy-dom stores scrollLeft as a plain settable property (no clamping), so the
// sync propagation can be asserted directly.

interface RowSpec {
  code?: boolean;
  start?: boolean;
  end?: boolean;
}

function buildContent(specs: RowSpec[]): HTMLElement {
  const root = document.createElement("div");
  const content = document.createElement("div");
  content.setAttribute("data-content", "");
  specs.forEach((spec, i) => {
    const row = document.createElement("div");
    row.setAttribute("data-line", String(i + 1));
    if (spec.code) row.setAttribute("data-code-line", "");
    if (spec.start) row.setAttribute("data-code-start", "");
    if (spec.end) row.setAttribute("data-code-end", "");
    content.appendChild(row);
  });
  root.appendChild(content);
  return root;
}

const rowAt = (root: ParentNode, line: number): HTMLElement =>
  root.querySelector<HTMLElement>(`[data-content] [data-line="${line}"]`) as HTMLElement;

// A single fenced block: opening fence (start), one code line, closing fence (end).
const oneBlock: RowSpec[] = [
  { code: true, start: true },
  { code: true },
  { code: true, end: true },
];

describe("syncCodeBlockScroll", () => {
  test("mirrors a scrolled row's scrollLeft onto the block's other rows", () => {
    const root = buildContent(oneBlock);
    rowAt(root, 2).scrollLeft = 120;
    syncCodeBlockScroll(rowAt(root, 2));
    expect(rowAt(root, 1).scrollLeft).toBe(120);
    expect(rowAt(root, 3).scrollLeft).toBe(120);
  });

  test("leaves rows of a different block untouched", () => {
    // block A (lines 1-3), a prose line (4), block B (lines 5-7).
    const root = buildContent([
      { code: true, start: true },
      { code: true },
      { code: true, end: true },
      {},
      { code: true, start: true },
      { code: true },
      { code: true, end: true },
    ]);
    rowAt(root, 2).scrollLeft = 90;
    syncCodeBlockScroll(rowAt(root, 2));
    expect(rowAt(root, 1).scrollLeft).toBe(90);
    expect(rowAt(root, 3).scrollLeft).toBe(90);
    // block B and the prose line stay put.
    for (const line of [4, 5, 6, 7]) expect(rowAt(root, line).scrollLeft).toBe(0);
  });

  test("does not bleed across a prose line into adjacent rows", () => {
    const root = buildContent([{ code: true, start: true, end: true }, {}, {}]);
    rowAt(root, 1).scrollLeft = 50;
    syncCodeBlockScroll(rowAt(root, 1));
    expect(rowAt(root, 2).scrollLeft).toBe(0);
    expect(rowAt(root, 3).scrollLeft).toBe(0);
  });

  test("respects code-start/-end boundaries between abutting blocks", () => {
    // Two blocks with NO prose between them: block A ends on line 2, block B opens on
    // line 3. Scrolling block B must not drag block A, even though the rows are all
    // contiguous data-code-line siblings.
    const root = buildContent([
      { code: true, start: true },
      { code: true, end: true },
      { code: true, start: true },
      { code: true, end: true },
    ]);
    rowAt(root, 3).scrollLeft = 200;
    syncCodeBlockScroll(rowAt(root, 3));
    expect(rowAt(root, 4).scrollLeft).toBe(200);
    // block A (lines 1-2) untouched.
    expect(rowAt(root, 1).scrollLeft).toBe(0);
    expect(rowAt(root, 2).scrollLeft).toBe(0);
  });

  test("is a no-op for a non-code row", () => {
    const root = buildContent([{}, { code: true, start: true, end: true }]);
    rowAt(root, 1).scrollLeft = 75;
    syncCodeBlockScroll(rowAt(root, 1));
    // The code block below is never touched by scrolling a prose row.
    expect(rowAt(root, 2).scrollLeft).toBe(0);
  });
});

describe("attachCodeBlockScrollSync", () => {
  test("syncs the block on a code row's scroll event, and stops after teardown", () => {
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    root.appendChild(buildContent(oneBlock));

    const detach = attachCodeBlockScrollSync(root);

    rowAt(root, 1).scrollLeft = 60;
    // scroll doesn't bubble; the controller listens in the capture phase.
    rowAt(root, 1).dispatchEvent(new Event("scroll"));
    expect(rowAt(root, 2).scrollLeft).toBe(60);
    expect(rowAt(root, 3).scrollLeft).toBe(60);

    detach();
    rowAt(root, 1).scrollLeft = 999;
    rowAt(root, 1).dispatchEvent(new Event("scroll"));
    // After teardown the listener is gone, so the others keep their prior value.
    expect(rowAt(root, 2).scrollLeft).toBe(60);
    expect(rowAt(root, 3).scrollLeft).toBe(60);
  });

  test("ignores scroll events from non-code elements", () => {
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    root.appendChild(buildContent([{}, { code: true, start: true, end: true }]));
    attachCodeBlockScrollSync(root);

    rowAt(root, 1).scrollLeft = 40;
    rowAt(root, 1).dispatchEvent(new Event("scroll"));
    expect(rowAt(root, 2).scrollLeft).toBe(0);
  });
});

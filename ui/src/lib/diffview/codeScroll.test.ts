import "../../../test-setup.ts";
import { describe, expect, test } from "bun:test";
import { attachCodeBlockScrollSync, syncCodeBlockScroll } from "./codeScroll.ts";

// EXC-729: a fenced code block renders as independent [data-line] rows (no wrapper), each
// its own hidden-scrollbar horizontal scroll container, plus one injected block scrollbar
// (codeScrollbar.ts). This module mirrors a scroll from any participant — a row or the bar —
// onto the rest of the SAME block so the block scrolls as one unit (keeping tabular content
// aligned). The fixture below mirrors the @pierre/diffs content column, the
// data-code-line / -start / -end tags codeBlocks.ts applies, and the block scrollbar;
// happy-dom stores scrollLeft as a plain settable property (no clamping), so the sync
// propagation can be asserted directly.

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

// Appends a block scrollbar (what codeScrollbar.ts injects) keyed to the block's start
// line, so syncCodeBlockScroll treats it as a participant alongside the rows.
function addBar(root: ParentNode, startLine: number): HTMLElement {
  const content = root.querySelector("[data-content]") as HTMLElement;
  const bar = document.createElement("div");
  bar.setAttribute("data-code-scrollbar", String(startLine));
  content.appendChild(bar);
  return bar;
}

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

  test("returns the rows it actually moved (so the controller can suppress their echoes)", () => {
    const root = buildContent(oneBlock);
    rowAt(root, 2).scrollLeft = 120;
    const moved = syncCodeBlockScroll(rowAt(root, 2));
    expect(moved).toHaveLength(2);
    expect(moved).toContain(rowAt(root, 1));
    expect(moved).toContain(rowAt(root, 3));
    // The scrolled row is never in its own moved set.
    expect(moved).not.toContain(rowAt(root, 2));
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

  test("consumes the echo its own sibling write triggers, so a clamped echo can't snap the block back", () => {
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    root.appendChild(buildContent(oneBlock));
    attachCodeBlockScrollSync(root);

    // User scrolls the opening row to 300; the controller mirrors it onto rows 2 and 3.
    rowAt(root, 1).scrollLeft = 300;
    rowAt(root, 1).dispatchEvent(new Event("scroll"));
    expect(rowAt(root, 2).scrollLeft).toBe(300);
    expect(rowAt(root, 3).scrollLeft).toBe(300);

    // In a real browser that mirror fires an echo "scroll" on rows 2/3. If row 2 has a
    // smaller scroll max it clamps (say to 150) and — left unsuppressed — its echo would
    // drag the whole block back to 150 (the reviewer's snap-back). Simulate that echo:
    // row 2 lands at 150 and fires scroll. It must be consumed, not re-synced.
    rowAt(root, 2).scrollLeft = 150;
    rowAt(root, 2).dispatchEvent(new Event("scroll"));
    expect(rowAt(root, 1).scrollLeft).toBe(300);
    expect(rowAt(root, 3).scrollLeft).toBe(300);
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

describe("syncCodeBlockScroll with a block scrollbar", () => {
  test("the block scrollbar drives every row of its block", () => {
    const root = buildContent(oneBlock);
    const bar = addBar(root, 1); // the block opens on line 1
    bar.scrollLeft = 250;
    syncCodeBlockScroll(bar);
    expect(rowAt(root, 1).scrollLeft).toBe(250);
    expect(rowAt(root, 2).scrollLeft).toBe(250);
    expect(rowAt(root, 3).scrollLeft).toBe(250);
  });

  test("a row's own scroll drives the scrollbar as well as its siblings", () => {
    const root = buildContent(oneBlock);
    const bar = addBar(root, 1);
    rowAt(root, 2).scrollLeft = 180;
    syncCodeBlockScroll(rowAt(root, 2));
    expect(rowAt(root, 1).scrollLeft).toBe(180);
    expect(rowAt(root, 3).scrollLeft).toBe(180);
    expect(bar.scrollLeft).toBe(180); // the bar mirrors the block, not just the rows
  });

  test("the scrollbar only drives its own block", () => {
    // Two blocks; block A's bar must not move block B's rows.
    const root = buildContent([
      { code: true, start: true },
      { code: true, end: true },
      {},
      { code: true, start: true },
      { code: true, end: true },
    ]);
    const barA = addBar(root, 1);
    barA.scrollLeft = 300;
    syncCodeBlockScroll(barA);
    expect(rowAt(root, 1).scrollLeft).toBe(300);
    expect(rowAt(root, 2).scrollLeft).toBe(300);
    for (const line of [3, 4, 5]) expect(rowAt(root, line).scrollLeft).toBe(0);
  });

  test("attachCodeBlockScrollSync also syncs a scroll from the block scrollbar", () => {
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    root.appendChild(buildContent(oneBlock));
    const bar = addBar(root, 1);
    attachCodeBlockScrollSync(root);

    bar.scrollLeft = 210;
    bar.dispatchEvent(new Event("scroll")); // scroll doesn't bubble; the listener captures
    expect(rowAt(root, 1).scrollLeft).toBe(210);
    expect(rowAt(root, 2).scrollLeft).toBe(210);
    expect(rowAt(root, 3).scrollLeft).toBe(210);
  });
});

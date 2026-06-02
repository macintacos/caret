// Anchoring: convert between char offsets into a block's textContent and DOM
// Ranges, and re-resolve annotations across plan re-renders with a 3-tier
// strategy. Offsets are measured against the *concatenated text nodes* of the
// block element (== element.textContent), walked with a TreeWalker.

import type { Annotation } from "./types.ts";

export interface Offsets {
  start: number;
  end: number;
}

/**
 * Walks the text nodes of `root` to find the node + local offset where the
 * cumulative character `target` falls. `prefer` controls boundary behavior:
 * "start" binds to the start of the next node, "end" to the end of the prev.
 */
function locate(
  root: Node,
  target: number,
  prefer: "start" | "end",
): { node: Text; offset: number } | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let consumed = 0;
  let last: Text | null = null;
  let current = walker.nextNode() as Text | null;
  while (current) {
    const len = current.data.length;
    const next = consumed + len;
    if (prefer === "start") {
      // First node that can contain `target` (inclusive of its start).
      if (target < next || (target === next && len === 0)) {
        return { node: current, offset: target - consumed };
      }
    } else {
      // For an end offset, bind to the node that *ends at or past* target,
      // preferring the earliest node that reaches it.
      if (target <= next) {
        return { node: current, offset: target - consumed };
      }
    }
    consumed = next;
    last = current;
    current = walker.nextNode() as Text | null;
  }
  // target == total length: bind to end of last text node.
  if (last && target === consumed) {
    return { node: last, offset: last.data.length };
  }
  return null;
}

/** Builds a Range for [start,end) char offsets into `root`'s textContent. */
export function offsetsToRange(root: HTMLElement, start: number, end: number): Range | null {
  const total = root.textContent?.length ?? 0;
  if (start < 0 || end > total || start > end) return null;
  const s = locate(root, start, "start");
  const e = locate(root, end, "end");
  if (!s || !e) return null;
  const range = document.createRange();
  range.setStart(s.node, s.offset);
  range.setEnd(e.node, e.offset);
  return range;
}

/** Converts a Range within `root` back to char offsets into its textContent. */
export function rangeToOffsets(root: HTMLElement, range: Range): Offsets {
  const start = charOffsetOf(root, range.startContainer, range.startOffset);
  const end = charOffsetOf(root, range.endContainer, range.endOffset);
  return { start, end };
}

/** Cumulative char offset of (container, offset) within root's text. */
function charOffsetOf(root: Node, container: Node, offset: number): number {
  // Offset is relative to text inside `container`. Sum all text before it.
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let total = 0;
  let node = walker.nextNode() as Text | null;
  while (node) {
    if (node === container) {
      return total + offset;
    }
    // If the container is an element, its child boundary maps to text length
    // accumulated up to the offset-th child — handle the common text-node case
    // plus element containers by checking containment.
    if (container.nodeType !== Node.TEXT_NODE && container.contains(node)) {
      // Element container: `offset` counts child nodes; approximate by summing
      // text of children before the boundary. Simpler: fall through and let
      // the text-node match below catch it.
    }
    total += node.data.length;
    node = walker.nextNode() as Text | null;
  }
  // Container was an element (e.g. boundary at child index). Recompute by
  // measuring text length of the range from root start to the boundary.
  return measureElementBoundary(root, container, offset);
}

/** Handles element-container range boundaries by measuring preceding text. */
function measureElementBoundary(root: Node, container: Node, offset: number): number {
  const boundaryNode = container.childNodes[offset] ?? null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let total = 0;
  let node = walker.nextNode() as Text | null;

  if (boundaryNode) {
    // Boundary is BEFORE childNodes[offset]: sum text up to that node.
    while (node) {
      if (node === boundaryNode || boundaryNode.contains(node)) return total;
      total += node.data.length;
      node = walker.nextNode() as Text | null;
    }
    return total;
  }

  // Boundary is AFTER the container's last child (offset === childNodes.length):
  // the char offset is the END of the container's own text — text before the
  // container plus all text inside it. (For root itself this is its full length.)
  let entered = false;
  while (node) {
    const inside = container.contains(node);
    if (inside) entered = true;
    else if (entered) return total; // walked past the container's subtree
    total += node.data.length;
    node = walker.nextNode() as Text | null;
  }
  return total;
}

/**
 * Wraps the [start,end) slice of `root`'s textContent in <mark> elements — one
 * per intersected text node — and returns them in document order. A single
 * Range.surroundContents throws when the selection crosses element boundaries;
 * shiki splits code into per-token <span>s, so a selection inside a highlighted
 * block routinely crosses boundaries. Splitting the work per text node keeps
 * each surroundContents inside one text node (never throwing) so the selection
 * still produces visible marks. `makeMark` builds a fresh element per segment
 * (callers stamp data-annotation, classes, etc.); the slice text is preserved.
 */
export function wrapTextRange(
  root: HTMLElement,
  start: number,
  end: number,
  makeMark: () => HTMLElement,
): HTMLElement[] {
  if (end <= start) return [];

  // Collect the per-node segments first — don't mutate the tree while walking.
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const segments: { node: Text; from: number; to: number }[] = [];
  let consumed = 0;
  let node = walker.nextNode() as Text | null;
  while (node) {
    const len = node.data.length;
    const from = Math.max(start, consumed) - consumed;
    const to = Math.min(end, consumed + len) - consumed;
    if (to > from) segments.push({ node, from, to });
    consumed += len;
    node = walker.nextNode() as Text | null;
  }

  // Wrap last-to-first: each surroundContents acts within a single text node
  // (never throws) and splitting a later node leaves earlier nodes' references
  // and offsets intact. Prepend each new mark to keep document order.
  const marks: HTMLElement[] = [];
  for (const seg of [...segments].reverse()) {
    const range = document.createRange();
    range.setStart(seg.node, seg.from);
    range.setEnd(seg.node, seg.to);
    const mark = makeMark();
    range.surroundContents(mark);
    marks.unshift(mark);
  }
  return marks;
}

export interface Resolution {
  /** 1 = exact offsets, 2 = quote-repaired, 3 = orphaned (unresolvable). */
  tier: 1 | 2 | 3;
  range: Range | null;
  startOffset: number;
  endOffset: number;
}

/**
 * Re-resolves an annotation against the current DOM:
 *  1. offsets→Range whose text equals the stored quote (exact hit),
 *  2. else search for the quote as a unique substring and rebuild offsets,
 *  3. else orphan — never silently dropped.
 */
export function resolveAnnotation(
  ann: Annotation,
  getBlock: (blockId: string) => HTMLElement | null,
): Resolution {
  const root = getBlock(ann.blockId);
  if (!root) {
    return { tier: 3, range: null, startOffset: ann.startOffset, endOffset: ann.endOffset };
  }

  // Tier 1: exact offsets, validated against the quote.
  const exact = offsetsToRange(root, ann.startOffset, ann.endOffset);
  if (exact && exact.toString() === ann.quote) {
    return {
      tier: 1,
      range: exact,
      startOffset: ann.startOffset,
      endOffset: ann.endOffset,
    };
  }

  // Tier 2: unique substring search for the quote.
  const text = root.textContent ?? "";
  if (ann.quote.length > 0) {
    const first = text.indexOf(ann.quote);
    const second = first === -1 ? -1 : text.indexOf(ann.quote, first + 1);
    if (first !== -1 && second === -1) {
      const start = first;
      const end = first + ann.quote.length;
      const range = offsetsToRange(root, start, end);
      if (range) {
        return { tier: 2, range, startOffset: start, endOffset: end };
      }
    }
  }

  // Tier 3: orphaned.
  return { tier: 3, range: null, startOffset: ann.startOffset, endOffset: ann.endOffset };
}

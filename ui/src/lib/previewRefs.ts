// Finds the daemon-resolved file references in the mounted preview and wraps each one's
// text in a `span[data-file-ref]`, the preview's counterpart of fileRefTag.ts. Wrapping
// splits text nodes but never changes the root's text, so planSourceMap.ts stays valid.
import type { FileRefSpan, FileRefSpanMap } from "$lib/diffview/fileRefs.ts";
import { createPlanSourceMap } from "$lib/planSourceMap.ts";

const FILE_REF_ATTR = "data-file-ref";

/** A resolved reference as the preview finds it: the text its display line shows for it,
 * how many earlier occurrences of that text the display line holds, and how many in all. */
export interface PreviewFileRef {
  line: number;
  text: string;
  nth: number;
  count: number;
  span: FileRefSpan;
}

/** Start offsets of the non-overlapping occurrences of `needle` in `haystack`. */
function occurrences(haystack: string, needle: string): number[] {
  const found: number[] = [];
  if (needle === "") return found;
  for (
    let i = haystack.indexOf(needle);
    i !== -1;
    i = haystack.indexOf(needle, i + needle.length)
  ) {
    found.push(i);
  }
  return found;
}

/** The references in `refs`, keyed for the preview by their display text
 * (`displayText` is the link layer's text, line for line with the stored plan). */
export function previewFileRefs(refs: FileRefSpanMap, displayText: string): PreviewFileRef[] {
  const lines = displayText.split("\n");
  return [...refs].flatMap(([line, spans]) => {
    const display = lines[line - 1] ?? "";
    return spans.map((span) => {
      const text = display.slice(span.startCol, span.endCol);
      const all = occurrences(display, text);
      const nth = all.filter((i) => i + text.length <= span.startCol).length;
      return { line, text, nth, count: all.length, span };
    });
  });
}

/** A match to wrap: `[start, end)` inside one text node. */
interface Hit {
  node: Text;
  start: number;
  end: number;
  ref: PreviewFileRef;
}

function unwrap(root: HTMLElement): void {
  for (const el of root.querySelectorAll(`[${FILE_REF_ATTR}]`)) {
    const parent = el.parentNode;
    el.replaceWith(...el.childNodes);
    parent?.normalize();
  }
}

interface Slice {
  node: Text;
  from: number;
  to: number;
}

/** The text nodes `range` covers, each with the slice of it inside the range. */
function rangeSlices(root: HTMLElement, range: Range): Slice[] {
  const slices: Slice[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  // Starting at the range's start skips the walk over everything before it; an element
  // start is re-filtered by intersectsNode, so its children before startOffset drop out.
  walker.currentNode = range.startContainer;
  const first = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer : null;
  for (let n = first ?? walker.nextNode(); n !== null; n = walker.nextNode()) {
    const node = n as Text;
    if (range.comparePoint(node, 0) > 0) break;
    if (!range.intersectsNode(node)) continue;
    const from = node === range.startContainer ? range.startOffset : 0;
    const to = node === range.endContainer ? range.endOffset : node.length;
    if (to > from) slices.push({ node, from, to });
  }
  return slices;
}

// ponytail: a reference stays plain unless its text is rendered verbatim inside one text
// node, and the display line and rendered line agree on how many times that text occurs
// (an escape or an image can change either count). The upgrade is for the renderer to
// mark candidate runs.
function findHit(slices: Slice[], ref: PreviewFileRef): Hit | null {
  const text = slices.map((s) => s.node.data.slice(s.from, s.to)).join("");
  const found = occurrences(text, ref.text);
  const at = found[ref.nth];
  if (at === undefined || found.length !== ref.count) return null;
  let offset = 0;
  for (const { node, from, to } of slices) {
    if (at >= offset && at + ref.text.length <= offset + to - from) {
      const start = from + at - offset;
      return { node, start, end: start + ref.text.length, ref };
    }
    offset += to - from;
  }
  return null;
}

function wrap({ node, start, end, ref }: Hit): HTMLElement {
  const middle = node.splitText(start);
  middle.splitText(end - start);
  const el = document.createElement("span");
  el.setAttribute(FILE_REF_ATTR, ref.span.kind === "directory" ? "directory" : "");
  middle.replaceWith(el);
  el.append(middle);
  return el;
}

/** Wraps each reference's text in `root` in a `span[data-file-ref]` and returns each
 * wrapper's span. Each is found as the `nth`-plus-one occurrence of `text` within its
 * line's rendered range. Unwraps the previous pass's wrappers first, so a re-run never
 * nests. A reference whose text is missing on its line stays plain. */
export function tagPreviewFileRefs(
  root: HTMLElement,
  refs: readonly PreviewFileRef[],
): Map<HTMLElement, FileRefSpan> {
  unwrap(root);
  const map = createPlanSourceMap(root);
  const slicesByLine = new Map<number, Slice[]>();
  const hits = refs.flatMap((ref) => {
    let slices = slicesByLine.get(ref.line);
    if (slices === undefined) {
      const range = map.rangeOf(ref.line);
      slices = range === null ? [] : rangeSlices(root, range);
      slicesByLine.set(ref.line, slices);
    }
    const hit = findHit(slices, ref);
    return hit === null ? [] : [hit];
  });
  // Right to left within a node, so a split never shifts a later hit's offsets; a split
  // leaves other nodes' offsets alone, so their relative order doesn't matter.
  hits.sort((a, b) => b.start - a.start);
  const tagged = new Map<HTMLElement, FileRefSpan>();
  const lowest = new Map<Text, number>();
  for (const hit of hits) {
    if (hit.end > (lowest.get(hit.node) ?? Infinity)) continue;
    lowest.set(hit.node, hit.start);
    tagged.set(wrap(hit), hit.ref.span);
  }
  return tagged;
}

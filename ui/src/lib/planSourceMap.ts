// Maps the mounted preview's text back to the plan's source lines, from the empty
// `[data-source-line]` markers `renderPlanMarkdown` emits. Offsets count all of the root's
// text and are resolved against the live DOM at lookup time: the text nodes are indexed at
// build, and a lookup re-indexes when a node it reads was detached or resized. A mutation
// may replace, split, merge or wrap text nodes, keeping the root's text in order; it never
// edits an indexed node's `data` in place or reorders nodes.
import type { SourceSpan } from "$lib/planMarkdown.ts";

export interface PlanSourceMap {
  /** The source line of the rendered character at a DOM point; at the end of the
   * preview's text, the last character's. Null outside the root or for an empty preview. */
  lineAt(node: Node, offset: number): number | null;
  /** The source lines of the first and last non-whitespace characters a range covers
   * (its first and last characters when it covers only whitespace). Null when either end
   * lies outside the root, or the preview has no text. */
  linesOf(range: Range): SourceSpan | null;
  /** The rendered text from this line's start to the next line's, trailing whitespace
   * included; null for a line nothing starts on — blank outside code, a link definition,
   * a fence, a delimiter row, `hr`, out of range. */
  rangeOf(line: number): Range | null;
  /** `lineAt` for a caller that counted the root's text itself: the source line of the
   * character `offset` characters in; null for an empty preview. */
  lineAtOffset(offset: number): number | null;
  /** Where `line`'s text starts, in characters into the root's text — the origin a
   * TextPoint column counts from; null wherever `rangeOf(line)` is null. */
  offsetOfLine(line: number): number | null;
  /** `p` as a DOM point. The column may run past the line's own text, as a search match's
   * does across a soft break. At a boundary between text nodes "after" resolves into the
   * later one, "before" the earlier. Null where `offsetOfLine(p.line)` is null, and where
   * `p` is at or past the end of the preview's text for "after", or past it for "before". */
  domPoint(p: TextPoint, side: "before" | "after"): [Text, number] | null;
  /** `domPoint(p, "after")` with the column clamped to the line's text, so it names one of
   * the characters `rangeOf(p.line)` covers. Null where `rangeOf` is. */
  clampedPoint(p: TextPoint): [Text, number] | null;
  /** `clampedPoint`'s inverse: `lineAt`'s line, and the characters from that line's start
   * to the point (never negative). Null where `lineAt` is. */
  textPoint(node: Node, offset: number): TextPoint | null;
}

/** A point in the preview's text: a source line, and a column counted from that line's
 * start (`offsetOfLine`); `domPoint` lets the column run past the line's own text. */
export interface TextPoint {
  line: number;
  column: number;
}

/** A source line's text starts at `offset` and runs to the next run's. Offsets ascend. */
interface Run {
  offset: number;
  line: number;
}

function collectRuns(root: Node): { runs: Run[]; length: number } {
  const runs: Run[] = [];
  let offset = 0;
  // An empty run yields to the marker after it; a repeated line (a row's next cell) extends its run.
  const startRun = (line: number, at = offset): void => {
    const last = runs.at(-1);
    if (last?.offset === at) runs.pop();
    if (runs.at(-1)?.line !== line) runs.push({ offset: at, line });
  };
  // Code text is literal: each newline that more code follows starts the next line.
  const addCode = (text: string, firstLine: number): void => {
    let line = firstLine;
    for (
      let i = text.indexOf("\n");
      i !== -1 && i + 1 < text.length;
      i = text.indexOf("\n", i + 1)
    ) {
      startRun(++line, offset + i + 1);
    }
  };
  const walk = (parent: Node): void => {
    let codeLine: number | null = null;
    for (const node of parent.childNodes) {
      if (node instanceof Text) {
        offset += node.data.length;
        continue;
      }
      if (!(node instanceof Element)) continue;
      const marker = node.getAttribute("data-source-line");
      if (marker !== null) {
        startRun(Number(marker));
        if (node.hasAttribute("data-source-code")) codeLine = Number(marker);
      } else if (codeLine !== null) {
        // The element right after a code marker is the code block, whatever replaced its markup.
        const text = node.textContent ?? "";
        addCode(text, codeLine);
        offset += text.length;
        codeLine = null;
      } else {
        walk(node);
      }
    }
  };
  walk(root);
  return { runs, length: offset };
}

/** A text node under the root, and where its text starts and ends in the root's text. */
interface IndexedText {
  node: Text;
  start: number;
  end: number;
}

/** The root's text nodes in document order, and each node's record. */
interface TextIndex {
  texts: IndexedText[];
  byNode: Map<Text, IndexedText>;
}

function indexText(root: Element): TextIndex {
  const textIndex: TextIndex = { texts: [], byNode: new Map() };
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let start = 0;
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node as Text;
    const record = { node: text, start, end: start + text.data.length };
    textIndex.texts.push(record);
    textIndex.byNode.set(text, record);
    start = record.end;
  }
  return textIndex;
}

/** The first item that passes, where `passes` is false then true; `items.length` when none
 * does. */
function firstPassing<T>(items: readonly T[], passes: (item: T) => boolean): number {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (passes(items[mid] as T))
      hi = mid; // mid < hi <= items.length
    else lo = mid + 1;
  }
  return lo;
}

/** The first Text node at or after the boundary point `(node, offset)` under `root`. */
function textFrom(root: Element, node: Node, offset: number): Text | null {
  const after = (from: Node): Node | null => {
    for (let at: Node | null = from; at !== null && at !== root; at = at.parentNode) {
      if (at.nextSibling !== null) return at.nextSibling;
    }
    return null;
  };
  let next = node.childNodes[offset] ?? after(node);
  while (next !== null && !(next instanceof Text)) next = next.firstChild ?? after(next);
  return next;
}

/** A lookup's answer when an indexed node it read has been detached or resized. */
const STALE = Symbol("stale");

/** Builds the map for `root`, whose content is exactly `renderPlanMarkdown(text).html`.
 * Build once per version; it reads no layout. */
export function createPlanSourceMap(root: Element): PlanSourceMap {
  const { runs, length } = collectRuns(root);
  /** Each line's rendered text: from its first run's offset to the run after it. */
  const extents = new Map<number, { start: number; end: number }>();
  runs.forEach((run, i) => {
    if (!extents.has(run.line))
      extents.set(run.line, { start: run.offset, end: runs[i + 1]?.offset ?? length });
  });
  let textIndex = indexText(root);

  const isFresh = ({ node, start, end }: IndexedText): boolean =>
    root.contains(node) && node.data.length === end - start;
  // Mutations keep the root's text, so one re-index makes every node a lookup reads fresh; a
  // second STALE cannot happen.
  const withFreshIndex = <T>(lookup: () => T | typeof STALE): T | null => {
    const answer = lookup();
    if (answer !== STALE) return answer;
    textIndex = indexText(root);
    const retried = lookup();
    return retried === STALE ? null : retried;
  };

  const resolve = (offset: number, side: "before" | "after"): [Text, number] | null =>
    withFreshIndex(() => {
      const { texts } = textIndex;
      const hit =
        texts[firstPassing(texts, (t) => (side === "after" ? offset < t.end : offset <= t.end))];
      if (hit === undefined) return null;
      if (!isFresh(hit)) return STALE;
      return [hit.node, offset - hit.start];
    });

  const offsetAt = (node: Node, offset: number): number | null => {
    if (!root.contains(node)) return null;
    return withFreshIndex(() => {
      const text = node instanceof Text ? node : textFrom(root, node, offset);
      if (text === null) return length;
      const hit = textIndex.byNode.get(text);
      if (hit === undefined || !isFresh(hit)) return STALE;
      return hit.start + (text === node ? offset : 0);
    });
  };

  const lineAtOffset = (offset: number): number | null => {
    if (length === 0) return null;
    const at = Math.min(offset, length - 1);
    const next = firstPassing(runs, (run) => run.offset > at);
    return (runs[next - 1] ?? runs[0])?.line ?? null;
  };

  const offsetOfLine = (line: number): number | null => extents.get(line)?.start ?? null;

  return {
    lineAt(node, offset) {
      const at = offsetAt(node, offset);
      return at === null ? null : lineAtOffset(at);
    },
    linesOf(range) {
      const rangeStart = offsetAt(range.startContainer, range.startOffset);
      if (rangeStart === null || !root.contains(range.endContainer)) return null;
      const text = range.toString();
      const [firstChar, lastChar] =
        text.trim() === ""
          ? [0, Math.max(text.length - 1, 0)]
          : [text.length - text.trimStart().length, text.trimEnd().length - 1];
      const start = lineAtOffset(rangeStart + firstChar);
      const end = lineAtOffset(rangeStart + lastChar);
      return start === null || end === null ? null : { start, end };
    },
    rangeOf(line) {
      const extent = extents.get(line);
      if (extent === undefined) return null;
      const start = resolve(extent.start, "after");
      const end = resolve(extent.end, "before");
      if (start === null || end === null) return null;
      const range = root.ownerDocument.createRange();
      range.setStart(...start);
      range.setEnd(...end);
      return range;
    },
    lineAtOffset,
    offsetOfLine,
    domPoint(p, side) {
      const origin = offsetOfLine(p.line);
      return origin === null ? null : resolve(origin + p.column, side);
    },
    clampedPoint(p) {
      const extent = extents.get(p.line);
      if (extent === undefined) return null;
      const last = Math.max(extent.end - extent.start - 1, 0);
      return resolve(extent.start + Math.min(p.column, last), "after");
    },
    textPoint(node, offset) {
      const at = offsetAt(node, offset);
      const line = at === null ? null : lineAtOffset(at);
      if (at === null || line === null) return null;
      const origin = offsetOfLine(line);
      return { line, column: origin === null ? 0 : Math.max(at - origin, 0) };
    },
  };
}

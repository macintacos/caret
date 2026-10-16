// Maps the mounted preview's text back to the plan's source lines, from the empty
// `[data-source-line]` markers `renderPlanMarkdown` emits. Offsets count all of the root's
// text and are resolved against the live DOM at lookup time: the text nodes are indexed
// once and each one a lookup reads is checked on use, so replacing a code block's markup
// with spans of the same text re-indexes and keeps every answer valid.
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

/** A cursor position on the preview: a source line, and a character offset into the
 * text that line renders (`PlanSourceMap.rangeOf(line)`). */
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

/** The root's text nodes in document order: where each one's text ends, and each one's place. */
interface TextIndex {
  nodes: Text[];
  ends: number[];
  places: Map<Text, number>;
}

function indexText(root: Element): TextIndex {
  const index: TextIndex = { nodes: [], ends: [], places: new Map() };
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let end = 0;
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node as Text;
    end += text.data.length;
    index.places.set(text, index.nodes.length);
    index.nodes.push(text);
    index.ends.push(end);
  }
  return index;
}

/** The first index below `count` that passes, where `passes` is false then true; `count` when none does. */
function firstPassing(count: number, passes: (index: number) => boolean): number {
  let lo = 0;
  let hi = count;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (passes(mid)) hi = mid;
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
  const firstRun = new Map<number, number>();
  runs.forEach((run, index) => {
    if (!firstRun.has(run.line)) firstRun.set(run.line, index);
  });
  let index = indexText(root);

  const startOf = (place: number): number => index.ends[place - 1] ?? 0;
  const isFresh = (place: number): boolean => {
    const node = index.nodes[place] as Text;
    return (
      root.contains(node) && node.data.length === (index.ends[place] as number) - startOf(place)
    );
  };
  // Mutations keep the root's text, so a stale read means some text node moved: re-index once.
  const fresh = <T>(lookup: () => T | typeof STALE): T | null => {
    const answer = lookup();
    if (answer !== STALE) return answer;
    index = indexText(root);
    const retried = lookup();
    return retried === STALE ? null : retried;
  };

  const resolve = (offset: number, side: "before" | "after"): [Text, number] | null =>
    fresh(() => {
      const place = firstPassing(index.ends.length, (i) =>
        side === "after" ? offset < (index.ends[i] as number) : offset <= (index.ends[i] as number),
      );
      if (place === index.nodes.length) return null;
      if (!isFresh(place)) return STALE;
      return [index.nodes[place] as Text, offset - startOf(place)];
    });

  const offsetAt = (node: Node, offset: number): number | null => {
    if (!root.contains(node)) return null;
    return fresh(() => {
      const text = node instanceof Text ? node : textFrom(root, node, offset);
      if (text === null) return length;
      const place = index.places.get(text);
      if (place === undefined || !isFresh(place)) return STALE;
      return startOf(place) + (text === node ? offset : 0);
    });
  };

  const lineAtOffset = (offset: number): number | null => {
    if (length === 0) return null;
    const at = Math.min(offset, length - 1);
    const next = firstPassing(runs.length, (i) => (runs[i] as Run).offset > at);
    return (runs[next - 1] ?? runs[0])?.line ?? null;
  };

  const offsetOfLine = (line: number): number | null => {
    const at = firstRun.get(line);
    return at === undefined ? null : (runs[at]?.offset ?? null);
  };

  return {
    lineAt(node, offset) {
      const at = offsetAt(node, offset);
      return at === null ? null : lineAtOffset(at);
    },
    domPoint(p, side) {
      const origin = offsetOfLine(p.line);
      return origin === null ? null : resolve(origin + p.column, side);
    },
    clampedPoint(p) {
      const at = firstRun.get(p.line);
      const run = at === undefined ? undefined : runs[at];
      if (at === undefined || run === undefined) return null;
      const lineLength = (runs[at + 1]?.offset ?? length) - run.offset;
      return resolve(run.offset + Math.min(p.column, Math.max(lineLength - 1, 0)), "after");
    },
    textPoint(node, offset) {
      const at = offsetAt(node, offset);
      const line = at === null ? null : lineAtOffset(at);
      if (at === null || line === null) return null;
      const origin = offsetOfLine(line);
      return { line, column: origin === null ? 0 : Math.max(at - origin, 0) };
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
      const at = firstRun.get(line);
      const run = at === undefined ? undefined : runs[at];
      if (at === undefined || run === undefined) return null;
      const start = resolve(run.offset, "after");
      const end = resolve(runs[at + 1]?.offset ?? length, "before");
      if (start === null || end === null) return null;
      const range = root.ownerDocument.createRange();
      range.setStart(...start);
      range.setEnd(...end);
      return range;
    },
    lineAtOffset,
    offsetOfLine,
  };
}

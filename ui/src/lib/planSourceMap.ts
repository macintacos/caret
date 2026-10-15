// Maps the mounted preview's text back to the plan's source lines, from the empty
// `[data-source-line]` markers `renderPlanMarkdown` emits. Offsets count all of the root's
// text and are resolved against the live DOM at lookup time, so replacing a code block's
// markup with spans of the same text keeps every answer valid.
import { rangeForSpan } from "$lib/diffview/searchHighlight.ts";
import type { SourceSpan } from "$lib/planMarkdown.ts";

export interface PlanSourceMap {
  /** The source line of the rendered character at a DOM point; at the end of the
   * preview's text, the last character's. Null outside the root or for an empty preview. */
  lineAt(node: Node, offset: number): number | null;
  /** The source lines of the first and last non-whitespace characters a range covers
   * (its first and last characters when it covers only whitespace). */
  linesOf(range: Range): SourceSpan | null;
  /** The rendered text one source line produced, or null when it produced none. */
  rangeOf(line: number): Range | null;
}

/** A source line's text starts at `offset` and runs to the next run's. Runs ascend in both. */
interface Run {
  offset: number;
  line: number;
}

function collectRuns(root: Node): { runs: Run[]; length: number } {
  const runs: Run[] = [];
  let offset = 0;
  const start = (line: number, at = offset): void => {
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
      start(++line, offset + i + 1);
    }
  };
  const walk = (parent: Node): void => {
    let codeLine: number | null = null;
    for (const node of parent.childNodes) {
      if (!(node instanceof Element)) {
        offset += node.textContent?.length ?? 0;
        continue;
      }
      const marker = node.getAttribute("data-source-line");
      if (marker !== null) {
        start(Number(marker));
        if (node.hasAttribute("data-source-code")) codeLine = Number(marker);
      } else if (codeLine !== null) {
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

/** Index of the last run starting at or before `offset`, or 0 when none does. */
function runIndexAt(runs: Run[], offset: number): number {
  let low = 0;
  let high = runs.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if ((runs[mid]?.offset ?? 0) <= offset) low = mid;
    else high = mid - 1;
  }
  return low;
}

function runIndexOfLine(runs: Run[], line: number): number {
  let low = 0;
  let high = runs.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const midLine = runs[mid]?.line ?? 0;
    if (midLine === line) return mid;
    if (midLine < line) low = mid + 1;
    else high = mid - 1;
  }
  return -1;
}

/** Builds the map for `root`, whose content is exactly `renderPlanMarkdown(text).html`.
 * Build once per version; it reads no layout. */
export function createPlanSourceMap(root: Element): PlanSourceMap {
  const { runs, length } = collectRuns(root);

  const lineAtOffset = (offset: number): number | null => {
    if (runs.length === 0 || length === 0) return null;
    return runs[runIndexAt(runs, Math.min(offset, length - 1))]?.line ?? null;
  };

  const offsetOf = (node: Node, offset: number): number | null => {
    if (!root.contains(node)) return null;
    const range = root.ownerDocument.createRange();
    range.setStart(root, 0);
    range.setEnd(node, offset);
    return range.toString().length;
  };

  return {
    lineAt(node, offset) {
      const at = offsetOf(node, offset);
      return at === null ? null : lineAtOffset(at);
    },
    linesOf(range) {
      const at = offsetOf(range.startContainer, range.startOffset);
      if (at === null || !root.contains(range.endContainer)) return null;
      const text = range.toString();
      const first = text.search(/\S/);
      const last = text.length - 1 - (text.match(/\s*$/)?.[0].length ?? 0);
      const [from, to] = first === -1 ? [0, Math.max(text.length - 1, 0)] : [first, last];
      const start = lineAtOffset(at + from);
      const end = lineAtOffset(at + to);
      return start === null || end === null ? null : { start, end };
    },
    rangeOf(line) {
      const index = runIndexOfLine(runs, line);
      const run = runs[index];
      if (run === undefined) return null;
      return rangeForSpan(root, run.offset, runs[index + 1]?.offset ?? length);
    },
  };
}

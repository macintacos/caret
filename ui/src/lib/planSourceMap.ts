// Maps the mounted preview's text back to the plan's source lines, from the empty
// `[data-source-line]` markers `renderPlanMarkdown` emits. Offsets count all of the root's
// text and are resolved against the live DOM at lookup time, so replacing a code block's
// markup with spans of the same text keeps every answer valid, and each lookup costs time
// proportional to the preview's text: batch lookups rather than calling per character.
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

/** The text position `offset` characters into `root`. At a boundary between two text
 * nodes, "after" resolves into the later one, "before" into the earlier. */
function pointAt(root: Element, offset: number, side: "before" | "after"): [Text, number] | null {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let seen = 0;
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node as Text;
    const end = seen + text.data.length;
    if (side === "after" ? offset < end : offset <= end) return [text, offset - seen];
    seen = end;
  }
  return null;
}

/** Builds the map for `root`, whose content is exactly `renderPlanMarkdown(text).html`.
 * Build once per version; it reads no layout. */
export function createPlanSourceMap(root: Element): PlanSourceMap {
  const { runs, length } = collectRuns(root);

  const lineAtOffset = (offset: number): number | null => {
    if (length === 0) return null;
    const at = Math.min(offset, length - 1);
    return (runs.findLast((run) => run.offset <= at) ?? runs[0])?.line ?? null;
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
      const rangeStart = offsetOf(range.startContainer, range.startOffset);
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
      const index = runs.findIndex((run) => run.line === line);
      const run = runs[index];
      if (run === undefined) return null;
      const start = pointAt(root, run.offset, "after");
      const end = pointAt(root, runs[index + 1]?.offset ?? length, "before");
      if (start === null || end === null) return null;
      const range = root.ownerDocument.createRange();
      range.setStart(...start);
      range.setEnd(...end);
      return range;
    },
  };
}

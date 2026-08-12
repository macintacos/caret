// GFM table classification for the markdown plan view (EXC-864). The plan renders
// as line-numbered markdown source (SourceView.svelte), so a table is just the run
// of source lines that form one — a header row, a delimiter row, and the body rows
// that agree with them on cell count. This module computes that run, and where each
// row's cells sit on its line, so the DOM pass can restructure those rows into a
// real column-aligned table.
//
// A table is the one construct in this epic that RESTRUCTURES rather than
// overdrawing in place: the `|` columns in the source do not line up with a table's
// columns, so alignment has to come from layout. Everything else about the source
// survives it — no character is added, removed, or moved, so copy, `/` search, vim
// motions and comment anchors all keep resolving against the same column space.
//
// Columns are 0-based and half-open, and each cell's extent INCLUDES the pipe that
// opens it (and, for the last cell, the one that closes the row). That is what makes
// the cells tile the line exactly with no gaps, which the DOM pass needs in order to
// split a row's tokens on the boundaries without losing a glyph — and it is what
// puts the pipes at the cells' shared edges, where they draw as the table's borders.
//
// Lines are indexed over the DISPLAY text, the same space codeBlockRanges and the
// inline layers use, so a collapsed link's columns are the ones the reader sees.

import type { CodeBlockRange } from "$lib/diffview/codeBlocks.ts";

/** How a column's cells are aligned, per the delimiter row's markers. `undefined`
 * is the unmarked default, which draws no rule of its own. */
export type TableAlign = "left" | "center" | "right";

/** One cell's extent on its row's line, 0-based and half-open, including the pipe
 * that opens it. */
export interface TableCell {
  startCol: number;
  endCol: number;
}

/** One source line of a table, and where its cells sit on it. */
export interface TableRow {
  /** 1-based line number, matching the view's `data-line` attributes. */
  line: number;
  cells: TableCell[];
}

/** A table's line span, 1-based and inclusive. */
export interface TableRange {
  /** The header row's line. */
  start: number;
  /** The delimiter row's line — always `start + 1`. */
  rule: number;
  /** The last row's line: the delimiter row for a header-only table. */
  end: number;
  /** Per-column alignment, one entry per cell. */
  align: (TableAlign | undefined)[];
  /** Every row in the span, header and delimiter included, in line order. */
  rows: TableRow[];
}

// A delimiter cell: optional leading/trailing `:` around one or more dashes. The
// colons are the alignment markers; the dashes carry no meaning beyond being there.
const DELIMITER = /^:?-+:?$/;

// A line that cannot open or continue a table: blank, indented past CommonMark's
// three-space allowance (which makes it indented content), or blockquote-prefixed.
// A quoted table is deliberately excluded — its `>` prefix would need a column track
// of its own, and nothing in the epic asks for one.
const NOT_A_ROW = /^(?:\s*$| {4}|\s{0,3}>)/;

/** The columns of every unescaped `|` on a line. A backslash escapes the character
 * after it, so `\|` is a literal pipe inside a cell and `\\|` is a literal backslash
 * followed by a real delimiter. */
function pipeColumns(line: string): number[] {
  const columns: number[] = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\") {
      i++;
      continue;
    }
    if (line[i] === "|") columns.push(i);
  }
  return columns;
}

/**
 * The cells of one table row, tiling `[0, line.length)` with no gaps, or `null`
 * when the line cannot be a row at all.
 *
 * GFM makes the leading and trailing pipes optional, and both are handled by
 * folding rather than by stripping: with a leading pipe the first cell starts at
 * column 0 (absorbing any indent), without one the text before the first pipe is
 * itself the first cell; a trailing pipe is not a cell of its own but joins the
 * last one, so it renders as that cell's right-hand border.
 */
function rowCells(line: string): TableCell[] | null {
  if (NOT_A_ROW.test(line)) return null;
  const pipes = pipeColumns(line);
  if (pipes.length === 0) return null;

  const first = pipes[0] ?? 0;
  const last = pipes[pipes.length - 1] ?? 0;
  const leading = line.slice(0, first).trim() === "";
  const trailing = pipes.length > 1 && line.slice(last + 1).trim() === "";

  const starts = leading ? [0, ...pipes.slice(1)] : [0, ...pipes];
  // A trailing pipe opens no cell of its own; drop its start so it falls into the
  // previous cell's extent.
  if (trailing) starts.pop();
  return starts.map((startCol, i) => ({
    startCol,
    endCol: starts[i + 1] ?? line.length,
  }));
}

/** A cell's text with its own pipes stripped and trimmed — what the delimiter row
 * is validated against. */
function cellText(line: string, cell: TableCell): string {
  return line.slice(cell.startCol, cell.endCol).replaceAll("|", " ").trim();
}

/** The alignment each delimiter cell declares, or `undefined` where it declares
 * none. Returns `null` when any cell is not a delimiter at all. */
function alignments(line: string, cells: TableCell[]): (TableAlign | undefined)[] | null {
  const align: (TableAlign | undefined)[] = [];
  for (const cell of cells) {
    const text = cellText(line, cell);
    if (!DELIMITER.test(text)) return null;
    const left = text.startsWith(":");
    const right = text.endsWith(":");
    align.push(left && right ? "center" : left ? "left" : right ? "right" : undefined);
  }
  return align;
}

/**
 * The GFM tables in `text`, as 1-based inclusive line ranges carrying each row's
 * cell extents. `codeRanges` names the fenced blocks to skip, so a table written
 * inside a fence stays code.
 *
 * A table is a candidate row, a delimiter row directly beneath it with the same
 * cell count, and the following rows that agree on that count. Anything short of
 * that produces no range and the lines render as raw source: a missing or
 * mismatched delimiter row voids the table outright, while a ragged body row merely
 * ENDS it, so a well-formed prefix still renders and only the ragged line falls
 * back.
 */
export function tableRanges(text: string, codeRanges: CodeBlockRange[]): TableRange[] {
  const lines = text.split("\n");
  const inCode = (n: number) => codeRanges.some((r) => n >= r.start && n <= r.end);
  const ranges: TableRange[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = i + 1;
    if (inCode(line)) continue;
    const header = rowCells(lines[i] ?? "");
    if (header === null) continue;

    const ruleLine = i + 2;
    if (inCode(ruleLine)) continue;
    const ruleText = lines[i + 1];
    const rule = ruleText === undefined ? null : rowCells(ruleText);
    if (rule === null || rule.length !== header.length) continue;
    const align = alignments(ruleText ?? "", rule);
    if (align === null) continue;

    const rows: TableRow[] = [
      { line, cells: header },
      { line: ruleLine, cells: rule },
    ];
    let end = ruleLine;
    for (let j = i + 2; j < lines.length; j++) {
      const bodyLine = j + 1;
      if (inCode(bodyLine)) break;
      const cells = rowCells(lines[j] ?? "");
      if (cells === null || cells.length !== header.length) break;
      rows.push({ line: bodyLine, cells });
      end = bodyLine;
    }

    ranges.push({ start: line, rule: ruleLine, end, align, rows });
    i = end - 1; // resume past the table; the loop's own ++ steps onto the next line
  }
  return ranges;
}

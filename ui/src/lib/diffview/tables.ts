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
import { CELL_ATTR, splitTokens, tokenChildren } from "$lib/diffview/rowTokens.ts";

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

/** Marks a table's card; its value is the table's 1-based header line, the key that
 * ties it to its range for idempotent reuse and for the card's coreStyles.ts
 * styling. */
export const TABLE_CARD_ATTR = "data-table-card";

/** Marks a table's gutter card — the line-number-column mirror of its content card,
 * keyed by the same header line. @pierre/diffs' selection walk
 * (InteractionManager.renderSelection) pairs the gutter and content columns by
 * direct-child index and THROWS when their child counts differ; a content card
 * collapses a table's N rows into one child, so without this mirror the columns
 * diverge and the throw kills the drag-selection highlight for the WHOLE view.
 * The gutter card is `display: contents` (set inline) so it is purely structural —
 * its cells still map to the shared subgrid row tracks and keep their library
 * styling — and it lands at the same child index as its content card.
 *
 * codeBlockScroll.ts mirrors its own cards the same way and the two are deliberately
 * NOT folded together: that pass cards a block only while it overflows, measured
 * through an injected reader, where a table is carded unconditionally. Merging them
 * would parameterize the whole wanted-set computation to share a dozen lines of DOM
 * plumbing. */
export const TABLE_GUTTER_CARD_ATTR = "data-table-card-gutter";

// Set on the token that IS a cell's opening pipe (and the row's closing pipe), so
// the sheet can ink the pipes as the table's borders while the cell around them
// takes its own treatment — which is what lets the delimiter row hide its dashes
// and keep its dividers.
const PIPE_ATTR = "data-table-pipe";

// The header row, and the delimiter row beneath it.
const HEAD_ATTR = "data-table-head";
const RULE_ATTR = "data-table-rule";

// A cell's column alignment, when its column declared one.
const ALIGN_ATTR = "data-table-align";

/** The columns a row's tokens must be cut at: every cell boundary, plus the column
 * after each opening pipe and before the row's closing pipe, so each pipe ends up as
 * a token of its own that PIPE_ATTR can mark. */
function cellCuts(text: string, cells: TableCell[]): number[] {
  const cuts = new Set<number>();
  for (const cell of cells) {
    cuts.add(cell.startCol);
    cuts.add(cell.endCol);
    if (text[cell.startCol] === "|") cuts.add(cell.startCol + 1);
  }
  const last = cells[cells.length - 1];
  if (last !== undefined && text[last.endCol - 1] === "|") cuts.add(last.endCol - 1);
  return [...cuts].sort((a, b) => a - b);
}

/** Whether `row` already carries exactly the cells `cells` describes. Compared by
 * count and text length rather than by rebuilding: an already-correct row must
 * mutate nothing, or SourceView's MutationObserver would re-fire every frame. */
function isCelled(row: Element, cells: TableCell[]): boolean {
  const existing = row.querySelectorAll(`:scope > [${CELL_ATTR}]`);
  if (existing.length !== cells.length) return false;
  return cells.every(
    (cell, i) => (existing[i]?.textContent ?? "").length === cell.endCol - cell.startCol,
  );
}

/** Returns a row's tokens to the row itself and drops the cells. */
function unCell(row: Element): void {
  for (const cell of row.querySelectorAll(`:scope > [${CELL_ATTR}]`)) {
    while (cell.firstChild !== null) row.insertBefore(cell.firstChild, cell);
    cell.remove();
  }
}

/** Splits `row`'s tokens on the cell boundaries and groups them under one element
 * per cell, so each cell becomes a grid item in the card's shared column tracks. */
function buildCells(row: Element, text: string, cells: TableCell[]): void {
  unCell(row);
  splitTokens(row, cellCuts(text, cells));
  const built = cells.map(() => row.ownerDocument.createElement("span"));
  let col = 0;
  for (const token of tokenChildren(row)) {
    const index = cells.findIndex((cell) => col >= cell.startCol && col < cell.endCol);
    (built[index === -1 ? built.length - 1 : index] ?? built[0])?.appendChild(token);
    col += token.textContent?.length ?? 0;
  }
  for (const cell of built) {
    cell.setAttribute(CELL_ATTR, "");
    // The pipes bracket the cell, so they are its first and last tokens when
    // present. A cell that is a bare pipe has one token and takes the mark once.
    if (cell.firstElementChild?.textContent === "|")
      cell.firstElementChild.setAttribute(PIPE_ATTR, "");
    if (cell.lastElementChild?.textContent === "|")
      cell.lastElementChild.setAttribute(PIPE_ATTR, "");
    row.appendChild(cell);
  }
}

/** Puts each column's declared alignment on the row's matching cell. Re-applied on
 * every pass rather than only at build, so a delimiter row edited to move a marker
 * lands even on rows whose cells are otherwise unchanged. */
function applyAlign(row: Element, align: (TableAlign | undefined)[]): void {
  row.querySelectorAll(`:scope > [${CELL_ATTR}]`).forEach((cell, i) => {
    const value = align[i];
    if (value === undefined) cell.removeAttribute(ALIGN_ATTR);
    else cell.setAttribute(ALIGN_ATTR, value);
  });
}

/** A range's content rows, wherever they currently sit — direct children before the
 * table is carded, the card's children after. */
function rowElements(root: ParentNode, range: TableRange): (HTMLElement | null)[] {
  return range.rows.map((row) =>
    root.querySelector<HTMLElement>(`[data-content] [data-line="${row.line}"]`),
  );
}

/** Whether `card` still holds exactly the range's rows, in order. A table that grew
 * or shrank keeps its header line as its key, so the key alone cannot say. */
function cardHoldsRange(card: Element, range: TableRange): boolean {
  const rows = card.querySelectorAll(":scope > [data-line]");
  if (rows.length !== range.rows.length) return false;
  return range.rows.every((row, i) => rows[i]?.getAttribute("data-line") === String(row.line));
}

/** Unwraps a card, returning its children to the column in place, then removes it.
 * Used for both the content card and its gutter mirror. */
function unwrapCard(column: Element, card: HTMLElement): void {
  while (card.firstChild !== null) column.insertBefore(card.firstChild, card);
  card.remove();
}

/** Wraps `rows` in a fresh card at their position. The card spans the table's row
 * tracks (grid-row) so its subgrid maps them back to the shared tracks and the
 * gutter numbers stay aligned, and carries the column count the sheet builds its
 * track list from. */
function wrapCard(content: Element, key: string, rows: HTMLElement[], columns: number): void {
  const card = content.ownerDocument.createElement("div");
  card.setAttribute(TABLE_CARD_ATTR, key);
  card.style.gridRow = `span ${rows.length}`;
  card.style.setProperty("--table-columns", String(columns));
  content.insertBefore(card, rows[0] ?? null);
  for (const row of rows) card.appendChild(row);
}

/** Mirrors a table's card into the gutter column so the two columns keep matching
 * direct-child counts (see TABLE_GUTTER_CARD_ATTR). */
function wrapGutterCard(gutter: Element, key: string, range: TableRange): void {
  const cells = range.rows
    .map((row) => gutter.querySelector<HTMLElement>(`:scope > [data-column-number="${row.line}"]`))
    .filter((cell): cell is HTMLElement => cell !== null);
  if (cells.length === 0) return;
  const card = gutter.ownerDocument.createElement("div");
  card.setAttribute(TABLE_GUTTER_CARD_ATTR, key);
  card.style.display = "contents";
  gutter.insertBefore(card, cells[0] ?? null);
  for (const cell of cells) card.appendChild(cell);
}

/**
 * Restructures every table in `ranges` into a real column-aligned table: its rows
 * move into one card that spans their row tracks and declares the table's column
 * count, and each row's tokens are grouped into the cells that land in those
 * columns. Rows are tagged `data-table-head` / `data-table-rule`, cells carry their
 * column's `data-table-align`, and each pipe is marked so the sheet can ink it as a
 * border. `root` is the source view's shadow root.
 *
 * Idempotent, and that is a hard requirement rather than a nicety: SourceView runs
 * this from a `MutationObserver` watching childList over the whole subtree, so a
 * pass that re-carded or re-celled a settled table would loop forever. A card that
 * still holds its range and a row that already carries its cells are both left
 * completely untouched.
 *
 * A row whose painted text is not the line that parsed is skipped rather than
 * celled — the library repaints asynchronously, so a row can be mid-flight — and
 * the next repaint brings this pass back to finish it. Its siblings are celled
 * regardless, so one unpainted row cannot stall the table.
 */
export function syncTableCards(root: ParentNode, ranges: TableRange[]): void {
  const content = root.querySelector<HTMLElement>("[data-content]");
  if (content === null) return;

  const wanted = new Map(ranges.map((range) => [String(range.start), range]));
  const headLines = new Set(ranges.map((r) => r.start));
  const ruleLines = new Set(ranges.map((r) => r.rule));

  for (const [key, range] of wanted) {
    const card = content.querySelector<HTMLElement>(`:scope > [${TABLE_CARD_ATTR}="${key}"]`);
    if (card !== null && !cardHoldsRange(card, range)) unwrapCard(content, card);
    if (card === null || !cardHoldsRange(card, range)) {
      const rows = rowElements(root, range).filter((row): row is HTMLElement => row !== null);
      if (rows.length === range.rows.length) {
        wrapCard(content, key, rows, range.align.length);
      }
    }
    for (const [i, row] of rowElements(root, range).entries()) {
      const spec = range.rows[i];
      if (row === null || spec === undefined) continue;
      const width = spec.cells[spec.cells.length - 1]?.endCol ?? 0;
      if ((row.textContent ?? "").length !== width) continue;
      if (!isCelled(row, spec.cells)) buildCells(row, row.textContent ?? "", spec.cells);
      applyAlign(row, range.align);
    }
  }

  // Retire the cards, cells and row tags of anything that is no longer a table.
  for (const card of content.querySelectorAll<HTMLElement>(`:scope > [${TABLE_CARD_ATTR}]`)) {
    if (!wanted.has(card.getAttribute(TABLE_CARD_ATTR) ?? "")) unwrapCard(content, card);
  }
  const inTable = new Set(ranges.flatMap((r) => r.rows.map((row) => row.line)));
  for (const row of root.querySelectorAll<HTMLElement>("[data-content] [data-line]")) {
    const line = Number(row.getAttribute("data-line"));
    if (!inTable.has(line)) unCell(row);
    row.toggleAttribute(HEAD_ATTR, headLines.has(line));
    row.toggleAttribute(RULE_ATTR, ruleLines.has(line));
  }

  const gutter = root.querySelector<HTMLElement>("[data-gutter]");
  if (gutter === null) return;
  for (const [key, range] of wanted) {
    if (gutter.querySelector(`:scope > [${TABLE_GUTTER_CARD_ATTR}="${key}"]`) !== null) continue;
    wrapGutterCard(gutter, key, range);
  }
  for (const card of gutter.querySelectorAll<HTMLElement>(`:scope > [${TABLE_GUTTER_CARD_ATTR}]`)) {
    if (!wanted.has(card.getAttribute(TABLE_GUTTER_CARD_ATTR) ?? "")) unwrapCard(gutter, card);
  }
}

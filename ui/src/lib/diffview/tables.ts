// GFM table classification for the markdown plan view (EXC-864). The plan renders
// as line-numbered markdown source (SourceView.svelte), so a table is just the run
// of source lines that form one — a header row, a delimiter row, and the body rows
// that agree with them on cell count. This module computes that run, and where each
// row's cells sit on its line, then restructures those rows into a real
// column-aligned table (syncTableCards, below).
//
// A table is the one construct in this epic that RESTRUCTURES rather than
// overdrawing in place: the `|` columns in the source do not line up with a table's
// columns, so alignment has to come from layout. Everything else about the source
// survives it — no character is added, removed, or moved, so copy, `/` search, vim
// motions and comment anchors all keep resolving against the same column space.
//
// Columns are 0-based and half-open, and each cell's extent INCLUDES the pipe that
// opens it (and, for the last cell, the one that closes the row). That is what makes
// the cells tile the line exactly with no gaps, which the render half needs in order
// to split a row's tokens on the boundaries without losing a glyph. The pipe is the
// cell's EDGE MARKER rather than its border: it stays in the text, where copy and
// search still find it, and is taken to `transparent`, while the rule the reader
// sees is a border the sheet paints on the cell.
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

// A line that cannot open or continue a table: blank, indented at all, or
// blockquote-prefixed. Both non-blank cases are carve-outs for the same reason —
// the prefix would need a column track of its own, and nothing in the epic asks for
// one. Indentation is the wider of the two: CommonMark would allow up to three
// spaces, so a table inside a list item classifies, but the render has nowhere to
// put the indent. It folds into the first cell ahead of that cell's pipe, and a
// pipe that is not the cell's first character is one the cell cannot hide or draw a
// rule for — one column reading as bare markdown beside painted rules, which is the
// exact look this construct exists to remove. Whole-table fallback to plain source
// is the honest degrade; an indented table renders as the source the author wrote.
const NOT_A_ROW = /^(?:\s*$|\s|>)/;

/** The column where a run of exactly `run` backticks closes the one opened at
 * `from - run`, or `-1` when nothing on the line closes it. Longer runs do not
 * count: `` ` `` cannot close ` `` `, which is the whole point of the spelling. */
function closingRun(line: string, from: number, run: number): number {
  const fence = "`".repeat(run);
  for (let i = line.indexOf(fence, from); i !== -1; i = line.indexOf(fence, i + 1)) {
    if (line[i - 1] !== "`" && line[i + run] !== "`") return i;
  }
  return -1;
}

/** The columns of every `|` on a line that delimits a cell. A backslash escapes the
 * character after it, so `\|` is a literal pipe inside a cell and `\\|` is a literal
 * backslash followed by a real delimiter; a pipe inside an inline-code span is
 * likewise the cell's own text. An unclosed backtick run opens no span, so the pipes
 * after it still delimit.
 *
 * The code-span rule is a DELIBERATE divergence from GFM, which requires `\|` even
 * inside a code span. In a view whose whole thesis is that the reader sees the source
 * they wrote, honouring what the author plainly meant beats matching the spec's
 * escape rule — and the spec's failure mode here is a silently wrong column count,
 * where ours is a table that reads as written. */
function pipeColumns(line: string): number[] {
  const columns: number[] = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\") {
      i++;
      continue;
    }
    if (line[i] === "|") {
      columns.push(i);
      continue;
    }
    if (line[i] !== "`") continue;
    let run = 1;
    while (line[i + run] === "`") run++;
    const close = closingRun(line, i + run, run);
    // Past the span, or past the run itself when it never closes; the loop's own
    // ++ steps onto the next column either way.
    i = close === -1 ? i + run - 1 : close + run - 1;
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
 * last one, so it marks that cell's right-hand edge.
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
 *
 * Four shapes fall back, and the fourth is the non-obvious one. A quoted table and a
 * fenced one are excluded by NOT_A_ROW and by `codeRanges`; a ragged one ends early.
 * The fourth is a ONE-column table written with only a trailing pipe — `a |` over
 * `- |`. With a single pipe there is nothing to distinguish a trailing delimiter from
 * a separator, so rowCells reads two cells, the second is empty, and the delimiter
 * test fails. Valid GFM, rendered as raw source; the leading-pipe and bare forms of
 * the same table (`| a |`, `a`) both parse.
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
 * Both cards take a contiguous RUN of their column's children rather than the keyed
 * cells alone (see unwrappedSlice), so an open comment's annotation row and its
 * gutter buffer ride inside their card at the same index in both columns. That is
 * what keeps the counts equal by construction rather than by coincidence.
 *
 * codeBlockScroll.ts mirrors its own cards the same way and the two are deliberately
 * NOT folded together: that pass cards a block only while it overflows, measured
 * through an injected reader, where a table is carded unconditionally. Merging them
 * would parameterize the whole wanted-set computation to share a dozen lines of DOM
 * plumbing. */
export const TABLE_GUTTER_CARD_ATTR = "data-table-card-gutter";

// Set on the token that IS a cell's opening pipe (and the row's closing pipe). The
// sheet takes those tokens to transparent: the character stays in the row, where copy
// and `/` search still find it, and the column rule is painted in the space it leaves.
const PIPE_ATTR = "data-table-pipe";

// The header row, and the delimiter row beneath it.
const HEAD_ATTR = "data-table-head";
const RULE_ATTR = "data-table-rule";

// A cell's column alignment, when its column declared one.
const ALIGN_ATTR = "data-table-align";

// Which of a cell's own edges carry a pipe. The sheet paints the column rules from
// this rather than probing for a pipe token with :has() on every cell — and it is what
// keeps a table written without a leading pipe from drawing a phantom rule down column
// 0, where there is no character for a rule to stand in for.
const EDGE_ATTR = "data-table-edge";

/** The columns a row's tokens must be cut at: every cell boundary, plus the column
 * after each opening pipe and before the row's closing pipe, so each pipe ends up as
 * a token of its own that PIPE_ATTR can mark. */
function cellCuts(text: string, cells: TableCell[]): number[] {
  // Cut only at a real DELIMITER. A cell's own text can end in an escaped `\|`,
  // which is a literal pipe the author wrote and not the row's closing one — cutting
  // it out would hide the glyph and draw a table rule where the source has neither.
  const delimiters = new Set(pipeColumns(text));
  const cuts = new Set<number>();
  for (const cell of cells) {
    cuts.add(cell.startCol);
    cuts.add(cell.endCol);
    if (delimiters.has(cell.startCol)) cuts.add(cell.startCol + 1);
  }
  const last = cells[cells.length - 1];
  if (last !== undefined && delimiters.has(last.endCol - 1)) cuts.add(last.endCol - 1);
  return [...cuts].sort((a, b) => a - b);
}

/** Whether `row` already carries exactly the cells `cells` describes. Compared by
 * count and text length rather than by rebuilding: an already-correct row must
 * mutate nothing, or SourceView's MutationObserver would re-fire every frame.
 *
 * Counts the row's CELLS rather than its children, and that is the difference
 * between settling and looping. inlineImages.ts appends its <img> to the row after
 * this pass has celled it, so a celled row's child count legitimately exceeds its
 * cell count; reading it as unsettled would rebuild the row every frame, the image
 * pass would re-append, and neither would ever converge. */
function isCelled(row: Element, cells: TableCell[]): boolean {
  const existing = [...row.children].filter((el) => el.hasAttribute(CELL_ATTR));
  if (existing.length !== cells.length) return false;
  return cells.every(
    (cell, i) => (existing[i]?.textContent ?? "").length === cell.endCol - cell.startCol,
  );
}

/** Returns a row's tokens to the row itself and drops the cells. A no-op on a row that
 * was never celled, which the retire pass below calls it on for every line of the
 * document — hence the first-child probe rather than a query. */
function unCell(row: Element): void {
  if (row.firstElementChild?.hasAttribute(CELL_ATTR) !== true) return;
  for (const cell of [...row.children]) {
    // Another pass's node — an appended <img> — holds no tokens to hoist, and
    // removing it would destroy work this pass does not own.
    if (!cell.hasAttribute(CELL_ATTR)) continue;
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
    // The cells tile [0, line.length) and the caller has already matched the row's
    // text length to the last cell's end, so every token lands in exactly one.
    built[cells.findIndex((cell) => col >= cell.startCol && col < cell.endCol)]?.appendChild(token);
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
    // Read back off the tokens just marked rather than re-testing the text, so the
    // hidden glyphs and the rules drawn where they were can never disagree.
    const opens = cell.firstElementChild?.hasAttribute(PIPE_ATTR) === true;
    const closes = cell.lastElementChild?.hasAttribute(PIPE_ATTR) === true;
    const edge = opens && closes ? "both" : opens ? "start" : closes ? "end" : null;
    if (edge !== null) cell.setAttribute(EDGE_ATTR, edge);
    row.appendChild(cell);
  }
  // Anything left is another pass's node rather than a token — inlineImages.ts's
  // <img>, which holds no characters and so fell through the distribution above.
  // It ends up ahead of the cells, where it would take the first column track; move
  // it past them, where the sheet spans it across the row instead. Only ever a real
  // move: the cells were appended just now, so nothing is already last.
  for (const foreign of [...row.children]) {
    if (!foreign.hasAttribute(CELL_ATTR)) row.appendChild(foreign);
  }
}

/** Puts each column's declared alignment on the row's matching cell. Applied on every
 * pass rather than only at build because the observer does not watch attributes, so
 * writing them unconditionally is free and costs one code path instead of two. */
function applyAlign(row: Element, align: (TableAlign | undefined)[]): void {
  let i = 0;
  for (const cell of row.querySelectorAll(`:scope > [${CELL_ATTR}]`)) {
    const value = align[i++];
    if (value === undefined) cell.removeAttribute(ALIGN_ATTR);
    else cell.setAttribute(ALIGN_ATTR, value);
  }
}

/** A range's source lines, the key both columns are walked by. */
function lineNumbers(range: TableRange): number[] {
  return range.rows.map((row) => row.line);
}

/** A range's DIRECT children of one column, from its first keyed cell through its
 * last — the whole contiguous run, not just the keyed cells in it.
 *
 * Direct children because that is what the wrap path needs: `insertBefore` places the
 * card relative to a child of the column, and passing it a cell nested somewhere else
 * throws `NotFoundError`, which would escape the repaint pass and take every
 * decoration below this one with it. Returns `null` unless every one of `lines` is
 * present, unwrapped, and in order.
 *
 * The whole run because the library interleaves its own rows between a table's:
 * a comment on line N emits an annotation row right after N's row in the content
 * column and a `data-gutter-buffer` right after N's cell in the gutter
 * (FileRenderer.processFileResult). Moving only the keyed cells would strand those
 * behind the card, so a mid-table comment would render below the whole table. Taking
 * the run also keeps the two columns index-parallel by construction rather than by
 * two separately-derived lists happening to agree, which is the divergence
 * TABLE_GUTTER_CARD_ATTR exists to prevent.
 *
 * Cheap: walked by sibling rather than queried per line — one query plus a walk of
 * the table's own length, where a query per row is what EXC-864 measured at ~2,800
 * selector matches per repaint. */
function unwrappedSlice(column: Element, attr: string, lines: number[]): Element[] | null {
  const first = lines[0];
  const last = lines[lines.length - 1];
  if (first === undefined || last === undefined) return null;
  const head = column.querySelector(`:scope > [${attr}="${first}"]`);
  if (head === null) return null;
  const slice: Element[] = [];
  const keyed: string[] = [];
  for (let el: Element | null = head; el !== null; el = el.nextElementSibling) {
    slice.push(el);
    const key = el.getAttribute(attr);
    if (key !== null) keyed.push(key);
    if (key !== String(last)) continue;
    if (keyed.length !== lines.length) return null;
    if (!keyed.every((k, i) => k === String(lines[i]))) return null;
    // Past the last row, take any comment anchored TO it: the library emits that row
    // after its own, so stopping at `last` would leave a comment on the table's final
    // row outside the card while one on any other row is inside it — two comments on
    // one table, drawn at two different widths. Nothing else can follow, since the run
    // is bounded by the table's own lines.
    while (
      el.nextElementSibling !== null &&
      !el.nextElementSibling.hasAttribute(attr) &&
      el.nextElementSibling.matches("[data-line-annotation], [data-gutter-buffer]")
    ) {
      el = el.nextElementSibling;
      slice.push(el);
    }
    return slice;
  }
  return null;
}

/** Whether `card` still holds exactly the range's rows, in order, and is still sized
 * for everything it holds. The row check is defensive — a card is keyed by its header
 * line, so the key alone cannot say whether the table under it grew or shrank, and in
 * practice a content change recreates the view outright. The span check is what keeps
 * `grid-row` honest now that the card also carries the library's comment rows: those
 * arrive and leave through a full re-render, so this is likewise belt and braces, but
 * it is the only thing standing between a stale span and a table drawn one track
 * short. */
function cardHoldsRange(card: HTMLElement, range: TableRange): boolean {
  const rows = card.querySelectorAll(":scope > [data-line]");
  if (rows.length !== range.rows.length) return false;
  if (card.style.gridRow !== `span ${card.children.length}`) return false;
  if (card.style.getPropertyValue("--table-columns") !== String(range.align.length)) return false;
  return range.rows.every((row, i) => rows[i]?.getAttribute("data-line") === String(row.line));
}

/** Unwraps a card, returning its children to the column in place, then removes it.
 * Used for both the content card and its gutter mirror. */
function unwrapCard(column: Element, card: HTMLElement): void {
  while (card.firstChild !== null) column.insertBefore(card.firstChild, card);
  card.remove();
}

/** Wraps `slice` in a fresh card at its position. The card spans one parent row track
 * per child it takes — its own rows plus any annotation row among them — so its
 * subgrid maps them back to the shared tracks and the gutter numbers stay aligned,
 * and carries the column count the sheet builds its track list from. */
function wrapCard(content: Element, key: string, slice: Element[], columns: number): void {
  const card = content.ownerDocument.createElement("div");
  card.setAttribute(TABLE_CARD_ATTR, key);
  card.style.gridRow = `span ${slice.length}`;
  card.style.setProperty("--table-columns", String(columns));
  content.insertBefore(card, slice[0] ?? null);
  for (const child of slice) card.appendChild(child);
}

/** Mirrors a table's card into the gutter column so the two columns keep matching
 * direct-child counts (see TABLE_GUTTER_CARD_ATTR). Refuses on anything short of the
 * range's full run of cells: a partial mirror is the very divergence this exists to
 * prevent, so a missing cell must leave the gutter flat rather than half-carded. */
function wrapGutterCard(gutter: Element, key: string, lines: number[]): void {
  const slice = unwrappedSlice(gutter, "data-column-number", lines);
  if (slice === null) return;
  const card = gutter.ownerDocument.createElement("div");
  card.setAttribute(TABLE_GUTTER_CARD_ATTR, key);
  card.style.display = "contents";
  gutter.insertBefore(card, slice[0] ?? null);
  for (const cell of slice) card.appendChild(cell);
}

/**
 * Restructures every table in `ranges` into a real column-aligned table: its rows
 * move into one card that spans their row tracks and declares the table's column
 * count, and each row's tokens are grouped into the cells that land in those
 * columns. Rows are tagged `data-table-head` / `data-table-rule`, cells carry their
 * column's `data-table-align` and the `data-table-edge` the sheet paints its column
 * rules from, and each pipe is marked so the sheet can hide the glyph it draws over.
 * `root` is the source view's shadow root.
 *
 * Idempotent, and that is a hard requirement rather than a nicety: SourceView runs
 * this from a `MutationObserver` watching childList over the whole subtree, so a
 * pass that re-carded or re-celled a settled table would loop forever. A card that
 * still holds its range and a row that already carries its cells are both left
 * completely untouched.
 *
 * A row whose painted text LENGTH is not the parsed line's is skipped rather than celled,
 * and the next repaint brings this pass back to finish it. That is a guard on the two
 * inputs agreeing rather than a known race: `ranges` is derived from the rendered text
 * and the rows are the library's, so a mismatch means they came from different content
 * and celling on those columns would cut in the wrong places. Its siblings are celled
 * regardless, so one such row cannot stall the table.
 */
export function syncTableCards(root: ParentNode, ranges: TableRange[]): void {
  const content = root.querySelector<HTMLElement>("[data-content]");
  if (content === null) return;

  const wanted = new Map(ranges.map((range) => [String(range.start), range]));
  const headLines = new Set(ranges.map((r) => r.start));
  const ruleLines = new Set(ranges.map((r) => r.rule));

  // ONE walk of the content column, reused by the cell loop and the retire loop
  // below. A query per table row is the shape EXC-864 measured at ~2,800 selector
  // matches per repaint, and this pass runs after every one of them. The list is
  // static, so it survives the wrap and unwrap below: those re-parent rows rather
  // than replacing them, so every element in it stays the row it was.
  const rows = new Map<number, HTMLElement>();
  for (const row of content.querySelectorAll<HTMLElement>("[data-line]")) {
    rows.set(Number(row.getAttribute("data-line")), row);
  }

  // The keys that actually carry a content card, which is what the gutter mirrors.
  // Mirroring `wanted` instead would card the gutter for a table whose content card
  // was never made, and a gutter card with no content counterpart is exactly the
  // child-count divergence TABLE_GUTTER_CARD_ATTR exists to prevent.
  const carded = new Map<string, TableRange>();
  for (const [key, range] of wanted) {
    const card = content.querySelector<HTMLElement>(`:scope > [${TABLE_CARD_ATTR}="${key}"]`);
    if (card !== null && cardHoldsRange(card, range)) {
      carded.set(key, range);
    } else {
      if (card !== null) unwrapCard(content, card);
      const slice = unwrappedSlice(content, "data-line", lineNumbers(range));
      if (slice !== null) {
        wrapCard(content, key, slice, range.align.length);
        carded.set(key, range);
      }
    }
    for (const spec of range.rows) {
      const row = rows.get(spec.line);
      if (row === undefined) continue;
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
  for (const [line, row] of rows) {
    if (!inTable.has(line)) unCell(row);
    row.toggleAttribute(HEAD_ATTR, headLines.has(line));
    row.toggleAttribute(RULE_ATTR, ruleLines.has(line));
  }

  const gutter = root.querySelector<HTMLElement>("[data-gutter]");
  if (gutter === null) return;
  for (const [key, range] of carded) {
    if (gutter.querySelector(`:scope > [${TABLE_GUTTER_CARD_ATTR}="${key}"]`) !== null) continue;
    wrapGutterCard(gutter, key, lineNumbers(range));
  }
  for (const card of gutter.querySelectorAll<HTMLElement>(`:scope > [${TABLE_GUTTER_CARD_ATTR}]`)) {
    if (!carded.has(card.getAttribute(TABLE_GUTTER_CARD_ATTR) ?? "")) unwrapCard(gutter, card);
  }
}

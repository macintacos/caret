import "@ui/test-setup.ts";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { type CodeBlockRange, codeBlockRanges } from "$lib/diffview/codeBlocks.ts";
import { CELL_ATTR } from "$lib/diffview/rowTokens.ts";
import {
  syncTableCards,
  TABLE_CARD_ATTR,
  TABLE_GUTTER_CARD_ATTR,
  type TableRange,
  tableRanges,
} from "$lib/diffview/tables.ts";

// tableRanges classifies which lines of a rendered plan form a GFM table, and
// where each row's cells sit on its line, so the source view can restructure
// those rows into a real column-aligned table (EXC-864). Ranges are 1-based and
// inclusive over the DISPLAY text — the same space codeBlockRanges and the inline
// layers index — and every cell extent tiles its line exactly, opening pipe
// included, so the DOM pass can split a row's tokens on them without gaps.

/** The lines of a table, as one string, for the readable fixtures below. */
const lines = (...rows: string[]): string => rows.join("\n");

/** Cell extents as [start, end) pairs, which read far better in an expectation
 * than the object form does. */
const extents = (cells: { startCol: number; endCol: number }[]): [number, number][] =>
  cells.map((c) => [c.startCol, c.endCol]);

const NO_CODE: CodeBlockRange[] = [];

describe("tableRanges", () => {
  test("returns no ranges for prose", () => {
    expect(tableRanges("just prose\nmore prose\n", NO_CODE)).toEqual([]);
  });

  test("spans a table from its header row through its last body row", () => {
    const text = lines("intro", "| a | b |", "| - | - |", "| 1 | 2 |", "outro");
    const [table] = tableRanges(text, NO_CODE);
    expect(table?.start).toBe(2);
    expect(table?.rule).toBe(3);
    expect(table?.end).toBe(4);
  });

  test("cuts each row into cells that tile the line, opening pipe included", () => {
    // Columns:      0123456789
    const text = lines("| a | b |", "| - | - |");
    const [table] = tableRanges(text, NO_CODE);
    // Cell 1 is `| a `, cell 2 is `| b |` — the closing pipe joins the last cell
    // so it marks the row's right-hand edge.
    expect(extents(table?.rows[0]?.cells ?? [])).toEqual([
      [0, 4],
      [4, 9],
    ]);
  });

  test("accepts rows with no leading or trailing pipe", () => {
    const text = lines("a | b", "- | -");
    const [table] = tableRanges(text, NO_CODE);
    expect(table?.end).toBe(2);
    // The first cell opens the line rather than a pipe; the second opens at its pipe.
    expect(extents(table?.rows[0]?.cells ?? [])).toEqual([
      [0, 2],
      [2, 5],
    ]);
  });

  test("reads the alignment markers off the delimiter row", () => {
    const text = lines("| a | b | c | d |", "| :- | :-: | -: | - |");
    const [table] = tableRanges(text, NO_CODE);
    expect(table?.align).toEqual(["left", "center", "right", undefined]);
  });

  test("does not split a cell on an escaped pipe", () => {
    const text = lines("| a \\| b |", "| - |");
    const [table] = tableRanges(text, NO_CODE);
    expect(table?.rows[0]?.cells).toHaveLength(1);
  });

  test("does not split a cell on a pipe inside an inline-code span", () => {
    const text = lines("| `a|b` | c |", "| - | - |");
    const [table] = tableRanges(text, NO_CODE);
    expect(table?.rows[0]?.cells).toHaveLength(2);
  });

  test("closes a double-backtick span only on a matching double backtick", () => {
    // The lone backtick mid-span is what a length-blind scan would close on,
    // letting the pipe after it split the cell.
    const text = lines("| `` a ` b|c `` | d |", "| - | - |");
    const [table] = tableRanges(text, NO_CODE);
    expect(table?.rows[0]?.cells).toHaveLength(2);
  });

  test("leaves an unterminated backtick run as literal text", () => {
    // Nothing closes the run, so it opens no span and the pipes after it still
    // delimit — otherwise the whole rest of the line would fold into one cell.
    const text = lines("| ` a | b |", "| - | - |");
    const [table] = tableRanges(text, NO_CODE);
    expect(table?.rows[0]?.cells).toHaveLength(2);
  });

  test("ignores a table inside a fenced code block", () => {
    const text = lines("```md", "| a | b |", "| - | - |", "```");
    expect(tableRanges(text, [{ start: 1, end: 4 }])).toEqual([]);
  });

  test("returns nothing when the delimiter row is missing", () => {
    const text = lines("| a | b |", "| 1 | 2 |");
    expect(tableRanges(text, NO_CODE)).toEqual([]);
  });

  test("returns nothing when the delimiter row's cell count differs from the header's", () => {
    const text = lines("| a | b |", "| - |", "| 1 | 2 |");
    expect(tableRanges(text, NO_CODE)).toEqual([]);
  });

  test("ends the table at a ragged body row, leaving it to raw source", () => {
    const text = lines("| a | b |", "| - | - |", "| 1 | 2 |", "| 3 |", "| 4 | 5 |");
    const [table] = tableRanges(text, NO_CODE);
    expect(table?.end).toBe(3);
    expect(tableRanges(text, NO_CODE)).toHaveLength(1);
  });

  test("keeps a header-only table, which is valid GFM", () => {
    const text = lines("| a | b |", "| - | - |", "", "prose");
    const [table] = tableRanges(text, NO_CODE);
    expect(table?.start).toBe(1);
    expect(table?.end).toBe(2);
  });

  test("ends the table at a blank line", () => {
    const text = lines("| a | b |", "| - | - |", "| 1 | 2 |", "", "| 3 | 4 |");
    expect(tableRanges(text, NO_CODE)).toHaveLength(1);
  });

  test("falls back on a one-column table written with only a trailing pipe", () => {
    // With a single pipe there is nothing to tell a trailing delimiter from a
    // separator, so the delimiter row reads as two cells and fails. Valid GFM,
    // rendered as raw source — the leading-pipe form of the same table parses.
    expect(tableRanges(lines("a |", "- |"), NO_CODE)).toEqual([]);
    expect(tableRanges(lines("| a |", "| - |"), NO_CODE)).toHaveLength(1);
  });

  test("does not detect a blockquote-prefixed table", () => {
    // A quoted table renders as raw source: the `>` prefix would need a column
    // track of its own, and nothing in the epic asks for one yet.
    const text = lines("> | a | b |", "> | - | - |", "> | 1 | 2 |");
    expect(tableRanges(text, NO_CODE)).toEqual([]);
  });

  test("finds each of several tables separately", () => {
    const text = lines("| a |", "| - |", "", "prose", "", "| b |", "| - |");
    expect(tableRanges(text, NO_CODE).map((t) => t.start)).toEqual([1, 6]);
  });
});

// The seed plan is the fixed surface plan-view rendering is compared against
// (doc/DEVELOPMENT.md § The markdown showcase), so its tables are what a reviewer
// actually sees drawn. Read from disk, like icons.test.ts reads the icon tree, so
// that editing a showcase row into raggedness fails here rather than silently
// dropping a table back to raw source in the browser.
const FIXTURE = readFileSync(
  join(import.meta.dir, "../../../../scripts/tasks/dev/fake-plan.md"),
  "utf8",
);

describe("the seed plan's tables", () => {
  const found = tableRanges(FIXTURE, codeBlockRanges(FIXTURE));

  test("every table parses whole, with no row left behind as raw source", () => {
    const fixtureLines = FIXTURE.split("\n");
    for (const table of found) {
      // `end` is 1-based, so this indexes the line AFTER the table. A pipe there
      // means a row that should have been part of it was cut off — the raggedness
      // EXC-1063's review found and fixed in two of the showcase's three tables.
      expect(fixtureLines[table.end] ?? "").not.toContain("|");
    }
  });

  test("covers the showcase's narrow, wide, wrapping and inline-markup shapes", () => {
    // The `### Tabular data` trio plus the four tables that predate it, plus the
    // wrapping one under `## Tables`.
    expect(found).toHaveLength(8);
    // The widest is what drives the horizontal-scroll path in a real browser.
    expect(Math.max(...found.map((t) => t.align.length))).toBe(10);
    // And one cell runs past the sheet's 44ch per-column cap, which is the only thing
    // that makes a column WRAP rather than merely grow. It is stated as a property of
    // the fixture rather than left to the browser suite: shorten that cell and the
    // showcase silently stops demonstrating the case it was added for.
    const widest = Math.max(
      ...found.flatMap((table) =>
        table.rows.flatMap((row) => row.cells.map((cell) => cell.endCol - cell.startCol)),
      ),
    );
    expect(widest).toBeGreaterThan(44);
  });

  test("respects the alignment markers the showcase writes", () => {
    expect(found.map((t) => t.align)).toContainEqual(["left", "center", "right"]);
  });
});

// syncTableCards is the DOM half: it moves a table's rows into one card, groups each
// row's tokens into cells, and mirrors the card in the gutter so @pierre/diffs'
// selection walk still finds the two columns balanced. These cases pin which rows are
// carded, which tokens are celled, where the column rules are marked to be drawn, and
// that a settled pass mutates nothing. The rendered result is covered by
// test/e2e/tables.e2e.ts.

/** A stand-in for the library's rendered grid: a gutter cell and a one-token
 * content row per line, the shape @pierre/diffs paints before any pass runs. */
function build(text: string): { root: HTMLElement; ranges: TableRange[] } {
  const root = document.createElement("div");
  const gutter = document.createElement("div");
  gutter.setAttribute("data-gutter", "");
  const content = document.createElement("div");
  content.setAttribute("data-content", "");
  text.split("\n").forEach((line, i) => {
    const cell = document.createElement("div");
    cell.setAttribute("data-column-number", String(i + 1));
    cell.textContent = String(i + 1);
    gutter.appendChild(cell);
    const row = document.createElement("div");
    row.setAttribute("data-line", String(i + 1));
    const token = document.createElement("span");
    token.textContent = line;
    row.appendChild(token);
    content.appendChild(row);
  });
  root.append(gutter, content);
  return { root, ranges: tableRanges(text, NO_CODE) };
}

/** Every cell of a row, as its text. */
function cellTexts(root: HTMLElement, line: number): string[] {
  const row = root.querySelector(`[data-line="${line}"]`);
  return [...(row?.querySelectorAll(`:scope > [${CELL_ATTR}]`) ?? [])].map(
    (c) => c.textContent ?? "",
  );
}

/** Every cell of a row, as the edges it declares carry a pipe. */
function cellEdges(root: HTMLElement, line: number): (string | null)[] {
  const row = root.querySelector(`[data-line="${line}"]`);
  return [...(row?.querySelectorAll(`:scope > [${CELL_ATTR}]`) ?? [])].map((c) =>
    c.getAttribute("data-table-edge"),
  );
}

/** The library's annotation row for `line` plus its gutter buffer, placed where
 * FileRenderer places them: immediately after that line's own cell in each column.
 * A comment on a mid-table line therefore lands INSIDE the run of rows the card
 * takes, which is the case EXC-865 exists for. */
function openComment(root: HTMLElement, line: number): void {
  const row = root.querySelector(`[data-content] [data-line="${line}"]`);
  const annotation = document.createElement("div");
  annotation.setAttribute("data-line-annotation", `0,${line}`);
  row?.parentElement?.insertBefore(annotation, row.nextSibling);
  const number = root.querySelector(`[data-gutter] [data-column-number="${line}"]`);
  const buffer = document.createElement("div");
  buffer.setAttribute("data-gutter-buffer", "annotation");
  number?.parentElement?.insertBefore(buffer, number.nextSibling);
}

/** A column's children as their keying attribute, or `annotation` for the rows the
 * library interleaves — the shape both columns must agree on. */
function slotOrder(parent: Element | null | undefined, attr: string): string[] {
  return [...(parent?.children ?? [])].map((el) => el.getAttribute(attr) ?? "annotation");
}

const SIMPLE = ["prose", "| a | b |", "| - | - |", "| 1 | 2 |"].join("\n");

/** Two body rows, so a comment can sit in the MIDDLE of the table rather than
 * only after its last row (where the card's own boundary would hide the bug). */
const TWO_BODY = ["prose", "| a | b |", "| - | - |", "| 1 | 2 |", "| 3 | 4 |"].join("\n");

test("wraps a table's rows in one card keyed by its first line", () => {
  const { root, ranges } = build(SIMPLE);
  syncTableCards(root, ranges);
  const card = root.querySelector(`[data-content] > [${TABLE_CARD_ATTR}="2"]`);
  expect(card?.querySelectorAll(":scope > [data-line]")).toHaveLength(3);
  // The prose line is untouched and stays a direct child.
  expect(root.querySelector('[data-content] > [data-line="1"]')).not.toBeNull();
});

test("spans the card across its rows' tracks and names its column count", () => {
  const { root, ranges } = build(SIMPLE);
  syncTableCards(root, ranges);
  const card = root.querySelector<HTMLElement>(`[${TABLE_CARD_ATTR}="2"]`);
  expect(card?.style.gridRow).toBe("span 3");
  expect(card?.style.getPropertyValue("--table-columns")).toBe("2");
});

test("groups each row's tokens into cells that tile the line", () => {
  const { root, ranges } = build(SIMPLE);
  syncTableCards(root, ranges);
  expect(cellTexts(root, 2)).toEqual(["| a ", "| b |"]);
  expect(cellTexts(root, 4)).toEqual(["| 1 ", "| 2 |"]);
});

test("gives each pipe its own element, so the sheet can hide it", () => {
  const { root, ranges } = build(SIMPLE);
  syncTableCards(root, ranges);
  const row = root.querySelector('[data-line="2"]');
  expect([...(row?.querySelectorAll("[data-table-pipe]") ?? [])].map((p) => p.textContent)).toEqual(
    ["|", "|", "|"],
  );
});

test("marks the edges where a cell's own pipes sit, which is where the rules go", () => {
  const { root, ranges } = build(SIMPLE);
  syncTableCards(root, ranges);
  // `| a ` opens on a pipe; `| b |` opens and closes on one, so it draws the divider
  // before it AND the table's right-hand rule.
  expect(cellEdges(root, 2)).toEqual(["start", "both"]);
});

test("marks no edge on a cell with no pipe of its own", () => {
  // GFM makes the leading pipe optional. The first cell of such a row has no
  // character at column 0 for a rule to stand in for, so it must draw none — a
  // rule there would be the one mark on the table that is not in the source.
  const { root, ranges } = build(["a | b", "- | -", "1 | 2"].join("\n"));
  syncTableCards(root, ranges);
  expect(cellTexts(root, 1)).toEqual(["a ", "| b"]);
  expect(cellEdges(root, 1)).toEqual([null, "start"]);
});

test("tags the header row and the delimiter row", () => {
  const { root, ranges } = build(SIMPLE);
  syncTableCards(root, ranges);
  expect(root.querySelector('[data-line="2"]')?.hasAttribute("data-table-head")).toBe(true);
  expect(root.querySelector('[data-line="3"]')?.hasAttribute("data-table-rule")).toBe(true);
  expect(root.querySelector('[data-line="4"]')?.hasAttribute("data-table-head")).toBe(false);
});

test("puts each column's alignment on every row's cell", () => {
  const { root, ranges } = build(["| a | b | c |", "| :- | :-: | -: |"].join("\n"));
  syncTableCards(root, ranges);
  const row = root.querySelector('[data-line="1"]');
  expect(
    [...(row?.querySelectorAll(`[${CELL_ATTR}]`) ?? [])].map((c) =>
      c.getAttribute("data-table-align"),
    ),
  ).toEqual(["left", "center", "right"]);
});

test("mirrors the card in the gutter so the two columns keep matching counts", () => {
  const { root, ranges } = build(SIMPLE);
  syncTableCards(root, ranges);
  const gutter = root.querySelector("[data-gutter]");
  const content = root.querySelector("[data-content]");
  expect(gutter?.children).toHaveLength(content?.children.length ?? -1);
  expect(gutter?.querySelector(`[${TABLE_GUTTER_CARD_ATTR}="2"]`)?.children).toHaveLength(3);
});

test("leaves the gutter flat when one of its cells is missing", () => {
  // A partial mirror is the very divergence the mirror exists to prevent: half a
  // gutter card is worse than none, because renderSelection THROWS on unequal child
  // counts and takes drag selection down for the whole view.
  const { root, ranges } = build(SIMPLE);
  root.querySelector('[data-gutter] [data-column-number="3"]')?.remove();
  syncTableCards(root, ranges);
  expect(root.querySelector(`[${TABLE_GUTTER_CARD_ATTR}]`)).toBeNull();
});

test("carries a mid-table comment's row into the card, in place", () => {
  const { root, ranges } = build(TWO_BODY);
  // A repaint rebuilds the column flat and re-emits the annotation row, so the pass
  // always meets this case unwrapped — which is why the card takes the whole run of
  // children between its first and last row rather than the rows alone.
  openComment(root, 4);
  syncTableCards(root, ranges);
  const card = root.querySelector(`[data-content] > [${TABLE_CARD_ATTR}="2"]`);
  expect(slotOrder(card, "data-line")).toEqual(["2", "3", "4", "annotation", "5"]);
  expect(root.querySelector(`[data-content] > [data-line-annotation]`)).toBeNull();
});

test("carries the comment's gutter buffer into the mirror at the same index", () => {
  const { root, ranges } = build(TWO_BODY);
  openComment(root, 4);
  syncTableCards(root, ranges);
  const mirror = root.querySelector(`[${TABLE_GUTTER_CARD_ATTR}="2"]`);
  expect(slotOrder(mirror, "data-column-number")).toEqual(["2", "3", "4", "annotation", "5"]);
});

test("carries a comment on the table's LAST row into the card too", () => {
  // Left outside, it would still land in the right place — but it would be drawn at the
  // uncarded width, so two comments on one table would not match.
  const { root, ranges } = build(TWO_BODY);
  openComment(root, 5);
  syncTableCards(root, ranges);
  const card = root.querySelector(`[data-content] > [${TABLE_CARD_ATTR}="2"]`);
  expect(slotOrder(card, "data-line")).toEqual(["2", "3", "4", "5", "annotation"]);
  const mirror = root.querySelector(`[${TABLE_GUTTER_CARD_ATTR}="2"]`);
  expect(slotOrder(mirror, "data-column-number")).toEqual(["2", "3", "4", "5", "annotation"]);
});

test("re-cards a table whose card no longer spans what it holds", () => {
  // grid-row is what maps the card's children onto the parent's row tracks, so a card
  // holding the right rows at the wrong span draws the table a track short.
  const { root, ranges } = build(TWO_BODY);
  syncTableCards(root, ranges);
  const card = root.querySelector<HTMLElement>(`[${TABLE_CARD_ATTR}="2"]`);
  card?.appendChild(document.createElement("div"));
  syncTableCards(root, ranges);
  expect(root.querySelector<HTMLElement>(`[${TABLE_CARD_ATTR}="2"]`)?.style.gridRow).toBe("span 4");
});

test("keeps the two columns matching with a mid-table comment open", () => {
  const { root, ranges } = build(TWO_BODY);
  openComment(root, 4);
  syncTableCards(root, ranges);
  const gutter = root.querySelector("[data-gutter]");
  const content = root.querySelector("[data-content]");
  expect(gutter?.children).toHaveLength(content?.children.length ?? -1);
});

test("keeps the two columns matching when the table is malformed", () => {
  // A ragged body row ends the table early, so the range covers fewer lines than the
  // pipes on the page suggest. Whatever it covers, the columns must still agree —
  // this is the failure that takes drag selection down for the WHOLE view, not just
  // for the table.
  const { root, ranges } = build(
    ["| a | b |", "| - | - |", "| 1 | 2 |", "| 3 | 4 | 5 |", "| 6 | 7 |"].join("\n"),
  );
  syncTableCards(root, ranges);
  const gutter = root.querySelector("[data-gutter]");
  const content = root.querySelector("[data-content]");
  expect(gutter?.children).toHaveLength(content?.children.length ?? -1);
  // The ragged row and everything after it stay plain source rows.
  expect(cellTexts(root, 4)).toEqual([]);
  expect(cellTexts(root, 5)).toEqual([]);
});

test("cards nothing at all when the delimiter row's column count disagrees", () => {
  const { root, ranges } = build(["| a | b |", "| - | - | - |", "| 1 | 2 |"].join("\n"));
  syncTableCards(root, ranges);
  expect(root.querySelector(`[${TABLE_CARD_ATTR}]`)).toBeNull();
  expect(root.querySelector(`[${CELL_ATTR}]`)).toBeNull();
  const gutter = root.querySelector("[data-gutter]");
  const content = root.querySelector("[data-content]");
  expect(gutter?.children).toHaveLength(content?.children.length ?? -1);
});

test("returns a carded comment's row to its column when the table is retired", () => {
  const { root, ranges } = build(TWO_BODY);
  openComment(root, 4);
  syncTableCards(root, ranges);
  syncTableCards(root, []);
  expect(slotOrder(root.querySelector("[data-content]"), "data-line")).toEqual([
    "1",
    "2",
    "3",
    "4",
    "annotation",
    "5",
  ]);
});

test("mutates nothing on a settled pass with a comment open", () => {
  const { root, ranges } = build(TWO_BODY);
  openComment(root, 4);
  syncTableCards(root, ranges);
  const settled = root.innerHTML;
  syncTableCards(root, ranges);
  expect(root.innerHTML).toBe(settled);
});

test("mutates nothing on a settled pass", () => {
  const { root, ranges } = build(SIMPLE);
  syncTableCards(root, ranges);
  const settled = root.innerHTML;
  syncTableCards(root, ranges);
  expect(root.innerHTML).toBe(settled);
});

test("unwraps and un-cells a table that is no longer one", () => {
  const { root, ranges } = build(SIMPLE);
  syncTableCards(root, ranges);
  syncTableCards(root, []);
  expect(root.querySelector(`[${TABLE_CARD_ATTR}]`)).toBeNull();
  expect(root.querySelector(`[${TABLE_GUTTER_CARD_ATTR}]`)).toBeNull();
  expect(root.querySelector(`[${CELL_ATTR}]`)).toBeNull();
  expect(root.querySelectorAll("[data-content] > [data-line]")).toHaveLength(4);
  expect(root.querySelector('[data-line="2"]')?.textContent).toBe("| a | b |");
});

test("leaves a row alone when the painted text is not the line it parsed", () => {
  const { root, ranges } = build(SIMPLE);
  // A repaint mid-flight: the library has replaced the row with different content.
  const row = root.querySelector('[data-line="4"]');
  if (row !== null) row.textContent = "still painting";
  syncTableCards(root, ranges);
  expect(row?.querySelector(`[${CELL_ATTR}]`)).toBeNull();
  // Its siblings are celled regardless, so one unpainted row cannot stall the table.
  expect(cellTexts(root, 2)).toEqual(["| a ", "| b |"]);
});

test("is a no-op for a plan with no tables", () => {
  const { root, ranges } = build("just prose\nmore prose");
  const before = root.innerHTML;
  syncTableCards(root, ranges);
  expect(root.innerHTML).toBe(before);
});

test("leaves a node another pass appended alone, and settles with it there", () => {
  // inlineImages.ts appends its <img> to the row AFTER this pass has celled it, so a
  // celled row's child count legitimately exceeds its cell count. Reading that as
  // unsettled rebuilds the row, unCell drops the image (it has no tokens to hoist), the
  // image pass re-appends, and the repaint observer never converges — the ~10,800
  // mutations in two seconds EXC-870 measured. The image rides AFTER the cells so it is
  // not mistaken for the first column.
  const { root, ranges } = build(SIMPLE);
  syncTableCards(root, ranges);
  const row = root.querySelector('[data-line="4"]');
  const img = document.createElement("img");
  row?.appendChild(img);
  const before = [...(row?.children ?? [])];
  syncTableCards(root, ranges);
  // Element IDENTITY, not markup: a rebuild is output-idempotent here — it hoists the
  // tokens out, re-splits them and appends fresh cells holding the same text — so the
  // innerHTML afterwards is byte-identical and cannot see the mutation. What the
  // observer sees is the childList churn, and the only trace of that left in the DOM is
  // that the cells are different objects.
  expect([...(row?.children ?? [])]).toEqual(before);
  expect(row?.lastElementChild).toBe(img);
  expect(cellTexts(root, 4)).toEqual(["| 1 ", "| 2 |"]);
});

test("moves an appended node past the cells when it rebuilds a row", () => {
  // The distribution loop places tokens by column, and a zero-length node at the end of
  // the line matches no cell — so it is left where it was, ahead of the freshly appended
  // cells, where it would take the first column track.
  const { root, ranges } = build(SIMPLE);
  const row = root.querySelector('[data-line="4"]');
  const img = document.createElement("img");
  row?.appendChild(img);
  syncTableCards(root, ranges);
  expect(row?.lastElementChild).toBe(img);
  expect(cellTexts(root, 4)).toEqual(["| 1 ", "| 2 |"]);
});

test("does not classify an indented table at all", () => {
  // CommonMark allows three spaces, so a table inside a list item would classify — but
  // the indent folds into the first cell ahead of its pipe, and a pipe that is not the
  // cell's first character can be neither hidden nor drawn as a rule. One column would
  // read as bare markdown beside painted rules. Whole-table fallback is the honest
  // degrade, the same carve-out a blockquoted table takes.
  expect(tableRanges(lines("  | a | b |", "  | - | - |"), NO_CODE)).toEqual([]);
  expect(tableRanges(lines(" | a | b |", " | - | - |"), NO_CODE)).toEqual([]);
  // The unindented spelling of the same table still parses.
  expect(tableRanges(lines("| a | b |", "| - | - |"), NO_CODE)).toHaveLength(1);
});

test("keeps an escaped pipe at the end of a row as text, not as a border", () => {
  // `\|` is a literal pipe the author wrote. Cutting it out as the row's closing
  // delimiter would take its glyph to transparent and draw a table rule where the source
  // has neither.
  const { root, ranges } = build(lines("| a | b \\|", "| - | - |"));
  syncTableCards(root, ranges);
  expect(cellEdges(root, 1)).toEqual(["start", "start"]);
  const last = root.querySelectorAll(`[data-line="1"] > [${CELL_ATTR}]`)[1];
  expect(last?.textContent).toBe("| b \\|");
  expect(last?.querySelectorAll("[data-table-pipe]")).toHaveLength(1);
});

test("re-cards a table whose column count changed under its key", () => {
  // The card carries the track list the sheet builds its columns from, so a card holding
  // the right lines at the wrong count overflows its cells into an implicit row.
  const { root, ranges } = build(SIMPLE);
  syncTableCards(root, ranges);
  const card = root.querySelector<HTMLElement>(`[${TABLE_CARD_ATTR}="2"]`);
  card?.style.setProperty("--table-columns", "5");
  syncTableCards(root, ranges);
  expect(
    root
      .querySelector<HTMLElement>(`[${TABLE_CARD_ATTR}="2"]`)
      ?.style.getPropertyValue("--table-columns"),
  ).toBe("2");
});

import "@ui/test-setup.ts";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { type CodeBlockRange, codeBlockRanges } from "$lib/diffview/codeBlocks.ts";
import { tableRanges } from "$lib/diffview/tables.ts";

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
    // so it draws the row's right-hand border.
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

  test("covers the showcase's narrow, wide and inline-markup shapes", () => {
    // The `### Tabular data` trio plus the four tables that predate it.
    expect(found).toHaveLength(7);
    // The widest is what drives the horizontal-scroll path in a real browser.
    expect(Math.max(...found.map((t) => t.align.length))).toBe(10);
  });

  test("respects the alignment markers the showcase writes", () => {
    expect(found.map((t) => t.align)).toContainEqual(["left", "center", "right"]);
  });
});

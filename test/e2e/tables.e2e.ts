// The plan's GFM tables (EXC-864). This is the one construct in the epic that
// RESTRUCTURES the DOM rather than overdrawing in place — a table's rows move into a
// card that declares the column tracks, and each row's tokens are grouped into cells
// that land in them — so almost every claim worth making about it is a claim about
// layout that only a real engine resolves. What needs a browser here: that two nested
// subgrids resolve into columns whose cells line up down a table written with ragged
// source widths; that the card grows past the prose measure with no scrollbar while a
// cell over the 44ch cap wraps inside its own column; that the pipes compute to
// transparent and the rules that stand in for them paint as background layers whose
// `var()` inks resolve ACROSS the shadow boundary; that a table's rows and its gutter
// numbers still pair one-for-one, which is the guard against @pierre/diffs'
// renderSelection throwing and taking drag selection down for the whole view; and that
// the surface's own gestures — vim motion, `/` search and its CSS Custom Highlight
// ranges, drag-to-comment, and the clipboard — all still resolve against a column space
// the restructuring did not move. happy-dom answers none of those: it reports zero for
// every layout metric, has no grid, no Custom Highlight API, and no clipboard.
//
// The pure half is ui/src/lib/diffview/tables.test.ts: which lines classify as a table
// and where each row's cells sit on them, the DOM shape the pass builds, and its
// idempotence. The sheet's own declarations are coreStyles.test.ts. What only a browser
// can say is that those declarations produce the right boxes.
//
// One case cannot be armed from a seeded plan, and the comment on MALFORMED below says
// so: the daemon reflows a plan through rumdl on ingest, and rumdl REPAIRS a ragged body
// row (truncating or padding it to the header's cell count), so "a body row with the
// wrong number of cells ends the table" is unreachable end to end and stays a unit. What
// rumdl leaves alone is a DELIMITER row short of the header's count — it pads that to an
// empty trailing cell, which is not a delimiter, so the table is voided outright. That is
// the degrade case asserted here. Ragged column WIDTHS survive ingest verbatim, which is
// what makes the alignment claim below a claim about layout rather than about the source.

import type { Page } from "@playwright/test";

import { fileRefCount, makeProject } from "@test/e2e/support/file-refs.ts";
import { type Daemon, expect, test, waitPastSafeModeGrace } from "@test/e2e/support/fixtures.ts";
import {
  cellWidth,
  gridCounts,
  lineOf,
  planSurface,
  revealGutterPlus,
  rowHeights,
  settledMutations,
  taggedRuns,
} from "@test/e2e/support/source-view.ts";

// Three tables and one that only looks like one.
//
// A is written with ragged column widths on purpose: its pipes do not line up in the
// source, so cells that line up on screen can only have come from the grid.
//
// B is written with NO outer pipes, which is what puts a cell with no `data-table-edge`
// on the page — the phantom rule down column 0 that the edge attribute exists to
// prevent. Its last column carries a backticked path and a bold run so the inline layers
// can be shown surviving inside a cell, and its first body row is deliberately far past
// the sheet's 44ch cap so it has to wrap inside its own column.
//
// C is wide enough that the table cannot fit the prose reading measure.
//
// The last block is the degrade case (see the header): one delimiter cell short.
const TABLE_PLAN = `# Table Plan

Prose above the tables, on a row with no table at all.

| Component | Owner | Status |
| --- | --- | --- |
| cache     | ops | warm |
| queue        | infra   | cold |
| relay | net | draining |

Prose between the first and second tables.

Area  | Note
----- | ----
queue | drains through \`src/queue.ts\` once the **cold path** is armed and the relay has quiesced
relay | short note

Prose between the second and third tables.

| One | Two | Three | Four | Five | Six |
| --- | --- | --- | --- | --- | --- |
| aaaaaaaaaaaaaaaaaaaa | bbbbbbbbbbbbbbbbbbbb | cccccccccccccccccccc | dddddddddddddddddddd | eeeeeeeeeeeeeeeeeeee | ffffffffffffffffffff |

Prose above the malformed table, one delimiter cell short.

| x | y | z |
| --- | --- |
| 1 | 2 | 3 |

Trailing prose below every table.
`;

// Rows are addressed by their TEXT rather than by a line number counted off the string
// above, because the daemon reflows a plan through rumdl on ingest — see `lineOf` in the
// shared helpers. Everything here survives that reflow verbatim except MALFORMED_RULE,
// which is seeded `| --- | --- |` and arrives padded to three cells.
const PROSE_ABOVE = "Prose above the tables, on a row with no table at all.";
const A_HEAD = "| Component | Owner | Status |";
const A_RULE = "| --- | --- | --- |";
const A_ROW1 = "| cache     | ops | warm |";
const A_ROW2 = "| queue        | infra   | cold |";
const A_ROW3 = "| relay | net | draining |";
const A_ROWS = [A_HEAD, A_RULE, A_ROW1, A_ROW2, A_ROW3];
const B_HEAD = "Area  | Note";
const B_WRAPPED =
  "queue | drains through `src/queue.ts` once the **cold path** is armed and the relay has quiesced";
const B_ROW2 = "relay | short note";
const C_HEAD = "| One | Two | Three | Four | Five | Six |";
const C_ROW =
  "| aaaaaaaaaaaaaaaaaaaa | bbbbbbbbbbbbbbbbbbbb | cccccccccccccccccccc | dddddddddddddddddddd | eeeeeeeeeeeeeeeeeeee | ffffffffffffffffffff |";
const MALFORMED_HEAD = "| x | y | z |";
const MALFORMED_RULE = "| --- | --- |  |";
const MALFORMED_ROW = "| 1 | 2 | 3 |";

/** The three tables on the page, by their header row's text. */
const TABLES = [A_HEAD, B_HEAD, C_HEAD];

/** Seed `plan` and open it. */
async function open(page: Page, daemon: Daemon, plan: string): Promise<void> {
  await daemon.seed({ plan });
  await page.goto("/");
  await planSurface(page);
}

/** Resolve once all three tables have been carded. The pass runs from a
 * MutationObserver a frame behind the rows, so every read waits for the cards to exist
 * rather than racing the paint. */
async function carded(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
        return sh?.querySelectorAll("[data-content] > [data-table-card]").length ?? 0;
      }),
    )
    .toBe(TABLES.length);
}

/** One row's cells, as the boxes they resolved to plus the two attributes the sheet
 * paints from. Keyed by the row's TEXT for the reason `lineOf` gives. Empty for a row
 * that was never celled, which is what the malformed case reads back. */
function cellBoxes(
  page: Page,
  rowText: string,
): Promise<
  {
    text: string;
    left: number;
    width: number;
    height: number;
    edge: string | null;
    align: string | null;
    fill: string;
  }[]
> {
  return page.evaluate((want) => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    const row = [...(sh?.querySelectorAll("[data-content] [data-line]") ?? [])].find(
      (r) => (r.textContent ?? "") === want,
    );
    return [...(row?.querySelectorAll(":scope > [data-table-cell]") ?? [])].map((cell) => {
      const box = cell.getBoundingClientRect();
      return {
        text: cell.textContent ?? "",
        left: Math.round(box.left * 100) / 100,
        width: Math.round(box.width * 100) / 100,
        height: Math.round(box.height * 100) / 100,
        edge: cell.getAttribute("data-table-edge"),
        align: cell.getAttribute("data-table-align"),
        fill: getComputedStyle(cell).backgroundImage,
      };
    });
  }, rowText);
}

/** The card holding the table whose header row reads `headText`: its own box, its
 * scroll state, and the overflow it was given. `scrollWidth === clientWidth` with a
 * visible overflow is how "grew past the measure rather than hiding columns behind a
 * scrollbar" is read off the page. */
function cardBox(
  page: Page,
  headText: string,
): Promise<{ width: number; scrollWidth: number; clientWidth: number; overflowX: string } | null> {
  return page.evaluate((want) => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    const row = [...(sh?.querySelectorAll("[data-content] [data-line]") ?? [])].find(
      (r) => (r.textContent ?? "") === want,
    );
    const card = row?.closest("[data-table-card]");
    if (card == null) return null;
    return {
      width: Math.round(card.getBoundingClientRect().width * 100) / 100,
      scrollWidth: card.scrollWidth,
      clientWidth: card.clientWidth,
      overflowX: getComputedStyle(card).overflowX,
    };
  }, headText);
}

/** A CSS custom property's resolved value, read from inside the shadow root — the only
 * place a token declared on `:host` is in scope. */
function shadowToken(page: Page, name: string): Promise<string> {
  return page.evaluate((prop) => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    const el = sh?.querySelector("[data-content]");
    return el == null ? "" : getComputedStyle(el).getPropertyValue(prop).trim();
  }, name);
}

/** The line cursor's row, and the plan-readiness wait every keyboard spec opens with. */
const cursor = (page: Page) =>
  page.locator(".diffview [data-content] [data-line][data-caret-cursor]");

const cursorLine = async (page: Page): Promise<number> =>
  Number((await cursor(page).getAttribute("data-line")) ?? -1);

async function readyForKeys(page: Page): Promise<void> {
  await carded(page);
  await waitPastSafeModeGrace(page);
}

/** Press `gg`, then step down to `line` with real `j` keystrokes. The plan reflows on
 * ingest, so the caller resolves `line` from the DOM rather than counting it off the
 * seeded string. */
async function placeCursor(page: Page, line: number): Promise<void> {
  await page.keyboard.press("g");
  await page.keyboard.press("g");
  await expect(cursor(page)).toHaveAttribute("data-line", "1");
  for (let i = 1; i < line; i++) await page.keyboard.press("j");
  await expect(cursor(page)).toHaveAttribute("data-line", String(line));
}

/** Viewport-px centre of a 1-based line's number cell in the gutter column — the
 * library's own `data-line-index` / `data-line-number-content` pairing, resolved the same
 * way `lineCenterY` resolves it. A table's cells sit inside the gutter card, which is
 * `display: contents`, so the pairing reaches them unchanged. */
async function gutterCellCenter(page: Page, line: number): Promise<{ x: number; y: number }> {
  const pt = await page.evaluate((ln) => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    const span = [...(sh?.querySelectorAll("[data-line-number-content]") ?? [])].find(
      (s) => (s.parentElement as HTMLElement)?.dataset.lineIndex === String(ln - 1),
    );
    const r = (span?.parentElement as HTMLElement)?.getBoundingClientRect();
    return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  }, line);
  if (pt === null) throw new Error(`gutter cell for line ${line} not found`);
  return pt;
}

/** Drag down the line-number column from `startLine` to `endLine` — the library's
 * line-selection gesture. */
async function selectGutterRange(page: Page, startLine: number, endLine: number): Promise<void> {
  const start = await gutterCellCenter(page, startLine);
  const end = await gutterCellCenter(page, endLine);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up();
}

/** Which lines took the amber band, per column. The two lists agreeing is the claim:
 * a table's rows live in a content card and its numbers in a gutter card, so a band that
 * reached only one of them would mean the two columns had diverged. */
function bandedLines(page: Page): Promise<{ content: number[]; gutter: number[] }> {
  return page.evaluate(() => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    const lines = (sel: string) =>
      [...(sh?.querySelectorAll(sel) ?? [])]
        .map((el) => Number(el.getAttribute("data-line") ?? el.getAttribute("data-column-number")))
        .sort((a, b) => a - b);
    return {
      content: lines("[data-content] [data-line][data-selected-line]"),
      gutter: lines("[data-gutter] [data-column-number][data-selected-line]"),
    };
  });
}

test("a table's columns line up down its length, ragged source and all", async ({
  page,
  daemon,
}) => {
  // Non-vacuous by construction: the source rows put their pipes at different columns,
  // so cells that share a left edge on screen did so because the grid put them there.
  expect(new Set(A_ROWS.map((row) => row.indexOf("|", 1))).size).toBeGreaterThan(1);

  await open(page, daemon, TABLE_PLAN);
  await carded(page);

  const rows = await Promise.all(A_ROWS.map((text) => cellBoxes(page, text)));
  for (const row of rows) expect(row).toHaveLength(3);
  for (const column of [0, 1, 2]) {
    const lefts = rows.map((row) => row[column]?.left);
    expect(new Set(lefts).size, `column ${column} lefts: ${lefts.join(", ")}`).toBe(1);
  }

  // The delimiter row is a source line like any other: it keeps a full-height row track
  // and its own gutter number, because the comment anchors rest on it. Its height is
  // read against a prose row rather than merely asserted positive — a row collapsed to
  // the rule it paints would still be "greater than zero".
  const rule = await rowHeights(page, await lineOf(page, A_RULE));
  const prose = await rowHeights(page, await lineOf(page, PROSE_ABOVE));
  expect(rule.number).toBe(rule.row);
  expect(rule.row).toBe(prose.row);

  // And what the reader sees in place of the dashes: the glyphs transparent, one
  // full-width hairline painted across the row. Resolved across the shadow boundary —
  // an unresolved token would come back as the initial ink rather than the palette's.
  const ruleRow = await page.evaluate(async (want) => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    const row = [...(sh?.querySelectorAll("[data-content] [data-line]") ?? [])].find(
      (r) => (r.textContent ?? "") === want,
    );
    if (row == null) return null;
    const cs = getComputedStyle(row);
    return { color: cs.color, image: cs.backgroundImage, size: cs.backgroundSize };
  }, A_RULE);
  expect(ruleRow?.color).toBe("rgba(0, 0, 0, 0)");
  expect(ruleRow?.image).toContain("linear-gradient");
  expect(ruleRow?.image).not.toContain("rgba(0, 0, 0, 0)");
  expect(ruleRow?.size).toBe("100% 1px");
});

test("no pipe glyph paints, and the rules stand where the pipes did", async ({ page, daemon }) => {
  await open(page, daemon, TABLE_PLAN);
  await carded(page);

  const pipes = await page.evaluate(() => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    return [...(sh?.querySelectorAll("[data-content] [data-line] [data-table-pipe]") ?? [])].map(
      (el) => ({ text: el.textContent ?? "", color: getComputedStyle(el).color }),
    );
  });
  // The characters are still in the row — transparent, not removed, which is what keeps
  // the copy and the `/` search resolving against the same column space.
  expect(pipes.length).toBeGreaterThan(0);
  expect([...new Set(pipes.map((p) => p.text))]).toEqual(["|"]);
  expect([...new Set(pipes.map((p) => p.color))]).toEqual(["rgba(0, 0, 0, 0)"]);

  // One background layer per pipe the cell actually carries, and none at all on a cell
  // that carries neither — table B is written with no outer pipes, so its first column
  // has no character for a rule to stand in for and must not draw one.
  const cells = await page.evaluate(() => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    return [...(sh?.querySelectorAll("[data-content] [data-table-cell]") ?? [])].map((cell) => ({
      edge: cell.getAttribute("data-table-edge"),
      layers: getComputedStyle(cell).backgroundImage,
    }));
  });
  const layerCount = (fill: string) =>
    fill === "none" ? 0 : fill.split("linear-gradient").length - 1;
  const wanted: Record<string, number> = { start: 1, end: 1, both: 2 };
  expect(cells.length).toBeGreaterThan(0);
  for (const cell of cells) {
    expect(layerCount(cell.layers), `edge ${String(cell.edge)}`).toBe(wanted[cell.edge ?? ""] ?? 0);
    // The ink resolved across the shadow boundary rather than falling back to nothing.
    if (cell.edge !== null) expect(cell.layers).not.toContain("rgba(0, 0, 0, 0)");
  }
  // All three edge states a plan can actually produce are on the page, so the loop above
  // is not vacuous for any of them. `end` is the fourth and is unreachable from markdown:
  // a cell's closing pipe is only ever its last token when the cell also opened with one,
  // which is `both` — so the map carries it for completeness rather than for coverage.
  for (const edge of [null, "start", "both"]) {
    expect(
      cells.some((c) => c.edge === edge),
      `no cell with edge ${String(edge)}`,
    ).toBe(true);
  }
});

test("every row still has exactly one gutter number, with three tables on the page", async ({
  page,
  daemon,
}) => {
  // The epic's standing reflow guard, and here it is the degrade guard too: a table's
  // rows collapse into ONE direct child of the content column, so without the gutter
  // mirror the two columns' child counts diverge and @pierre/diffs' renderSelection
  // throws — which kills drag selection for the WHOLE view, not just the table.
  await open(page, daemon, TABLE_PLAN);
  await carded(page);
  const counts = await gridCounts(page);
  expect(counts.numbers).toBe(counts.rows);
  expect(counts.rows).toBe(counts.highestLine);
});

test("inline decoration survives inside a cell", async ({ page, daemon }) => {
  // What tokenChildren buys: a celled row's tokens sit one level further down, so the
  // inline pass and the file-reference tagger both have to reach through the cells to
  // find the columns they mark. A regression here is silent — the row still reads
  // correctly, it just stops being decorated.
  const proj = await makeProject({ "src/queue.ts": "export const queue = [];\n" });
  try {
    await daemon.seed({ cwd: proj.dir, plan: TABLE_PLAN });
    await page.goto("/");
    await planSurface(page);
    await carded(page);

    await expect.poll(() => fileRefCount(page)).toBe(1);
    expect(await taggedRuns(page, "data-file-ref")).toEqual([
      { row: B_WRAPPED, value: "", text: "src/queue.ts" },
    ]);

    // A run may be several tokens — shiki decides where it cuts, and every token a run
    // covers is tagged — so the claim is about the characters the run covers, not about
    // how many elements carry them.
    const md = (await taggedRuns(page, "data-md")).filter((run) => run.row === B_WRAPPED);
    const covered = (member: string) =>
      md
        .filter((run) => run.value.split(" ").includes(member))
        .map((run) => run.text)
        .join("");
    expect(covered("code")).toBe("`src/queue.ts`");
    expect(covered("bold")).toBe("**cold path**");

    // And both landed inside the LAST cell rather than being smeared across the row.
    const inLastCell = await page.evaluate((want) => {
      const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
      const row = [...(sh?.querySelectorAll("[data-content] [data-line]") ?? [])].find(
        (r) => (r.textContent ?? "") === want,
      );
      const cells = [...(row?.querySelectorAll(":scope > [data-table-cell]") ?? [])];
      const last = cells[cells.length - 1];
      return {
        cells: cells.length,
        ref: last?.querySelectorAll("[data-file-ref]").length ?? 0,
        md: last?.querySelectorAll("[data-md]").length ?? 0,
      };
    }, B_WRAPPED);
    expect(inLastCell.cells).toBe(2);
    expect(inLastCell.ref).toBe(1);
    expect(inLastCell.md).toBeGreaterThan(0);
  } finally {
    await proj.cleanup();
  }
});

test("a malformed table renders as plain source rows", async ({ page, daemon }) => {
  // The shape that survives ingest. rumdl REPAIRS a ragged body row — it truncates or
  // pads the row to the header's cell count — so "a body row of the wrong width ends the
  // table" cannot be armed end to end and stays pinned in tables.test.ts. What rumdl
  // does not repair is a DELIMITER row short of the header: it pads it with an EMPTY
  // trailing cell, and an empty cell is not a delimiter, so the whole table is voided.
  await open(page, daemon, TABLE_PLAN);
  await carded(page);

  for (const text of [MALFORMED_HEAD, MALFORMED_RULE, MALFORMED_ROW]) {
    // Resolved first, so a row that stopped rendering fails as a missing row rather
    // than passing as a missing table.
    await lineOf(page, text);
    expect(await cellBoxes(page, text)).toEqual([]);
  }
  // No card claimed them, and the gutter still pairs one number per row.
  const bad = await page.evaluate((want) => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    const row = [...(sh?.querySelectorAll("[data-content] [data-line]") ?? [])].find(
      (r) => (r.textContent ?? "") === want,
    );
    return row?.closest("[data-table-card]") !== null;
  }, MALFORMED_HEAD);
  expect(bad).toBe(false);
  const counts = await gridCounts(page);
  expect(counts.numbers).toBe(counts.rows);
  expect(counts.rows).toBe(counts.highestLine);
});

test("the repaint settles over a plan of tables", async ({ page, daemon }) => {
  // A regression test for a hang, not for a look. This pass MOVES rows into a card and
  // regroups their tokens into cells — by far the largest childList churn in the epic —
  // and it runs from the MutationObserver that watches for exactly that. A pass whose
  // settle check disagreed with what it built would rebuild every frame, the runaway
  // EXC-870 measured at ~10,800 mutations in two seconds.
  await open(page, daemon, TABLE_PLAN);
  const mutations = await settledMutations(page);
  expect(mutations).toBe(0);
  // Not vacuous: the tables really are carded at rest.
  await carded(page);
});

test("a wide table outgrows the reading measure without a scrollbar", async ({ page, daemon }) => {
  // The plan's headline behaviour, and the one place this card parts company with the
  // fenced-code card: a table is prose-adjacent data whose whole value is being
  // comparable at a glance, so it grows until every column is visible rather than
  // hiding the last ones behind a scroll box.
  await open(page, daemon, TABLE_PLAN);
  await carded(page);

  const readMax = Number.parseFloat(await shadowToken(page, "--caret-read-max"));
  expect(readMax).toBeGreaterThan(0);
  const wide = await cardBox(page, C_HEAD);
  expect(wide?.width).toBeGreaterThan(readMax);
  expect(wide?.scrollWidth).toBe(wide?.clientWidth);
  expect(wide?.overflowX).toBe("visible");
  // Every column is really on the page, at its natural width — the row's six cells are
  // laid out left to right with none collapsed away.
  const row = await cellBoxes(page, C_ROW);
  expect(row).toHaveLength(6);
  for (const [i, cell] of row.entries()) {
    expect(cell.width, `column ${i}`).toBeGreaterThan(0);
    if (i > 0) expect(cell.left).toBeGreaterThan(row[i - 1]?.left ?? 0);
  }
});

test("a cell past the cap wraps inside its own column", async ({ page, daemon }) => {
  // The per-column half of the sizing policy: max-content tracks plus a max-width on the
  // CELL, so a genuinely prose-heavy cell hits the cap and wraps while the columns
  // beside it keep their natural widths and the table does not grow.
  await open(page, daemon, TABLE_PLAN);
  await carded(page);

  const ch = await cellWidth(page, PROSE_ABOVE);
  const [wrapped, short] = await Promise.all([cellBoxes(page, B_WRAPPED), cellBoxes(page, B_ROW2)]);
  const note = wrapped[1];
  const plain = short[1];
  expect(note?.text.length).toBeGreaterThan(44);
  // Capped at 44ch — the cell wrapped rather than taking the width its text asked for.
  expect(note?.width).toBeLessThanOrEqual(44 * ch + 1);
  expect(note?.width).toBeLessThan((note?.text.length ?? 0) * ch);
  // Two visual lines rather than one: the ROW grew, not the table.
  expect(note?.height).toBeGreaterThan(plain?.height ?? 0);
  // And the gutter number grew with it, which is what keeps a line number pointing at
  // its own text — the card's subgrid does that with no height syncing anywhere.
  const heights = await rowHeights(page, await lineOf(page, B_WRAPPED));
  expect(heights.number).toBe(heights.row);
  expect(heights.row).toBe(Math.round(note?.height ?? 0));
  // The first column kept its natural width beside the wrapped one.
  expect(wrapped[0]?.width).toBe(short[0]?.width);
});

test("vim motion and `/` search reach every table line", async ({ page, daemon }) => {
  await open(page, daemon, TABLE_PLAN);
  await readyForKeys(page);

  const { highestLine } = await gridCounts(page);

  // j walks the whole document one line at a time, table rows included: a row that had
  // been swallowed by the card would leave a gap in this sequence.
  await placeCursor(page, 1);
  const walked = [1];
  for (let i = 1; i < highestLine; i++) {
    await page.keyboard.press("j");
    await expect(cursor(page)).toHaveAttribute("data-line", String(i + 1));
    walked.push(i + 1);
  }
  expect(walked).toEqual(Array.from({ length: highestLine }, (_, i) => i + 1));
  // G is already where the walk ended; k steps back off it.
  await page.keyboard.press("G");
  await expect(cursor(page)).toHaveAttribute("data-line", String(highestLine));
  await page.keyboard.press("k");
  await expect(cursor(page)).toHaveAttribute("data-line", String(highestLine - 1));
  await page.keyboard.press("g");
  await page.keyboard.press("g");
  await expect(cursor(page)).toHaveAttribute("data-line", "1");

  // } steps blank line to blank line, and the blanks it has to cross are the ones
  // bracketing the three tables — so landing on BOTH sides of every one of them, and
  // still running past the last block, is the claim.
  const seen: number[] = [];
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("}");
    const line = await cursorLine(page);
    if (seen.at(-1) !== line) seen.push(line);
  }
  expect(seen).toEqual([...seen].sort((a, b) => a - b));
  for (const [head, tail] of [
    [A_HEAD, A_ROW3],
    [B_HEAD, B_ROW2],
    [C_HEAD, C_ROW],
  ]) {
    expect(seen).toContain((await lineOf(page, head ?? "")) - 1);
    expect(seen).toContain((await lineOf(page, tail ?? "")) + 1);
  }
  expect(seen.at(-1)).toBeGreaterThan(await lineOf(page, MALFORMED_ROW));
  await page.keyboard.press("{");
  expect(await cursorLine(page)).toBeLessThan(seen.at(-1) ?? 0);

  // `/` reaches a word that only exists inside a cell, and Enter puts the cursor on it.
  await page.keyboard.press("/");
  await page.keyboard.type("draining");
  await expect(page.locator(".search-count")).toContainText("1");
  await page.keyboard.press("Enter");
  await expect(cursor(page)).toHaveAttribute("data-line", String(await lineOf(page, A_ROW3)));
});

test("V + c opens the composer over a range spanning table rows", async ({ page, daemon }) => {
  await open(page, daemon, TABLE_PLAN);
  await readyForKeys(page);

  const head = await lineOf(page, A_HEAD);
  await placeCursor(page, head);
  await page.keyboard.press("V");
  for (let i = 0; i < 3; i++) await page.keyboard.press("j");
  await page.keyboard.press("c");

  const composer = page.getByRole("dialog", { name: "Add a comment" });
  await expect(composer).toBeVisible();
  await expect(composer.locator(".label")).toHaveText(`Lines ${head}–${head + 3}`);
});

test("a comment on an interior table row lands between it and the next", async ({
  page,
  daemon,
}) => {
  await open(page, daemon, TABLE_PLAN);
  await carded(page);

  const before = await cellBoxes(page, A_HEAD);
  const row = await lineOf(page, A_ROW2);
  const plus = await revealGutterPlus(page, row);
  await plus.click();
  await expect(page.getByRole("dialog", { name: "Add a comment" })).toBeVisible();

  // The annotation row rides INSIDE the table's card, directly after the row it belongs
  // to — not after the whole table, which is where it would land if the card had taken
  // only its keyed cells and stranded the library's own interleaved rows behind it.
  const placed = await page.evaluate(() => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    const ann = sh?.querySelector("[data-content] > [data-table-card] > [data-line-annotation]");
    return {
      inCard: ann != null,
      previous: ann?.previousElementSibling?.getAttribute("data-line") ?? null,
      next: ann?.nextElementSibling?.getAttribute("data-line") ?? null,
    };
  });
  expect(placed.inCard).toBe(true);
  expect(placed.previous).toBe(String(row));
  expect(placed.next).toBe(String(row + 1));
  // And no column moved: a spanning grid item otherwise contributes its own max-content
  // to every track it covers, and a composer's is wide enough to stretch the table.
  expect(await cellBoxes(page, A_HEAD)).toEqual(before);
});

test("a drag bands a table's rows in both columns, inside it and into it", async ({
  page,
  daemon,
}) => {
  // The library's selection render throws in a rAF, so a column-count divergence
  // surfaces as an uncaught page error rather than a failed assertion. Collect them.
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await open(page, daemon, TABLE_PLAN);
  await carded(page);

  const first = await lineOf(page, A_ROW1);
  const last = await lineOf(page, A_ROW3);
  await selectGutterRange(page, first, last);
  await expect.poll(async () => (await bandedLines(page)).content).toEqual([first, last - 1, last]);
  expect((await bandedLines(page)).gutter).toEqual([first, last - 1, last]);
  expect(pageErrors.filter((m) => /renderSelection|children dont match/.test(m))).toEqual([]);

  // And a drag that starts in prose and runs into the table: the range crosses the
  // card's boundary, so the band has to reach rows that live inside it.
  await page.keyboard.press("Escape");
  const prose = await lineOf(page, PROSE_ABOVE);
  const head = await lineOf(page, A_HEAD);
  await selectGutterRange(page, prose, head);
  await expect
    .poll(async () => (await bandedLines(page)).content)
    .toEqual(Array.from({ length: head - prose + 1 }, (_, i) => prose + i));
  expect((await bandedLines(page)).gutter).toEqual(
    Array.from({ length: head - prose + 1 }, (_, i) => prose + i),
  );
  expect(pageErrors.filter((m) => /renderSelection|children dont match/.test(m))).toEqual([]);
});

test("a `/` match inside a cell paints, wrapped and decorated alike", async ({ page, daemon }) => {
  // Search ranges are built by walking a row's text nodes, which for a celled row are
  // one level further down and split across the cells — so a match that straddled a
  // cell boundary, or a row whose text nodes stopped being walkable, would paint
  // nothing. The claim is per MATCH: which cell each painted range landed in, and that
  // it produced real boxes inside that cell's own box.
  const proj = await makeProject({ "src/queue.ts": "export const queue = [];\n" });
  try {
    await daemon.seed({ cwd: proj.dir, plan: TABLE_PLAN });
    await page.goto("/");
    await planSurface(page);
    await readyForKeys(page);
    await expect.poll(() => fileRefCount(page)).toBe(1);

    // Where each painted range sits: the row it is on, the cell's own text, and whether
    // its client rects land inside that cell.
    const painted = (): Promise<{ row: string; cell: string; inside: boolean }[]> =>
      page.evaluate(() => {
        const ranges = [...(CSS.highlights.get("caret-search") ?? [])].concat([
          ...(CSS.highlights.get("caret-search-current") ?? []),
        ]) as Range[];
        return ranges.map((range) => {
          const node = range.startContainer;
          const el = node.nodeType === 3 ? node.parentElement : (node as Element);
          const cell = el?.closest("[data-table-cell]") ?? null;
          const box = cell?.getBoundingClientRect();
          // A range whose start sits on a text-node seam — which a celled row has at
          // every pipe — yields a degenerate zero-width rect there alongside the real
          // one, so the rects that PAINT are the ones with width.
          const rects = [...range.getClientRects()].filter((r) => r.width > 0);
          return {
            row: el?.closest("[data-line]")?.textContent ?? "",
            cell: cell?.textContent ?? "",
            inside:
              box != null &&
              rects.length > 0 &&
              rects.every(
                (r) =>
                  r.left >= box.left - 1 &&
                  r.right <= box.right + 1 &&
                  r.top >= box.top - 1 &&
                  r.bottom <= box.bottom + 1,
              ),
          };
        });
      });

    // A plain cell: `queue` stands alone in table A's first column.
    await page.keyboard.press("/");
    await page.keyboard.type("queue");
    await expect.poll(async () => (await painted()).length).toBeGreaterThan(0);
    const hits = await painted();
    // One of them is the plain cell, one is inside the wrapped cell's file reference —
    // the decorated case, since that token carries both `data-md` and `data-file-ref`.
    expect(hits.some((h) => h.row === A_ROW2 && h.cell.trim() === "| queue")).toBe(true);
    expect(hits.some((h) => h.row === B_WRAPPED && h.cell.includes("src/queue.ts"))).toBe(true);
    for (const hit of hits) expect(hit.inside, `${hit.row} / ${hit.cell}`).toBe(true);

    // A word that only exists in the wrapped cell, past its first visual line.
    await page.keyboard.press("Escape");
    await page.keyboard.press("/");
    await page.keyboard.type("quiesced");
    await expect.poll(async () => (await painted()).length).toBe(1);
    const wrapped = await painted();
    expect(wrapped[0]?.row).toBe(B_WRAPPED);
    expect(wrapped[0]?.inside).toBe(true);
  } finally {
    await proj.cleanup();
  }
});

test("copying a selection across a table yields the source markdown, pipes and all", async ({
  page,
  context,
  daemon,
}) => {
  // The epic's copy contract, and the one place a restructuring pass is most likely to
  // break it: a cell is a grid item, and Blink's plain-text serialization emits line
  // breaks around blockified boxes. A selection that came back one cell per line would
  // make a copied plan unusable as markdown.
  await open(page, daemon, TABLE_PLAN);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await carded(page);

  const copied = await page.evaluate(
    async (bounds) => {
      const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot as
        | (ShadowRoot & { getSelection?: () => Selection | null })
        | null;
      const rowOf = (text: string) =>
        [...(sh?.querySelectorAll("[data-content] [data-line]") ?? [])].find(
          (r) => (r.textContent ?? "") === text,
        );
      const from = rowOf(bounds.from);
      const to = rowOf(bounds.to);
      if (sh == null || from == null || to == null) return "<no rows>";
      const range = document.createRange();
      range.setStartBefore(from);
      range.setEndAfter(to);
      const sel = sh.getSelection?.() ?? getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      // execCommand rather than a Ctrl+C keypress: it runs the SAME serialization the
      // keypress would with no dependency on what the harness left focused, and
      // Selection.toString() is NOT that serialization.
      document.execCommand("copy");
      return navigator.clipboard.readText();
    },
    { from: PROSE_ABOVE, to: A_ROW3 },
  );

  // Every source line comes back intact, on a line of its own, pipes included.
  expect(copied.split("\n").map((l) => l.trim())).toEqual([
    PROSE_ABOVE,
    "",
    A_HEAD,
    A_RULE,
    A_ROW1,
    A_ROW2,
    A_ROW3,
  ]);
});

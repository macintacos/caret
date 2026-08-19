// The plan's GFM tables (EXC-864). This is the one construct in the epic that
// RESTRUCTURES the DOM rather than overdrawing in place — a table's rows move into a
// card that declares the column tracks, and each row's tokens are grouped into cells
// that land in them — so almost every claim worth making about it is a claim about
// layout that only a real engine resolves. What needs a browser here: that two nested
// subgrids resolve into columns whose cells line up down a table written with ragged
// source widths; that each column's declared alignment resolves to a `text-align` in the
// live cascade and puts the glyphs where the marker asked, on a wrapped cell's
// continuation lines as much as on its first; that the card grows past the prose measure
// with no scrollbar while a cell over the 64ch cap wraps inside its own column; that the
// inline layers — code, bold, italic, a collapsing link, a file reference — still find
// their columns once a row's tokens sit one level down inside cells; that the pipes
// compute to
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
// what makes the alignment claim below a claim about layout rather than about the source,
// and the delimiter row's `:---` / `:---:` / `---:` markers survive it verbatim too.
//
// One row's constant is NOT its seeded text, and B_WRAPPED says which form it is: the
// link layer collapses `[label](url)` to its label, the only rewrite between a plan's
// source and what the view paints. Everything downstream indexes the display text, so
// the cells are cut on the collapsed columns and the collapse costs the pass nothing.

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
// source, so cells that line up on screen can only have come from the grid. Its
// delimiter row declares all three MARKED alignments — `:---`, `:---:`, `---:` — one per
// column; the fourth spelling, an unmarked `---`, is what tables B and C are written
// with, so between them the four cover every case the classifier can produce.
//
// B is written with NO outer pipes, which is what puts a cell with no `data-table-edge`
// on the page — the phantom rule down column 0 that the edge attribute exists to
// prevent. Its Note column is right-aligned AND holds a cell far past the sheet's 64ch
// cap, which is the pair that makes a wrapped cell's alignment observable at all. That
// cell also carries one run of every inline layer the epic decorates — inline code, bold,
// italic, a collapsing link, and a file reference — so all five can be shown surviving
// the regrouping into cells.
//
// C is wide enough that the table cannot fit the prose reading measure.
//
// The last block is the degrade case (see the header): one delimiter cell short.
const TABLE_PLAN = `# Table Plan

Prose above the tables, on a row with no table at all.

| Component | Owner | Status |
| :--- | :---: | ---: |
| cache     | ops | warm |
| queue        | infra   | cold |
| relay | net | draining |

Prose between the first and second tables.

Area  | Note
----- | ---:
queue | drains through \`src/queue.ts\` once the **cold path** is *armed* and the [relay docs](https://docs.example.test/relay) say it has quiesced
relay | short note
badge | ![status](https://assets.invalid/badge.png)

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
const A_RULE = "| :--- | :---: | ---: |";
const A_ROW1 = "| cache     | ops | warm |";
const A_ROW2 = "| queue        | infra   | cold |";
const A_ROW3 = "| relay | net | draining |";
const A_ROWS = [A_HEAD, A_RULE, A_ROW1, A_ROW2, A_ROW3];
const B_HEAD = "Area  | Note";
// The DISPLAY form, not the seeded one: `links.ts` collapses `[label](url)` to its
// label, and that is the only rewrite between a plan's source and what the view paints.
// Everything downstream is indexed over the display text — `tableRanges` parses it and
// `syncTableCards` guards on the painted row's length matching the parsed line — so the
// cells are cut on the collapsed columns, and `lineOf` looks a row up by what it reads.
const B_WRAPPED =
  "queue | drains through `src/queue.ts` once the **cold path** is *armed* and the relay docs say it has quiesced";
const B_ROW2 = "relay | short note";
// The image row. inlineImages.ts appends its <img> to a row this pass has already
// celled, so a celled row's child count legitimately exceeds its cell count — the one
// place two passes write to the same row, and the one that can loop the repaint if
// either disagrees with the other about what a settled row looks like. The host is on
// the reserved .invalid domain, so nothing is ever fetched.
const B_IMAGE = "badge | ![status](https://assets.invalid/badge.png)";
const C_HEAD = "| One | Two | Three | Four | Five | Six |";
const C_ROW =
  "| aaaaaaaaaaaaaaaaaaaa | bbbbbbbbbbbbbbbbbbbb | cccccccccccccccccccc | dddddddddddddddddddd | eeeeeeeeeeeeeeeeeeee | ffffffffffffffffffff |";
const MALFORMED_HEAD = "| x | y | z |";
const MALFORMED_RULE = "| --- | --- |  |";
const MALFORMED_ROW = "| 1 | 2 | 3 |";

/** The seed plan's inline-markup table verbatim (scripts/tasks/dev/fake-plan.md), which
 * is where this was first seen: every cell is padded out to 25 characters so the source
 * aligns under `[a linked cell](#links)`, and that link renders as three words.
 *
 * The trailing prose is load-bearing for a second claim. It carries the plan past ten
 * lines, so the gutter sizes its numbers to two digits while the table's own lines are
 * still one — the condition under which a delimiter dot centred on the number COLUMN
 * lands visibly off the numbers themselves. Without it the two coincide and the
 * alignment case below would pass on a table it cannot distinguish. */
const LINK_PADDED = `# Padded

| Cell kind | Content                 |
| --------- | ----------------------- |
| bold      | **a bold cell**         |
| italic    | *an italic cell*        |
| code      | \`a code cell\`           |
| link      | [a linked cell](#links) |
| reference | \`mise.toml\`             |

Trailing prose, one paragraph.

And a second, so the plan runs past ten lines.
`;

/** A left-aligned column carrying a cell past the cap, which is what a hanging indent is
 * visible on. Its second column opens with a pipe, so it is the branch the sheet indents;
 * both columns are unmarked, so the row hangs left. */
const WRAP_PROSE = "Prose above a table whose second column wraps.";
const WRAP_LEFT = `# Wrapping

${WRAP_PROSE}

| Step | Notes |
| ---- | ----- |
| 1 | Drain the queue before the cutover, then hold the relay closed until the health probe has reported two consecutive green intervals. |
| 2 | Short. |
`;

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
async function carded(page: Page, count: number = TABLES.length): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
        return sh?.querySelectorAll("[data-content] > [data-table-card]").length ?? 0;
      }),
    )
    .toBe(count);
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

/** Per cell of `rowText`: the alignment its column declared, what the sheet resolved
 * `text-align` to, the cell's own track box, and the extent of its GLYPHS on each visual
 * line — a Range over the cell's contents, grouped into line boxes.
 *
 * The glyph extents are what make an alignment claim geometric rather than a restatement
 * of the stylesheet: A's tracks are `max-content` and every body cell is shorter than its
 * track, so where a cell's glyphs sit inside that slack is the alignment. Grouped BY LINE
 * because that is also how a wrapped cell's continuation is read — the sheet puts
 * `text-align` on the cell rather than on its tokens precisely so every visual line
 * follows the column, not just the first. */
function cellGlyphs(
  page: Page,
  rowText: string,
): Promise<
  {
    align: string | null;
    textAlign: string;
    left: number;
    right: number;
    lines: { left: number; right: number }[];
  }[]
> {
  return page.evaluate((want) => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    const row = [...(sh?.querySelectorAll("[data-content] [data-line]") ?? [])].find(
      (r) => (r.textContent ?? "") === want,
    );
    return [...(row?.querySelectorAll(":scope > [data-table-cell]") ?? [])].map((cell) => {
      const box = cell.getBoundingClientRect();
      const range = cell.ownerDocument.createRange();
      range.selectNodeContents(cell);
      // One entry per VISUAL LINE. A cell yields one rect per token per line, and a
      // zero-width one at every seam between two token spans — but the tokens on one line
      // do not share a `top`, because a chip (the inline-code pill, the file reference)
      // pads its box taller than the prose beside it. So rects are grouped by vertical
      // OVERLAP rather than by an equal top, which a bucketed key would split into two.
      const lines: { top: number; bottom: number; left: number; right: number }[] = [];
      for (const rect of [...range.getClientRects()]
        .filter((r) => r.width > 0)
        .sort((a, b) => a.top - b.top)) {
        const mid = (rect.top + rect.bottom) / 2;
        const open = lines.find((l) => mid > l.top && mid < l.bottom);
        if (open === undefined) {
          lines.push({ top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right });
        } else {
          open.top = Math.min(open.top, rect.top);
          open.bottom = Math.max(open.bottom, rect.bottom);
          open.left = Math.min(open.left, rect.left);
          open.right = Math.max(open.right, rect.right);
        }
      }
      return {
        align: cell.getAttribute("data-table-align"),
        textAlign: getComputedStyle(cell).textAlign,
        left: box.left,
        right: box.right,
        lines: lines.map((l) => ({ left: l.left, right: l.right })),
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

  // The delimiter row is a source line like any other: it keeps a row track of its own
  // and its own gutter number, because the comment anchors rest on it. It is SHORTER
  // than a prose row — it is set without leading, which is what closes the gap under a
  // header — and the two columns agree on how much shorter, which is the claim the
  // "keeps its number and loses its leading" case below owns in full.
  const rule = await rowHeights(page, await lineOf(page, A_RULE));
  const prose = await rowHeights(page, await lineOf(page, PROSE_ABOVE));
  expect(rule.number).toBe(rule.row);
  expect(rule.row).toBeGreaterThan(0);
  expect(rule.row).toBeLessThan(prose.row);

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

test("each column wears the alignment its delimiter row declared", async ({ page, daemon }) => {
  // The sheet's three text-align rules only reach a cell through `data-table-align`, an
  // attribute the pass writes, inside an adopted stylesheet, across the shadow boundary —
  // so whether they resolve at all is a browser question. The GEOMETRY beside each one is
  // what stops this being a restatement of coreStyles.test.ts's text scan: A's tracks are
  // max-content, every body cell here is shorter than its track, and where the glyphs sit
  // in that slack is the alignment.
  await open(page, daemon, TABLE_PLAN);
  await carded(page);

  const ch = await cellWidth(page, PROSE_ABOVE);
  const cells = await cellGlyphs(page, A_ROW1);
  expect(cells.map((c) => c.align)).toEqual(["left", "center", "right"]);
  expect(cells.map((c) => c.textAlign)).toEqual(["left", "center", "right"]);

  const gaps = cells.map((cell) => {
    const line = cell.lines[0];
    return { start: (line?.left ?? 0) - cell.left, end: cell.right - (line?.right ?? 0) };
  });
  // Non-vacuous: each cell really is narrower than the track it sits in, so there is
  // slack for the alignment to spend. A track sized exactly to this row would make every
  // claim below true by construction.
  for (const [i, gap] of gaps.entries()) {
    expect(gap.start + gap.end, `column ${i} has no slack`).toBeGreaterThan(ch);
  }
  // Left: flush to the track's start, slack left over at the end.
  expect(gaps[0]?.start).toBeLessThan(ch);
  expect(gaps[0]?.end).toBeGreaterThan(ch);
  // Right: flush to the track's end, slack left over at the start.
  expect(gaps[2]?.end).toBeLessThan(ch);
  expect(gaps[2]?.start).toBeGreaterThan(ch);
  // Centre: inset from BOTH edges, by the same amount.
  expect(gaps[1]?.start).toBeGreaterThan(0);
  expect(gaps[1]?.end).toBeGreaterThan(0);
  expect(Math.abs((gaps[1]?.start ?? 0) - (gaps[1]?.end ?? 0))).toBeLessThan(ch);

  // The unmarked spelling is the fourth, and it is what tables B and C are written with:
  // no attribute, and the cell keeps whatever the row's own direction gives it.
  const unmarked = await cellGlyphs(page, C_ROW);
  expect(unmarked.map((c) => c.align)).toEqual([null, null, null, null, null, null]);
});

test("a wrapped cell's continuation lines follow its column too", async ({ page, daemon }) => {
  // The deliberate call the sheet makes by putting text-align on the CELL rather than on
  // its tokens: a token-level rule would only ever reach the first visual line, so a
  // wrapped right-aligned cell would read as one aligned line above a stack of ragged
  // ones. B's Note column is right-aligned and its first body cell wraps, which is the
  // only place on the page where the two meet.
  await open(page, daemon, TABLE_PLAN);
  await carded(page);

  const ch = await cellWidth(page, PROSE_ABOVE);
  const note = (await cellGlyphs(page, B_WRAPPED))[1];
  expect(note?.align).toBe("right");
  expect(note?.textAlign).toBe("right");
  expect(note?.lines.length).toBeGreaterThan(1);
  // Every visual line ends at the track's right edge, within one character cell. The
  // tolerance is a cell rather than a pixel because `pre-wrap` HANGS the trailing space
  // of a soft-wrapped line past the content edge, so each line but the last measures
  // exactly one cell over — and it is two-sided, so a line ending short of the edge (what
  // a token-level rule would leave every continuation doing) still fails.
  for (const [i, line] of (note?.lines ?? []).entries()) {
    expect(
      Math.abs((note?.right ?? 0) - line.right),
      `visual line ${i} is not flush right`,
    ).toBeLessThanOrEqual(ch + 1);
  }
  // And at least one of them is genuinely short of the track's start — otherwise every
  // line would fill the column and "aligned" would say nothing.
  expect(Math.max(...(note?.lines ?? []).map((l) => l.left - (note?.left ?? 0)))).toBeGreaterThan(
    ch,
  );
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

  // A divider on every cell that opens a column, and none on the cell that opens the
  // ROW — a table's outer edges belong to the frame, and a rule half a character inside
  // it would read as a doubled line. Table B is written with no outer pipes, so its
  // first column has no character for a rule to stand in for either way.
  const cells = await page.evaluate(() => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    return [...(sh?.querySelectorAll("[data-content] [data-table-cell]") ?? [])].map((cell) => ({
      edge: cell.getAttribute("data-table-edge"),
      first: cell.previousElementSibling === null,
      layers: getComputedStyle(cell).backgroundImage,
    }));
  });
  const layerCount = (fill: string) =>
    fill === "none" ? 0 : fill.split("linear-gradient").length - 1;
  expect(cells.length).toBeGreaterThan(0);
  for (const cell of cells) {
    const opens = cell.edge === "start" || cell.edge === "both";
    const wanted = opens && !cell.first ? 1 : 0;
    expect(layerCount(cell.layers), `edge ${String(cell.edge)} first ${cell.first}`).toBe(wanted);
    // The ink resolved across the shadow boundary rather than falling back to nothing.
    if (wanted > 0) expect(cell.layers).not.toContain("rgba(0, 0, 0, 0)");
  }
  // Every case the loop distinguishes is on the page, so it is vacuous for none of them:
  // a first cell that opens with a pipe (drawn by the frame, not by the cell), a first
  // cell that does not (table B), and an interior cell that does.
  for (const [name, match] of [
    ["first cell with a pipe", (c: (typeof cells)[number]) => c.first && c.edge !== null],
    ["first cell without one", (c: (typeof cells)[number]) => c.first && c.edge === null],
    ["interior cell", (c: (typeof cells)[number]) => !c.first && c.edge !== null],
  ] as const) {
    expect(cells.some(match), `no ${name}`).toBe(true);
  }

  // And the frame the edges were handed to: one border, on the card, with corners that
  // the rows inside it leave alone. Every row of the surface paints an opaque background,
  // so the end rows have to be rounded to the same radius or they cover the arc and the
  // frame reads as a rectangle with a bite out of each corner.
  const frame = await page.evaluate(() => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    const card = sh?.querySelector("[data-content] > [data-table-card]") as HTMLElement;
    const cs = getComputedStyle(card);
    const corners = (el: Element) => {
      const s = getComputedStyle(el);
      return [
        s.borderTopLeftRadius,
        s.borderTopRightRadius,
        s.borderBottomRightRadius,
        s.borderBottomLeftRadius,
      ];
    };
    return {
      width: cs.borderTopWidth,
      color: cs.borderTopColor,
      radius: cs.borderTopLeftRadius,
      // Every side, so a table never reads as rules stopping in mid-air.
      sides: [cs.borderTopStyle, cs.borderRightStyle, cs.borderBottomStyle, cs.borderLeftStyle],
      opaqueRow: getComputedStyle(card.children[1] as Element).backgroundColor,
      head: corners(card.firstElementChild as Element),
      foot: corners(card.lastElementChild as Element),
      middle: corners(card.children[1] as Element),
    };
  });
  expect(frame.sides).toEqual(["solid", "solid", "solid", "solid"]);
  expect(frame.width).toBe("1px");
  expect(frame.color).not.toBe("rgba(0, 0, 0, 0)");
  expect(Number.parseFloat(frame.radius)).toBeGreaterThan(0);
  // The premise: a row really does paint over what is under it. Were the rows
  // transparent, the rounding below would be dead weight rather than the fix.
  expect(frame.opaqueRow).not.toBe("rgba(0, 0, 0, 0)");
  const flat = "0px";
  expect(frame.head).toEqual([frame.radius, frame.radius, flat, flat]);
  expect(frame.foot).toEqual([flat, flat, frame.radius, frame.radius]);
  // And only the ends: an interior row meets no corner, so rounding one would cut a
  // notch out of the middle of the table.
  expect(frame.middle).toEqual([flat, flat, flat, flat]);
});

test("the delimiter row is a dot and a hairline, not a numbered line", async ({ page, daemon }) => {
  // The row draws the header separator and was a full text line tall, which put half a
  // line of air above that separator and half below — a gap under the header wider than
  // the header's own row. It is now barely a line at all: the digits give way to a dot,
  // which is what lets the height go, and the header closes on the rule from above while
  // the first body row closes on it from below.
  //
  // Browser-only four times over. Whether shrinking both halves of the row actually
  // shortens the track is a question only a real grid answers. The gutter cell is reached
  // positionally, so that it lands on the delimiter's own cell rather than on the row
  // above is a claim about the live DOM. The hover "+" is a fixed size overflowing a row
  // several times shorter than itself, so where it ends up is a layout answer. And the
  // dot has to land ON the numbers above and below rather than merely near them — which
  // is a claim about two boxes the cascade sizes, not about a declaration.
  await open(page, daemon, LINK_PADDED);
  await carded(page, 1);
  const read = () =>
    page.evaluate(() => {
      const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
      const card = sh?.querySelector("[data-content] > [data-table-card]") as HTMLElement;
      const rows = [...card.querySelectorAll(":scope > [data-line]")] as HTMLElement[];
      const rule = rows.find((r) => r.hasAttribute("data-table-rule")) as HTMLElement;
      const line = Number(rule.getAttribute("data-line"));
      const cellFor = (n: number) =>
        sh?.querySelector(
          `[data-gutter] [data-table-card-gutter] > [data-column-number="${n}"]`,
        ) as HTMLElement;
      const spanFor = (n: number) =>
        cellFor(n).querySelector("[data-line-number-content]") as HTMLElement;
      // A Range over the number's text measures the DIGITS, where the element's own box
      // measures the column: the library sizes every number to the widest in the file and
      // right-aligns the digits inside that, so on a file past ten lines the two differ.
      // What the dot has to line up with is the digits.
      const digits = (n: number) => {
        const range = document.createRange();
        range.selectNodeContents(spanFor(n));
        const b = range.getBoundingClientRect();
        return { cx: (b.left + b.right) / 2, cy: (b.top + b.bottom) / 2, w: b.width };
      };
      const numberOf = (n: number) => ({
        visibility: getComputedStyle(spanFor(n)).visibility,
        text: (spanFor(n).textContent ?? "").trim(),
      });
      const own = spanFor(line).getBoundingClientRect();
      const dot = getComputedStyle(spanFor(line), "::before");
      return {
        line,
        ruleHeight: rule.getBoundingClientRect().height,
        bodyHeight: Math.min(
          ...rows.filter((r) => r !== rule).map((r) => r.getBoundingClientRect().height),
        ),
        gutterHeight: cellFor(line).getBoundingClientRect().height,
        number: numberOf(line),
        // The lines either side still carry theirs: one line lost its address, not the
        // numbering.
        neighbours: [numberOf(line - 1), numberOf(line + 1)],
        // The dot is painted over the hidden number's box and centred in it, so that box
        // IS the dot's position.
        at: { cx: (own.left + own.right) / 2, cy: (own.top + own.bottom) / 2, w: own.width },
        want: [digits(line - 1), digits(line + 1)],
        dot: {
          visibility: dot.visibility,
          image: dot.backgroundImage,
          position: dot.backgroundPosition,
        },
      };
    });

  const before = await read();
  // Barely a line: a fraction of a body row rather than the whole of one.
  expect(before.ruleHeight).toBeLessThan(before.bodyHeight / 2);
  expect(before.ruleHeight).toBeGreaterThan(0);
  // Both halves landed on the same short track.
  expect(before.gutterHeight).toBeCloseTo(before.ruleHeight, 1);
  // The digits are gone but their box is not — it is what places the dot — so this is
  // visibility rather than display, and the paint rides a pseudo because visibility takes
  // an element's background with its text.
  expect(before.number.visibility).toBe("hidden");
  expect(before.dot.visibility).toBe("visible");
  expect(before.dot.image).toContain("radial-gradient");
  // currentColor resolved to the gutter's own ink rather than to nothing — the disc's
  // stop, not the surrounding transparent one the gradient also carries.
  expect(before.dot.image).toMatch(/rgb\(\d+, \d+, \d+\) 100%/);
  expect(before.dot.position).toBe("50% 50%");
  for (const neighbour of before.neighbours) {
    expect(neighbour.visibility).not.toBe("hidden");
    expect(neighbour.text).not.toBe("");
  }

  // THE ALIGNMENT. The dot sits on the same axis as the numbers above and below, and on
  // the midpoint between them. A pixel of tolerance rather than none: the row above is
  // the card's first, so its track carries the frame's top border and its number sits
  // half a pixel higher than the rhythm alone would put it.
  const [above, below] = before.want;
  expect(Math.abs(before.at.cx - (above!.cx + below!.cx) / 2)).toBeLessThanOrEqual(1);
  expect(Math.abs(before.at.cy - (above!.cy + below!.cy) / 2)).toBeLessThanOrEqual(1);
  // Not vacuous: this plan runs past ten lines, so the number COLUMN is two digits wide
  // while these lines are one, and a dot centred on the column instead of on the digits
  // would miss by half a character. The delimiter's box has been taken back to its own
  // digits' width, which is what closes that gap.
  expect(before.at.w).toBeCloseTo(above!.w, 0);
  expect(before.at.w).toBeLessThan(
    Number.parseFloat(
      await page.evaluate(() => {
        const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
        const other = sh?.querySelector(
          "[data-gutter] [data-column-number] [data-line-number-content]",
        ) as HTMLElement;
        return getComputedStyle(other).minWidth;
      }),
    ),
  );

  // The hover affordance is centred ON that row rather than hung from the top of it:
  // it is several times the row's height, so anchored at the top it drops out of the
  // bottom and reads as belonging to the line below.
  await revealGutterPlus(page, before.line);
  const plus = await page.evaluate((line) => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    const cell = sh?.querySelector(
      `[data-gutter] [data-table-card-gutter] > [data-column-number="${line}"]`,
    ) as HTMLElement;
    const btn = sh?.querySelector("[data-utility-button]") as HTMLElement;
    const b = btn.getBoundingClientRect();
    const c = cell.getBoundingClientRect();
    return { taller: b.height > c.height, delta: b.top + b.height / 2 - (c.top + c.height / 2) };
  }, before.line);
  expect(plus.taller).toBe(true);
  expect(Math.abs(plus.delta)).toBeLessThanOrEqual(1);

  // And it survives a comment on the HEADER row, which is the trap the positional
  // selector is written around: the library inserts a gutter buffer after the commented
  // line, so plain :nth-child(2) would shrink and dot THAT instead of the delimiter.
  await page.keyboard.press("Escape");
  const head = await revealGutterPlus(page, before.line - 1);
  await head.click();
  await expect(page.getByRole("dialog", { name: "Add a comment" })).toBeVisible();
  const after = await read();
  expect(after.number.visibility).toBe("hidden");
  expect(after.dot.image).toBe(before.dot.image);
  expect(after.neighbours[0]?.visibility).not.toBe("hidden");
  expect(after.ruleHeight).toBeCloseTo(before.ruleHeight, 1);
});

test("a column is as wide as what it shows, not as wide as the source", async ({
  page,
  daemon,
}) => {
  // A markdown author pads every cell out to the widest thing typed in the column, so a
  // column that holds a link is padded for the link's SOURCE — and the source is what
  // nobody can see once it collapses. Left alone, the whole column stays as wide as a
  // URL that renders as three words.
  await open(page, daemon, LINK_PADDED);
  await carded(page, 1);
  const geom = await page.evaluate(() => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    const card = sh?.querySelector("[data-content] > [data-table-card]") as HTMLElement;
    const cells = [...card.querySelectorAll("[data-line] [data-table-cell]:last-child")];
    const widest = Math.max(
      ...cells.map((c) => {
        const r = document.createRange();
        r.selectNodeContents(c);
        return r.getBoundingClientRect().width;
      }),
    );
    const probe = document.createElement("span");
    probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre";
    probe.textContent = "0".repeat(10);
    card.appendChild(probe);
    const ch = probe.getBoundingClientRect().width / 10;
    probe.remove();
    const track = Number.parseFloat(
      getComputedStyle(card).gridTemplateColumns.split(" ")[1] ?? "0",
    );
    return { trackCh: track / ch, widestCh: widest / ch };
  });
  // The source pads that column to 25 characters to fit `[a linked cell](#links)`; what
  // it actually shows is `**a bold cell**` plus its chip. The track follows the glyphs.
  expect(geom.trackCh).toBeLessThan(22);
  // Not vacuous in the other direction either — the column still fits what it draws.
  expect(geom.trackCh).toBeGreaterThanOrEqual(geom.widestCh - 0.5);
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
    expect(covered("italic")).toBe("*armed*");
    // The link is the one run whose characters are NOT the ones that were seeded: the
    // display text is the collapsed label, so the run covers `relay docs` and the
    // `[...](https://…)` around it is gone by the time the cells are cut. Everything
    // downstream agrees on that, which is why the collapse survives the regrouping —
    // tableRanges parses the same display text the row paints.
    expect(covered("link")).toBe("relay docs");

    // And every one of them landed inside the LAST cell rather than being smeared
    // across the row.
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
        members: [
          ...new Set(
            [...(last?.querySelectorAll("[data-md]") ?? [])].flatMap((el) =>
              (el.getAttribute("data-md") ?? "").split(" "),
            ),
          ),
        ].sort(),
        // Nothing leaked into the first cell, which holds only the row's key.
        strays: cells[0]?.querySelectorAll("[data-md], [data-file-ref]").length ?? 0,
      };
    }, B_WRAPPED);
    expect(inLastCell.cells).toBe(2);
    expect(inLastCell.ref).toBe(1);
    expect(inLastCell.members).toEqual(["bold", "code", "italic", "link"]);
    expect(inLastCell.strays).toBe(0);
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
  // Not vacuous: the tables really are carded at rest, and the image row — the one
  // line on the page two passes both write to — still holds the image the other one
  // put there. Without that second check the zero above would also be what a pass
  // that quietly deleted the image and never looked again produced.
  await carded(page);
  const line = await lineOf(page, B_IMAGE);
  await expect(
    (await planSurface(page)).locator(
      `[data-content] [data-line="${line}"][data-table-card] img, [data-content] [data-table-card] [data-line="${line}"] img`,
    ),
  ).toHaveCount(1);
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

test("a wrapped cell hangs its continuation lines under its own first line", async ({
  page,
  daemon,
}) => {
  // A cell's text does not start at the cell's edge: the source puts a pipe and the space
  // after it there first. Continuation lines left at the edge therefore sat two characters
  // left of every line above them, and ran through the column rule painted half a
  // character in.
  //
  // Its own fixture rather than TABLE_PLAN's wrapping cell, which is right-aligned: a
  // hanging indent is invisible by construction on flush-right lines, since they share
  // their trailing edge and not their leading one. This needs a column that hangs left,
  // and a cell that opens with a pipe — the two conditions the sheet keys on.
  await open(page, daemon, WRAP_LEFT);
  await carded(page, 1);

  const ch = await cellWidth(page, WRAP_PROSE);
  const geom = await page.evaluate((want) => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    const cell = [...(sh?.querySelectorAll("[data-content] [data-table-cell]") ?? [])].find((c) =>
      (c.textContent ?? "").includes(want),
    ) as HTMLElement;
    const range = document.createRange();
    range.selectNodeContents(cell);
    // One entry per visual line: its top, and the leftmost ink on it. A Range yields a
    // rect per span per line, so a cell's several tokens have to be folded together.
    const byTop = new Map<number, number>();
    for (const rect of range.getClientRects()) {
      const key = Math.round(rect.top);
      byTop.set(key, Math.min(byTop.get(key) ?? Number.POSITIVE_INFINITY, rect.left));
    }
    return {
      cellLeft: cell.getBoundingClientRect().left,
      edge: cell.getAttribute("data-table-edge"),
      lefts: [...byTop.entries()].sort((a, b) => a[0] - b[0]).map(([, left]) => left),
    };
  }, "Drain the queue");

  // The conditions the claim rests on, so it cannot pass on a cell that never wrapped or
  // never had a pipe to indent past.
  expect(geom.edge).not.toBeNull();
  expect(geom.lefts.length).toBeGreaterThan(1);
  const [first, ...rest] = geom.lefts;
  // The first line still opens at the cell's edge, so the pipe stays on its own character
  // column and the rule painted there still lands on it.
  expect(first).toBeCloseTo(geom.cellLeft, 0);
  // And every line after it starts one pipe and one space in — under the first line's
  // text, clear of the rule.
  for (const left of rest) expect(left - (first ?? 0)).toBeCloseTo(2 * ch, 0);
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
  expect(note?.text.length).toBeGreaterThan(64);
  // Capped at 64ch — the cell wrapped rather than taking the width its text asked for.
  expect(note?.width).toBeLessThanOrEqual(64 * ch + 1);
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
    [B_HEAD, B_IMAGE],
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

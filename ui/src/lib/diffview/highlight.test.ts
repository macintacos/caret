import { expect, test } from "bun:test";

import { type ChunkState, highlightChunk, highlightExcerpt } from "$lib/diffview/highlight.ts";

// Thin glue over shiki; the full visual render is covered by e2e. These pin the
// contract: highlighted HTML for a known grammar, plain fallback otherwise.
test("returns shiki HTML for a known grammar, preserving the code text", async () => {
  const html = await highlightExcerpt("const x = 1;", "typescript", "caret-dark");
  expect(html).toContain("<pre");
  expect(html).toContain("const");
});

test("falls back to plain text for an unknown grammar (still renders the code)", async () => {
  const html = await highlightExcerpt("hello world", "not-a-real-lang", "caret-light");
  expect(html).toContain("hello world");
});

// The excerpt popover opens over the plan view, so it has to read as the same
// palette — a vendor theme's excerpt is highlighted in that theme (EXC-752), not
// in caret's colors at the matching scheme. Pinned on Dracula's own pink keyword
// (EXC-896) rather than on a caret hue: caret's named color set carries no pink at
// all, so only the upstream theme can put it in the HTML.
test("highlights the excerpt in the named theme", async () => {
  const html = await highlightExcerpt("const x = 1;", "typescript", "dracula");
  expect(html.toLowerCase()).toContain("#ff79c6");
});

// highlightChunk is what lets the preview arrive in pieces: each chunk is
// coloured from where the previous one left off, so a construct that opens
// before a boundary keeps colouring the lines after it. The bar is equality,
// not approximation — chunked rows must match the whole-file pass exactly.

// A block comment that opens on line 2 and closes on line 4, so a 3-line split
// puts its opening and its closing in different chunks.
const BLOCK_COMMENT = [
  "const before = 1;",
  "/* a block comment",
  "   still commented",
  "   closes here */",
  "const after = 2;",
  "const last = 3;",
];

// A template literal whose backtick opens on line 2 and closes on line 5,
// straddling the same 3-line boundary.
const TEMPLATE_LITERAL = [
  "const before = 1;",
  "const tpl = `line one",
  "  line two",
  "  line three",
  "  line four`;",
  "const after = 2;",
];

// Highlight `lines` in fixed-size chunks and concatenate the rows. With
// `carry` off the state is dropped between chunks, which is the miscolouring
// this API exists to prevent.
async function inChunks(lines: string[], size: number, carry = true): Promise<string[]> {
  const rows: string[] = [];
  let state: ChunkState | undefined;
  for (let i = 0; i < lines.length; i += size) {
    const chunk = await highlightChunk(
      lines.slice(i, i + size).join("\n"),
      "typescript",
      "caret-dark",
      state,
    );
    rows.push(...chunk.rows);
    state = carry ? chunk.state : undefined;
  }
  return rows;
}

const whole = (lines: string[]): Promise<string[]> => inChunks(lines, lines.length);

test("chunks carrying grammar state colour a straddling block comment like one pass", async () => {
  expect(await inChunks(BLOCK_COMMENT, 3)).toEqual(await whole(BLOCK_COMMENT));
});

test("chunks carrying grammar state colour a straddling template literal like one pass", async () => {
  expect(await inChunks(TEMPLATE_LITERAL, 3)).toEqual(await whole(TEMPLATE_LITERAL));
});

// Guards the two tests above against passing vacuously: without the carried
// state the split genuinely miscolours, so equality is the API's doing.
test("dropping the carried state miscolours the lines after a boundary", async () => {
  expect(await inChunks(BLOCK_COMMENT, 3, false)).not.toEqual(await whole(BLOCK_COMMENT));
});

test("returns one row per line, so rows pair with line numbers by index", async () => {
  const chunk = await highlightChunk(BLOCK_COMMENT.join("\n"), "typescript", "caret-dark");
  expect(chunk.rows).toHaveLength(BLOCK_COMMENT.length);
});

// The rows are the excerpt's own per-line HTML, so the preview renders
// identically whichever entry point it loads through.
test("a row is the line's HTML as highlightExcerpt emits it", async () => {
  const code = BLOCK_COMMENT.join("\n");
  const html = await highlightExcerpt(code, "typescript", "caret-dark");
  const { rows } = await highlightChunk(code, "typescript", "caret-dark");
  for (const row of rows) expect(html).toContain(`<span class="line">${row}</span>`);
});

test("falls back to plain text for an unknown grammar without throwing", async () => {
  const chunk = await highlightChunk("hello world\nsecond line", "not-a-real-lang", "caret-light");
  expect(chunk.rows).toHaveLength(2);
  expect(chunk.rows.join("")).toContain("hello world");
});

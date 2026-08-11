import { beforeAll, expect, test } from "bun:test";

import {
  type ChunkState,
  highlightChunk,
  highlightExcerpt,
  MAX_HIGHLIGHT_LINE_CHARS,
} from "$lib/diffview/highlight.ts";

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

// shiki compiles a grammar's patterns lazily, at first tokenize, and that cost
// counts against its 500ms per-line tokenize limit — enough for a cold grammar to
// bail mid-line and leave the rest of that line unstyled. Pay it up front, so the
// comparisons below measure carried grammar state rather than who tokenized first.
beforeAll(async () => {
  for (const fixture of [BLOCK_COMMENT, TEMPLATE_LITERAL]) await whole(fixture);
});

test("chunks carrying grammar state colour a straddling block comment like one pass", async () => {
  expect(await inChunks(BLOCK_COMMENT, 3)).toEqual(await whole(BLOCK_COMMENT));
});

test("chunks carrying grammar state colour a straddling template literal like one pass", async () => {
  expect(await inChunks(TEMPLATE_LITERAL, 3)).toEqual(await whole(TEMPLATE_LITERAL));
});

// Guards both tests above against passing vacuously: each fixture genuinely
// miscolours when the state is dropped, so the equality above is the API's doing
// and not a fixture that stopped straddling its boundary.
test("dropping the carried state miscolours the lines after a boundary", async () => {
  for (const fixture of [BLOCK_COMMENT, TEMPLATE_LITERAL])
    expect(await inChunks(fixture, 3, false)).not.toEqual(await whole(fixture));
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
  expect(rows).toHaveLength(BLOCK_COMMENT.length);
  for (const row of rows) expect(html).toContain(`<span class="line">${row}</span>`);
});

test("falls back to plain text for an unknown grammar without throwing", async () => {
  const chunk = await highlightChunk("hello world\nsecond line", "not-a-real-lang", "caret-light");
  expect(chunk.rows).toHaveLength(2);
  expect(chunk.rows.join("")).toContain("hello world");
});

// The never-throws guarantee with the failure injected rather than assumed: a
// state belongs to the grammar that produced it, and shiki rejects a mismatch
// outright. The chunk has to come back rowless for the caller to render plain,
// never as a rejection the preview has to catch.
test("a state from another language yields no rows instead of throwing", async () => {
  const { state } = await highlightChunk("const x = 1;", "typescript", "caret-dark");
  expect(state).toBeDefined();
  expect(await highlightChunk("print(1)", "python", "caret-dark", state)).toEqual({ rows: [] });
});

// One very long line is the cost row virtualization cannot window away — it is a
// single row — and a TextMate grammar's cost on a line is quadratic in its
// length: an unbroken 16 KiB run takes ~40 s to tokenize with this bundle, which
// is a frozen main thread, not a slow render. Past MAX_HIGHLIGHT_LINE_CHARS the
// chunk takes the rowless path instead, which is the same fallback a chunk that
// failed to highlight already uses (EXC-973).
test("a chunk carrying an over-long line yields no rows instead of tokenizing it", async () => {
  const long = "a".repeat(MAX_HIGHLIGHT_LINE_CHARS + 1);
  const code = `const before = 1;\n${long}\nconst after = 2;`;
  expect(await highlightChunk(code, "typescript", "caret-dark")).toEqual({ rows: [] });
});

// The same bound on the other entry point (EXC-1056), where it is load-bearing for a
// second reason: with shiki's wall-clock budget off, the line length is the only thing
// left between an excerpt and that ~40 s tokenize.
test("an excerpt carrying an over-long line yields no HTML instead of tokenizing it", async () => {
  const long = "a".repeat(MAX_HIGHLIGHT_LINE_CHARS + 1);
  expect(await highlightExcerpt(`const before = 1;\n${long}`, "typescript", "caret-dark")).toBe("");
});

test("a line at the limit still highlights", async () => {
  const atLimit = `const s = "${"a".repeat(MAX_HIGHLIGHT_LINE_CHARS - 13)}";`;
  expect(atLimit).toHaveLength(MAX_HIGHLIGHT_LINE_CHARS);
  const chunk = await highlightChunk(atLimit, "typescript", "caret-dark");
  expect(chunk.rows).toHaveLength(1);
});

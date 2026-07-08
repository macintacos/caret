// Block model for the rendered plan view (EXC-693). marked's block lexer parses
// the plan into blocks — paragraph, heading, list, blockquote, code, table, hr,
// footnote — and this module turns each into a PlanBlock carrying its exact
// source line range. The range is the accuracy contract: the view may join a
// soft-wrapped paragraph into one flowing block (a single newline is a
// continuation; a blank line is a real break), but a comment on that block still
// reports the true [startLine, endLine] to the LLM, so what's reviewed matches
// the source verbatim even when the visuals combine lines.
//
// Inline content (paragraph text, headings, list items, table cells) is decorated
// by decoratedInline, which keeps emphasis markers visible. Only the structure
// lives here. Pure and DOM-free — unit-tested directly.
import { Lexer } from "marked";
import { decorateInline } from "./decoratedInline.ts";

/** 1-based, inclusive source line range a block occupies. */
export interface Pos {
  startLine: number;
  endLine: number;
}

export type Align = "left" | "center" | "right" | null;

/** One source line of a paragraph: its decorated inline HTML plus the 1-based
 * source line it came from. A soft-wrapped paragraph is joined visually into one
 * flowing block, but keeps a segment per source line so each is its own hover /
 * click / drag target — the per-line interaction that mirrors the source view. */
export interface PlanLine {
  line: number;
  html: string;
}

export interface PlanListItem extends Pos {
  /** The item's own leading text, one decorated segment per source line (empty
   * when the item is purely nested blocks). A bullet that soft-wraps in the source
   * spans several lines, each its own hover / click target — like a paragraph. */
  lines: PlanLine[];
  /** A GFM task-list item (`- [ ]` / `- [x]`)? */
  task: boolean;
  checked: boolean;
  /** Nested blocks inside the item (sub-lists, extra paragraphs), each carrying
   * its own source lines. */
  children: PlanBlock[];
}

export type PlanBlock =
  | (Pos & { kind: "paragraph"; lines: PlanLine[] })
  | (Pos & { kind: "heading"; level: number; html: string })
  | (Pos & { kind: "code"; lang: string | null; text: string })
  | (Pos & { kind: "blockquote"; children: PlanBlock[] })
  | (Pos & { kind: "list"; ordered: boolean; start: number | null; items: PlanListItem[] })
  | (Pos & {
      kind: "table";
      align: Align[];
      header: string[];
      rows: string[][];
      /** Source line of the header row. */
      headerLine: number;
      /** Source line of each data row (after the header + alignment divider). */
      rowLines: number[];
    })
  | (Pos & { kind: "hr" })
  | (Pos & { kind: "footnote"; label: string; html: string });

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function newlineCount(s: string): number {
  let n = 0;
  for (const ch of s) if (ch === "\n") n++;
  return n;
}

// The block occupies [start, start + newlines(raw)], minus one when raw ends in a
// newline (that trailing newline is separation, not content). Advancing the cursor
// by newlines(raw) keeps every following block aligned because token raws
// concatenate back to the source.
function rangeOf(raw: string, startLine: number): Pos {
  const nl = newlineCount(raw);
  return { startLine, endLine: startLine + nl - (raw.endsWith("\n") ? 1 : 0) };
}

// A marked token; only the fields this module reads are named.
interface Token {
  type: string;
  raw: string;
  text?: string;
  depth?: number;
  lang?: string;
  ordered?: boolean;
  start?: number | "";
  task?: boolean;
  checked?: boolean;
  tokens?: Token[];
  items?: Token[];
  header?: { text: string }[];
  rows?: { text: string }[][];
  align?: Align[];
}

const FOOTNOTE_DEF = /^\[\^([^\]]+)\]:[ \t]*([\s\S]*)$/;
const ATX_MARKER = /^\s{0,3}#{1,6}[ \t]+/;

// A heading shows its `#` markers: emit the leading `## ` as a marker span, then
// decorate the remainder (any inline emphasis in the title stays visible too). A
// setext heading (underlined) has no `#` prefix — fall back to the title text.
function headingHtml(tok: Token): string {
  const marker = tok.raw.match(ATX_MARKER)?.[0];
  if (marker == null) return decorateInline(tok.text ?? "");
  const body = tok.raw.slice(marker.length);
  return `<span class="md-marker">${escapeHtml(marker)}</span>${decorateInline(body)}`;
}

// Split a paragraph's source text into one decorated segment per source line,
// numbered from the paragraph's start. A single '\n' is a soft wrap, so the view
// flows the segments back together, but each keeps its true line number to anchor
// a per-line comment. (An inline construct straddling a soft wrap decorates as
// literal markers — a documented spike limitation; caret plans wrap rarely.)
function paragraphLines(text: string, startLine: number): PlanLine[] {
  return text.split("\n").map((line, i) => ({ line: startLine + i, html: decorateInline(line) }));
}

function parseListItem(item: Token, pos: Pos): PlanListItem {
  let lines: PlanLine[] = [];
  const children: PlanBlock[] = [];
  // A cursor down the item's own source lines, so a nested list / loose paragraph
  // gets its true start line rather than inheriting the item's. Every child (even
  // the skipped checkbox / blank-line space) advances it by its newline count —
  // the item's tokens concatenate back over its source lines.
  let line = pos.startLine;
  for (const child of item.tokens ?? []) {
    const childPos = rangeOf(child.raw, line);
    line += newlineCount(child.raw);
    if (child.type === "space" || child.type === "checkbox") {
      // The checkbox is captured by task/checked; blank lines carry nothing.
      continue;
    }
    if (lines.length === 0 && (child.type === "text" || child.type === "paragraph")) {
      // The item's leading text, shown inline next to the bullet/checkbox — split
      // per source line so a soft-wrapped bullet's continuation is its own target.
      lines = paragraphLines(child.text ?? "", childPos.startLine);
      continue;
    }
    // Everything after the leading text — a second paragraph in a loose item, a
    // nested list, a fenced block — renders as its own block below, in source
    // order (never concatenated onto the leading run).
    const block = buildBlock(child, childPos);
    if (block) children.push(block);
  }
  return { ...pos, lines, task: item.task === true, checked: item.checked === true, children };
}

// Track each top-level item's real source range. The rendered view anchors
// comments at the whole-list level today, so these ranges aren't yet used for
// anchoring — they are kept correct (and tested) so per-item anchoring stays a
// cheap future change. Nested lists reuse the parent's line as an approximation.
function parseListItems(items: Token[], startLine: number): PlanListItem[] {
  let line = startLine;
  return items.map((item) => {
    const pos = rangeOf(item.raw, line);
    line += newlineCount(item.raw);
    return parseListItem(item, pos);
  });
}

// Turn one marked token into a PlanBlock at the given source range. Nested calls
// (blockquote children, list-item blocks) pass the parent's range — those blocks
// render for structure but inherit the parent's anchor, so their own range is
// unused. Returns null for tokens that carry no rendered block (e.g. "space").
function buildBlock(tok: Token, pos: Pos): PlanBlock | null {
  switch (tok.type) {
    case "space":
      return null;
    case "heading":
      return { ...pos, kind: "heading", level: tok.depth ?? 1, html: headingHtml(tok) };
    case "code":
      return { ...pos, kind: "code", lang: tok.lang ? tok.lang : null, text: tok.text ?? "" };
    case "hr":
      return { ...pos, kind: "hr" };
    case "blockquote": {
      // Track a cursor down the quote's source lines. marked strips one '> '
      // level from each child's raw but leaves the newlines intact, so the same
      // newline-count advance keeps every child (and nested quote) on its true
      // source line.
      const children: PlanBlock[] = [];
      let line = pos.startLine;
      for (const child of tok.tokens ?? []) {
        const childPos = rangeOf(child.raw, line);
        line += newlineCount(child.raw);
        const block = buildBlock(child, childPos);
        if (block) children.push(block);
      }
      return { ...pos, kind: "blockquote", children };
    }
    case "list": {
      const startNum = typeof tok.start === "number" ? tok.start : 1;
      return {
        ...pos,
        kind: "list",
        ordered: tok.ordered === true,
        start: tok.ordered === true ? startNum : null,
        items: parseListItems(tok.items ?? [], pos.startLine),
      };
    }
    case "table": {
      // The header sits on the block's start line, the |---| alignment divider
      // takes the next (it renders no row), and the data rows follow — so each row
      // maps to a real source line for per-row commenting.
      const rows = tok.rows ?? [];
      return {
        ...pos,
        kind: "table",
        align: tok.align ?? [],
        header: (tok.header ?? []).map((c) => decorateInline(c.text)),
        rows: rows.map((row) => row.map((c) => decorateInline(c.text))),
        headerLine: pos.startLine,
        rowLines: rows.map((_, i) => pos.startLine + 2 + i),
      };
    }
    case "paragraph":
    case "text": {
      const source = tok.text ?? tok.raw;
      const fn = FOOTNOTE_DEF.exec(source);
      if (fn) {
        return { ...pos, kind: "footnote", label: fn[1] ?? "", html: decorateInline(fn[2] ?? "") };
      }
      return { ...pos, kind: "paragraph", lines: paragraphLines(source, pos.startLine) };
    }
    default:
      // Block-level raw HTML and any unmodeled token: show its source as escaped,
      // inert text so nothing executes and nothing is silently dropped.
      return {
        ...pos,
        kind: "paragraph",
        lines: (tok.raw ?? "").split("\n").map((s, i) => ({
          line: pos.startLine + i,
          html: escapeHtml(s),
        })),
      };
  }
}

/**
 * Parse plan markdown into rendered blocks, each carrying its exact source line
 * range. Top-level order is preserved; blank-line "space" tokens advance the
 * line cursor but emit no block.
 */
export function parsePlan(source: string): PlanBlock[] {
  const blocks: PlanBlock[] = [];
  let line = 1;
  for (const tok of Lexer.lex(source) as Token[]) {
    const pos = rangeOf(tok.raw, line);
    line += newlineCount(tok.raw);
    const block = buildBlock(tok, pos);
    if (block) blocks.push(block);
  }
  return blocks;
}

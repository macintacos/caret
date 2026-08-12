// Pure emission for the plan view's inline-markdown layer (EXC-855, EXC-866).
// Takes one DISPLAY line and returns the flat atomic runs covering it — one span
// per element-bounded stretch of identical attribute set, each carrying every
// attribute that covers it — plus the line's blockquote depth. Nothing is
// stripped and nothing is rewritten: markers are part of the runs that mark them,
// which is what keeps display columns equal to source columns and copy honest.
//
// Flat runs are a requirement rather than a style. The decoration pass (EXC-867)
// turns each run into a sibling element, and every pass that then locates a token
// walks the row accumulating text length: tagLanguageToken / tagFenceToken
// (codeBlocks.ts) over the row's direct children, tagTokenAt (fileRefTag.ts) over
// rowTokens.ts's tokenChildren — the row's own children, or a table row's cells'
// children one level down. A nested wrapper would break that partition and put
// data-file-ref on an element spanning more than the reference — the exact case
// tagTokenAt's two-bound check exists to refuse.
//
// Abutting elements are NOT fused into one run even when their attributes match.
// `*a*_b_` is two italic runs, and two adjacent links are two link runs: the
// boundary is where EXC-867 draws a pill's rounded end, and for links it is the
// only record of which label belongs to which target.
//
// The inline grammar comes from marked, already a UI dependency (lib/markdown.ts
// renders comment bodies with it). Reusing its CommonMark delimiter-run pass is
// what makes nested emphasis, emphasis inside link labels, escaped markers and
// emphasis-looking text inside inline code come out right; a hand-rolled scanner
// would be the fiddliest parser in the repo for a strictly worse answer. Columns
// come from the token tree's own `raw` strings, which tile the line exactly.
//
// The line is read as DISPLAY text, not source: on a line with no link collapse
// the two are identical, and on one that collapsed the label survives verbatim,
// so emphasis inside a collapsed label lands on the columns the reader sees. That
// is why this layer needs no column remapping of its own.
//
// Blockquote depth is reported twice over, because its consumers want different
// things: the whole-line depth rides the row (EXC-863 subdues a quoted line's ink
// there), while each `>` gets its own run so the level bars can be drawn over the
// marker columns.

import { Lexer, type Token } from "marked";

/** One run of identical attributes on a display line. Columns are 0-based,
 * half-open [startCol, endCol) into the display line's text. A run always carries
 * at least one attribute — unmarked stretches are simply absent. */
export interface InlineSpan {
  startCol: number;
  endCol: number;
  /** `**x**` / `__x__`, markers included. */
  bold?: true;
  /** `*x*` / `_x_`, markers included. */
  italic?: true;
  /** An inline-code span, backticks included. */
  code?: true;
  /** A link's clickable or collapsed label, or the whole never-collapsing shape of
   * an image (EXC-870). The two differ on target safety: a link the layer refused
   * to collapse takes no run at all, so an unsafe-scheme target draws nothing,
   * while an image takes one whether or not its target can be fetched — the chip
   * with no picture under it is exactly what a failed image is meant to read as. */
  link?: true;
  /** The `[ ]` / `[x]` bracket run of a task-list item, and only that run. */
  checkbox?: "checked" | "unchecked";
  /** The 1-based nesting level of the `>` marker this run IS. Marker runs only —
   * the line's depth is reported separately, since it belongs to the row. */
  quoteMarker?: number;
}

/** Per-line inline runs, keyed by 1-based display line number. Lines with no runs
 * are absent from the map. */
export type InlineSpanMap = Map<number, InlineSpan[]>;

/** A half-open range of display columns, spelled like every other column-bearing
 * type in this directory (`InlineSpan`, `LinkSpan`, `FileRefSpan`). */
export interface ColumnRange {
  startCol: number;
  endCol: number;
}

type Attributes = Omit<InlineSpan, "startCol" | "endCol">;

type Interval = ColumnRange & { attributes: Attributes };

// The token types that ARE an attribute. Everything else marked emits — text,
// escape, del, html, image, link, br — contributes no attribute of its own, but
// is still descended into so its contents are attributed. Links are absent
// deliberately: by the time this reads the display line a collapsed label is
// plain prose, so link columns arrive from the caller instead.
const TOKEN_ATTRIBUTES: Record<string, Attributes> = {
  strong: { bold: true },
  em: { italic: true },
  codespan: { code: true },
};

// A blockquote marker: `>` preceded by up to three spaces, per CommonMark's
// indentation allowance. A fourth space makes the line indented content instead.
// Deliberately NOT widened to accept a leading tab: a tab expands to the next
// tab stop, which is four columns of indent and therefore indented content.
const QUOTE_MARKER = /^ {0,3}>/;

// A list marker standing in front of the first `>`: `- > quoted` is a blockquote
// inside a list item, and CommonMark counts the marker as that item's indentation.
// The lookahead is what makes this safe to consume unconditionally — with no `>`
// behind it nothing matches, so `contentStart` on an ordinary list line (and with
// it the TASK_MARKER scan below) is exactly where it was.
const LIST_PREFIX = /^ {0,3}(?:[-*+]|\d+[.)])\s+(?=>)/;

// A task-list item's bracket run, anchored at the start of the line's content
// (past any quote prefix): a bullet or an ordered marker, then `[ ]`, `[x]` or
// `[X]`, then whitespace or the line's end — `- [x]done` is not a task item.
// Group 1 is what precedes the brackets, so its length is their offset from the
// content start rather than from column zero.
const TASK_MARKER = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\](?=\s|$)/;

/** The blockquote prefix: one interval per `>` and the column its content starts
 * at, which is where the task-marker scan begins. `labelRanges` are the display
 * columns the caller rewrote — every link and reference label. A `>` inside one is
 * label text rather than a marker (`[> x](url)` displays as `> x`) and ends the
 * scan; it must be the FULL set, since a label that resolved to a file reference
 * never reaches the link half. */
function scanQuotePrefix(
  line: string,
  labelRanges: readonly ColumnRange[],
): { intervals: Interval[]; contentStart: number } {
  const intervals: Interval[] = [];
  let pos = LIST_PREFIX.exec(line)?.[0].length ?? 0;
  for (;;) {
    const match = QUOTE_MARKER.exec(line.slice(pos));
    if (match === null) break;
    const at = pos + match[0].length - 1;
    if (labelRanges.some((r) => r.startCol <= at && at < r.endCol)) break;
    intervals.push({
      startCol: at,
      endCol: at + 1,
      attributes: { quoteMarker: intervals.length + 1 },
    });
    // One optional space OR TAB after the marker is part of the prefix, not the
    // content — a tab separates two levels exactly as a space does.
    pos = line[at + 1] === " " || line[at + 1] === "\t" ? at + 2 : at + 1;
  }
  return { intervals, contentStart: pos };
}

/** Walks marked's inline token tree, accumulating columns off each token's `raw`.
 * Descent into a container locates its content by finding the children's own raw
 * text inside the parent's, which is exact for every container marked emits
 * today. The `-1` branch is a defensive floor with no known trigger, kept because
 * the alternative when a future grammar breaks the assumption is a whole subtree
 * of columns silently shifted; leaving it un-attributed is the working
 * agreement's prescribed landing. */
function collectTokenIntervals(tokens: Token[], base: number, into: Interval[]): void {
  let col = base;
  for (const token of tokens) {
    const raw = token.raw ?? "";
    const attributes = TOKEN_ATTRIBUTES[token.type];
    if (attributes !== undefined)
      into.push({ startCol: col, endCol: col + raw.length, attributes });
    const children = (token as { tokens?: Token[] }).tokens;
    if (children !== undefined && children.length > 0) {
      const inner = children.map((child) => child.raw ?? "").join("");
      const offset = raw.indexOf(inner);
      if (offset !== -1) collectTokenIntervals(children, col + offset, into);
    }
    col += raw.length;
  }
}

/** Cuts the intervals at every boundary they introduce and keeps the stretches
 * some interval covers — the atomic-run partition the decoration pass consumes.
 * Cells are never fused across a boundary, so a run is always bounded by the
 * elements that produced it. */
function flatten(intervals: Interval[]): InlineSpan[] {
  const bounds = new Set<number>();
  for (const interval of intervals) {
    if (interval.endCol <= interval.startCol) continue;
    bounds.add(interval.startCol);
    bounds.add(interval.endCol);
  }
  const spans: InlineSpan[] = [];
  let startCol: number | undefined;
  for (const endCol of [...bounds].sort((a, b) => a - b)) {
    if (startCol !== undefined) {
      const attributes: Attributes = {};
      for (const interval of intervals) {
        if (interval.startCol <= startCol && interval.endCol >= endCol) {
          Object.assign(attributes, interval.attributes);
        }
      }
      if (Object.keys(attributes).length > 0) spans.push({ startCol, endCol, ...attributes });
    }
    startCol = endCol;
  }
  return spans;
}

/** The flat atomic runs covering one display line, plus its blockquote depth.
 * `linkRanges` are display columns the caller already resolved — every clickable
 * link span plus every collapsed label that carries no file reference — and become
 * `link: true` runs. `labelRanges` is the superset the caller rewrote at all,
 * references included; only the blockquote scan reads it, to tell a marker from a
 * label that merely starts with one. Fenced-code lines never reach here; the
 * caller passes them through untouched. */
export function buildInlineSpans(
  display: string,
  linkRanges: readonly ColumnRange[],
  labelRanges: readonly ColumnRange[],
): { spans: InlineSpan[]; quoteDepth: number } {
  const quote = scanQuotePrefix(display, labelRanges);
  const intervals: Interval[] = [...quote.intervals];

  const task = TASK_MARKER.exec(display.slice(quote.contentStart));
  if (task !== null) {
    const startCol = quote.contentStart + (task[1] ?? "").length;
    intervals.push({
      startCol,
      endCol: startCol + 3,
      attributes: { checkbox: task[2] === " " ? "unchecked" : "checked" },
    });
  }

  collectTokenIntervals(Lexer.lexInline(display, { gfm: true }), 0, intervals);

  for (const range of linkRanges) {
    intervals.push({ startCol: range.startCol, endCol: range.endCol, attributes: { link: true } });
  }

  return { spans: flatten(intervals), quoteDepth: quote.intervals.length };
}

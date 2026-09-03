// Pure emission for the plan view's inline-markdown layer (EXC-855, EXC-866).
// Takes one DISPLAY line and returns the flat atomic runs covering it — each
// carrying every attribute that covers it — plus the line's blockquote depth.
//
// Flat runs are a requirement rather than a style. The decoration pass (EXC-867)
// turns each run into a sibling element, and every pass that then locates a token
// walks the row accumulating text length: tagLanguageToken / tagFenceToken
// (codeBlocks.ts) over the row's direct children, tagTokenAt (fileRefTag.ts) over
// rowTokens.ts's tokenChildren. A nested wrapper would break that partition and
// put data-file-ref on an element spanning more than the reference — the exact
// case tagTokenAt's two-bound check exists to refuse.
//
// `*a*_b_` is two italic runs, and two adjacent links are two link runs
// (EXC-867) — for links, that boundary is the only record of which label
// belongs to which target.
//
// The inline grammar comes from marked, already a UI dependency (lib/markdown.ts
// renders comment bodies with it). Reusing its CommonMark delimiter-run pass is
// what makes emphasis-looking text inside inline code come out right. Columns
// come from the token tree's own `raw` strings, which tile the line exactly.
//
// The line is read as DISPLAY text, not source: on a line with no link collapse
// the two are identical, and on one that collapsed the label survives verbatim,
// so emphasis inside a collapsed label lands on the columns the reader sees.
//
// Where the reference layer (EXC-687) and that grammar disagree, the reference
// wins (EXC-1066): emphasis inside a reference range is dropped before the runs
// are cut, because a filename like `foo/__init__.py` spells CommonMark emphasis it
// does not mean. Suppressing at emission rather than at decoration is what keeps a
// reference nested inside real emphasis to ONE bold run — a post-hoc filter would
// already have three identical-attribute runs to fuse, and abutting runs are
// deliberately never fused (above). Only the LINK-TARGET references need passing
// in; a scanned reference lives inside inline code by construction, and inline
// code is exempt from the suppression anyway.
//
// Blockquote depth is reported twice over, because its consumers want different
// things: the whole-line depth rides the row (EXC-863 subdues a quoted line's ink
// there), while each `>` gets its own run so the level bars can be drawn over the
// marker columns.
//
// A LIST MARKER (EXC-861) is a run over the marker characters alone, never over
// the indentation before them: the marker is overdrawn where it sits, and the
// columns to its left are what spell the nesting depth. Its kind is settled here
// rather than in CSS, because a task item's `-` and its `[ ]` would otherwise both
// claim to be the item's marker — so a marker whose item is a task is emitted as
// `task`, leaving EXC-860's checkbox as the row's one treatment. A `task` run also
// swallows the gap to the checkbox, because the sheet collapses that run instead of
// overdrawing it and the box has to land at the column the marker started at.

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
  /** The `[ ]` / `[x]` / `[/]` bracket run of a task-list item, and only that run. */
  checkbox?: "checked" | "unchecked" | "slashed";
  /** The 1-based nesting level of the `>` marker this run IS. Marker runs only —
   * the line's depth is reported separately, since it belongs to the row. */
  quoteMarker?: number;
  /** The list-item marker run this IS — the `-` / `*` / `+`, or the `1.` / `2)`,
   * and only those characters (EXC-861). `task` is a marker whose item also
   * carries a checkbox: the two would otherwise compete for the same row, and the
   * checkbox is the marker of a task item, so the kind is decided here rather than
   * left to CSS to unpick. A `task` run is the ONE kind that reaches past the marker
   * characters, to the checkbox: the sheet collapses it to nothing so the box lands
   * where the item's text would have begun, which takes the gap with it. Indentation
   * is NOT part of any run — the columns before the marker carry the nesting, and a
   * task item keeps its. */
  listMarker?: "bullet" | "ordered" | "task";
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
const LIST_PREFIX = /^ {0,3}(?:[-*+]|\d{1,9}[.)])\s+(?=>)/;

// A task-list item's bracket run, anchored at the start of the line's content
// (past any quote prefix): a bullet or an ordered marker, then `[ ]`, `[x]`, `[X]`
// or `[/]`, then whitespace or the line's end — `- [x]done` is not a task item.
// `[/]` is not CommonMark's — it is the in-progress state the agents caret reads
// plans from already write — and it costs the scan one character to accept.
// Group 1 is what precedes the brackets, so its length is their offset from the
// content start rather than from column zero.
//
// The nine-digit cap is CommonMark's, and all THREE scans in this file that read an
// ordered marker — LIST_PREFIX above, this one, and LIST_MARKER below — spell it the
// same way, because they decide the same question: does this line open a list item. A
// digit run past the cap opens none, so every scan must refuse it. One scan reading
// further than another leaves the row carrying half a decoration: a checkbox with no
// marker tagged beside it, or a quote prefix measured past an indent that is not one.
const TASK_MARKER = /^(\s*(?:[-*+]|\d{1,9}[.)])\s+)\[([ xX/])\](?=\s|$)/;

// A thematic break: three or more of the SAME marker, spaces or tabs allowed
// between them, and nothing else on the line. Checked before the list scan
// because `- - -` and `* * *` satisfy both shapes and CommonMark gives the break
// precedence — EXC-862 owns what a break draws, and this is what keeps a list
// marker off it. `_` never opens a list item, so it is here only to spell the
// construct completely.
const THEMATIC_BREAK = /^\s*([-*_])[ \t]*(?:\1[ \t]*){2,}$/;

// A list-item marker at the start of the line's content (past any quote prefix):
// indentation, then a bullet or an ordered marker, then whitespace or the line's
// end. The trailing lookahead is the whole negative half — it is what refuses
// `---`, `**bold**`, `*italic*` and a hyphen mid-word, none of which put a space
// after the character. Group 1 is the indentation, so its length is the marker's
// offset from the content start; group 2 is the marker itself. Nine digits is
// CommonMark's cap on an ordered marker.
//
// This layer reads one line with no block context beyond the quote prefix, so the
// one shape it over-matches is a `- item` inside a FOUR-SPACE-INDENTED code block,
// which CommonMark reads as code and this reads as a nested list. Telling them
// apart needs block-level parsing the whole module deliberately does not do —
// indentation is also how nesting is spelled — and the fenced form, which is how
// caret's plans actually carry code, never reaches here at all (links.ts passes
// fenced lines through untouched).
const LIST_MARKER = /^(\s*)([-*+]|\d{1,9}[.)])(?=\s|$)/;

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

/** Whether a token interval falls inside a range the reference layer claimed
 * (EXC-1066). A path IS the markup, so the emphasis CommonMark reads out of
 * `foo/__init__.py` must not cut the reference into three tokens.
 *
 * Containment is the whole test, coextension included: `[**a/b.ts**](a/b.ts)` and
 * `[a **bold** label](a/b.ts)` make the same claim over the same columns, and which
 * one keeps its emphasis must not turn on where the markers happen to sit. An
 * interval that only PARTLY overlaps a range is kept — that markup extends past the
 * reference, so it was never the reference's own spelling. */
function insideReference(interval: ColumnRange, refs: readonly ColumnRange[]): boolean {
  return refs.some((r) => r.startCol <= interval.startCol && interval.endCol <= r.endCol);
}

/** Pushes the list-marker interval opening at `offset`, if one does. A thematic
 * break is refused first, and the kind is decided from the SAME slice the marker
 * came from: a marker is `task` only when the brackets belong to its own item, so
 * a bullet outside a quote does not inherit the taskness of a bullet inside it.
 * That one scan settles the run's width as well as its kind — a task's marker is
 * collapsed rather than overdrawn, so it has to cover everything the row stops
 * spending, which is the marker AND the gap to the checkbox. */
function listMarkerAt(display: string, offset: number, into: Interval[]): void {
  const slice = display.slice(offset);
  if (THEMATIC_BREAK.test(slice)) return;
  const list = LIST_MARKER.exec(slice);
  if (list === null) return;
  const marker = list[2] ?? "";
  const startCol = offset + (list[1] ?? "").length;
  const task = TASK_MARKER.exec(slice);
  into.push({
    // A task's run runs to the checkbox rather than stopping at the marker, so the
    // whitespace between them belongs to it — group 1 is indentation, marker and that
    // whitespace together, and the indentation is already what `startCol` skipped.
    startCol,
    endCol: task === null ? startCol + marker.length : offset + (task[1] ?? "").length,
    attributes: {
      listMarker: task !== null ? "task" : /\d/.test(marker) ? "ordered" : "bullet",
    },
  });
}

/** The flat atomic runs covering one display line, plus its blockquote depth.
 * `linkRanges` are display columns the caller already resolved — every clickable
 * link span plus every collapsed label that carries no file reference — and become
 * `link: true` runs. `labelRanges` is the superset the caller rewrote at all,
 * references included; only the blockquote scan reads it, to tell a marker from a
 * label that merely starts with one. `refRanges` are the columns the reference
 * layer claimed, whose interior markup is suppressed. Fenced-code lines never
 * reach here; the caller passes them through untouched. */
export function buildInlineSpans(
  display: string,
  linkRanges: readonly ColumnRange[],
  labelRanges: readonly ColumnRange[],
  refRanges: readonly ColumnRange[],
): { spans: InlineSpan[]; quoteDepth: number } {
  const quote = scanQuotePrefix(display, labelRanges);
  const intervals: Interval[] = [...quote.intervals];

  const content = display.slice(quote.contentStart);

  const task = TASK_MARKER.exec(content);
  if (task !== null) {
    const startCol = quote.contentStart + (task[1] ?? "").length;
    intervals.push({
      startCol,
      endCol: startCol + 3,
      attributes: {
        checkbox: task[2] === " " ? "unchecked" : task[2] === "/" ? "slashed" : "checked",
      },
    });
  }

  // BOTH ends of the quote prefix are scanned, because the two constructs nest
  // either way round and each order hides a marker from the other scan. In
  // `> - item` the marker sits past the prefix; in `- > quoted` it sits before it,
  // where the quote scan counted it as the indentation CommonMark says it is. The
  // two offsets can never name the same marker — a prefix that moved the content
  // start consumed a `>`, which is not a marker character — so `- > - item` marks
  // both of its bullets and an unquoted line scans once.
  listMarkerAt(display, 0, intervals);
  if (quote.contentStart > 0) listMarkerAt(display, quote.contentStart, intervals);

  // Collected apart from the structural intervals above so only the token ones are
  // filtered. A checkbox or list marker is not markup a reference range can be read
  // against, and a `>` inside a label is already refused by the quote scan.
  //
  // A CODESPAN is exempt whatever it contains: its interior is literal, so it can
  // never be the collision this drops, and taking it away costs the reference the
  // chip it is drawn as. Both shapes that carry one are real — the citation
  // `[`a/b.ts`](a/b.ts)` emits its range over the whole backticked label, while a
  // prose label like `[the `resolve` handler](src/x.ts)` carries the span inside it.
  const tokens: Interval[] = [];
  collectTokenIntervals(Lexer.lexInline(display, { gfm: true }), 0, tokens);
  for (const token of tokens) {
    if (token.attributes.code !== undefined || !insideReference(token, refRanges)) {
      intervals.push(token);
    }
  }

  for (const range of linkRanges) {
    intervals.push({ startCol: range.startCol, endCol: range.endCol, attributes: { link: true } });
  }

  return { spans: flatten(intervals), quoteDepth: quote.intervals.length };
}

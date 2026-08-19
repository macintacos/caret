// Turns the flat inline runs (inlineSpans.ts) into decorable DOM for the plan
// view (EXC-867). shiki paints each row as a sequence of classless token spans
// whose text concatenates to the line; this pass makes that sequence FINER until
// no token straddles a run boundary, then tags each token with the run covering
// it. Everything downstream — the emphasis ink, the pills, the checkbox and
// blockquote decorations — is then one CSS rule against an attribute.
//
// The refining itself is rowTokens.ts's splitTokens, which is shared with the
// table pass and carries the split-only rule and its reasoning. What matters here
// is that it only ever refines, so every boundary shiki drew survives and every
// column tagTokenAt (fileRefTag.ts), tagLanguageToken and tagFenceToken
// (codeBlocks.ts) look for is still a token boundary. The same module's
// tokenChildren is how a row's tokens are reached, which is one level down for a
// table row (EXC-864) and the row's own children for every other.
//
// Pill grouping follows inlineSpans.ts's abutting-elements contract. A pill is
// drawn per ELEMENT, not per run, so consecutive runs are grouped — but the
// group BREAKS when two abutting runs carry the SAME attribute set, because that
// is precisely how the runs record two adjacent elements: `*a*_b_` is two italic
// runs and must draw two pills, while ``**a `c` b**`` is three runs of one bold
// element (their sets differ) and must draw one. Grouping on "shares a member"
// alone would fuse the first pair; grouping per run would shatter the second.
//
// File-reference columns are cut points too, and that is the whole reason this
// takes the reference map. For the citation shape `` [`foo/bar.ts`](foo/bar.ts) ``
// the display text is `` `foo/bar.ts` ``: the codespan run covers the backticks
// at [0,12) while the merged reference sits INSIDE them at [1,11). The two
// partitions interleave, and tagTokenAt requires a child that BEGINS exactly at
// the reference's start and ends within it. Adding the reference's columns to the
// cut set makes that child exist by construction rather than by shiki happening
// to tokenize the backticks apart — and it is what lets a prose-labelled
// reference, which shiki emits as one coarse run, take the glyph at all rather
// than only the click and the tooltip.
//
// Those cuts feed the cut set ONLY, never the grouping above. A reference cut
// inside a codespan would otherwise split it into three runs and three pills
// instead of one — a bug the inline-code chip (EXC-868) would inherit.
//
// The ROUNDED ENDS (data-md-start / data-md-end) mark where a pill closes, and a
// child gets one only where every member it carries opens (or closes) there. The
// constraint is CSS: border-radius is one geometric property of the box and clips
// every background layer on it, so it cannot be drawn per member. A nested member
// capping on its own would therefore round the enclosing pill's tint too, punching
// a notch through its middle — `**a `c` b**` would render the bold chip with a
// rounded hole where the code run sits. The outermost pill wins on the ELEMENT.
// Where a member is alone on the child, "every member" is just itself and it caps
// normally.
//
// A nested member gets its corners all the same, from a second BOX: data-md-inner
// names the members whose group sits inside another's on this child, and
// data-md-inner-start / -end are that inner pill's ends. The sheet paints those
// members on a pseudo-element, which has a radius of its own to spend — square
// inner ends inside a rounded outer pill is the artefact this replaces.
//
// The citation shape gets the opposite treatment, and data-md-cite is what asks
// for it: a codespan wrapping a resolved reference is not two chips but ONE
// reference chip, so every token of that code group is marked and the sheet
// rebinds the group's tint rather than capping the reference's end of it.
//
// Idempotency is a hard requirement, not a nicety: SourceView.svelte runs this
// from a MutationObserver watching childList over the whole subtree, so a pass
// that re-splits a settled row would loop forever. splitTokens owns that half — an
// already-correct token has no cut strictly inside it and is left completely
// untouched, the same way syncCodeBlockCards leaves a settled block alone.
// Attribute writes are free — the observer does not watch attributes — so only node
// splitting is conditional.

import type { FileRefSpanMap } from "$lib/diffview/fileRefs.ts";
import type { ColumnRange, InlineSpan, InlineSpanMap } from "$lib/diffview/inlineSpans.ts";
import { splitTokens, tokenChildren } from "$lib/diffview/rowTokens.ts";

// The inline-markup attributes that ride in the `data-md` token list, which is
// emitted in this array's order. A token list rather than an attribute per member so CSS
// reaches one with `[data-md~="bold"]` and a new decoration costs one rule, not a
// new attribute name. `checkbox`, `quoteMarker` and `listMarker` carry values, so
// they stay their own valued attributes.
const MEMBERS = ["bold", "italic", "code", "link"] as const;

type Member = (typeof MEMBERS)[number];

// data-quote-depth is the odd one out and deliberately so: every other entry tags
// a TOKEN with the markup covering it, while the depth tags the ROW, because
// subduing a quote is a whole-line property (EXC-863) and a per-token copy of it
// would be the same number written once per child. It keeps the row-level naming
// the sheet already uses for row state (data-code-line, data-caret-cursor) rather
// than joining the token-level data-md- family. It rides this list all the same,
// so the stale sweep below drops it on a populated -> empty repaint.
const ATTRS = [
  "data-md",
  "data-md-start",
  "data-md-end",
  "data-md-inner",
  "data-md-inner-start",
  "data-md-inner-end",
  "data-md-cite",
  "data-md-checkbox",
  "data-md-quote",
  "data-md-list",
  "data-quote-depth",
];

const STALE = ATTRS.map((attr) => `[${attr}]`).join(",");

/** A run's full attribute set, as a comparable string. Two abutting runs with
 * equal keys are two elements rather than one fragmented element — the
 * distinction pillGroups breaks a group on. */
function attributeKey(span: InlineSpan): string {
  return `${span.bold}|${span.italic}|${span.code}|${span.link}|${span.checkbox}|${span.quoteMarker}|${span.listMarker}`;
}

/** The column extents of `member`'s pill groups: maximal stretches of
 * consecutive runs that all carry it, abut, and differ in attribute set. */
function pillGroups(runs: readonly InlineSpan[], member: Member): ColumnRange[] {
  const groups: ColumnRange[] = [];
  let prev: InlineSpan | undefined;
  for (const run of runs) {
    if (run[member] !== undefined) {
      const open = groups.at(-1);
      if (
        open !== undefined &&
        prev !== undefined &&
        prev[member] !== undefined &&
        prev.endCol === run.startCol &&
        attributeKey(prev) !== attributeKey(run)
      ) {
        open.endCol = run.endCol;
      } else {
        groups.push({ startCol: run.startCol, endCol: run.endCol });
      }
    }
    prev = run;
  }
  return groups;
}

/** A member list as its attribute value, or undefined when nothing applies. */
function list(members: readonly Member[]): string | undefined {
  return members.length > 0 ? members.join(" ") : undefined;
}

/** Sets `attr` when there is a value, leaving it absent rather than empty. */
function setAttr(child: Element, attr: string, value: string | undefined): void {
  if (value !== undefined) child.setAttribute(attr, value);
}

/** Tags each of the row's tokens with the run covering it. After splitTokens every
 * token lies wholly inside one run or inside none, so the covering run is a lookup.
 * `cited` is the code groups that wrap a file reference — see the header. */
function tagRow(
  row: Element,
  runs: readonly InlineSpan[],
  groups: Map<Member, ColumnRange[]>,
  cited: readonly ColumnRange[],
) {
  let col = 0;
  for (const child of tokenChildren(row)) {
    const start = col;
    col += child.textContent?.length ?? 0;
    if (col === start) continue;
    const run = runs.find((r) => r.startCol <= start && col <= r.endCol);
    if (run === undefined) continue;
    const members = MEMBERS.filter((member) => run[member] !== undefined);
    const covers = (spans: readonly ColumnRange[]) =>
      spans.find((g) => g.startCol <= start && col <= g.endCol);
    const group = new Map(members.map((m) => [m, covers(groups.get(m) ?? [])]));
    const span = (m: Member) => {
      const g = group.get(m);
      return g === undefined ? 0 : g.endCol - g.startCol;
    };
    const opens = members.filter((m) => group.get(m)?.startCol === start);
    const closes = members.filter((m) => group.get(m)?.endCol === col);
    // NESTING is a comparison of extents, and on one child it is that simple: the
    // members here are nested in each other by construction (markdown cannot
    // interleave them), so the widest group is the enclosing pill and every
    // narrower one sits inside it. Equal extents are not nesting — two members
    // covering the same span are one pill wearing two washes, and both cap.
    const widest = Math.max(0, ...members.map(span));
    const inner = members.filter((m) => span(m) < widest);
    setAttr(child, "data-md", list(members));
    // A cap lands only where EVERY member the child carries opens (or closes) —
    // see the header's rounded-ends note. An inner member capping on its own would
    // notch the pill still running through the same element, because border-radius
    // is one geometric property of the box and clips all of its background layers.
    // Its own corners come from the inner caps below, which the sheet spends on a
    // pseudo-element rather than on this box.
    setAttr(child, "data-md-start", opens.length === members.length ? list(opens) : undefined);
    setAttr(child, "data-md-end", closes.length === members.length ? list(closes) : undefined);
    setAttr(child, "data-md-inner", list(inner));
    if (inner.length > 0) {
      setAttr(child, "data-md-inner-start", inner.every((m) => opens.includes(m)) ? "" : undefined);
      setAttr(child, "data-md-inner-end", inner.every((m) => closes.includes(m)) ? "" : undefined);
    }
    setAttr(child, "data-md-cite", covers(cited) === undefined ? undefined : "");
    setAttr(child, "data-md-checkbox", run.checkbox);
    setAttr(child, "data-md-list", run.listMarker);
    setAttr(
      child,
      "data-md-quote",
      run.quoteMarker === undefined ? undefined : String(run.quoteMarker),
    );
  }
}

/**
 * Splits each rendered row's shiki tokens so none straddles an inline-run or
 * file-reference boundary, then tags every token with the markup covering it:
 * `data-md` (a `bold italic code link` token list), `data-md-start` /
 * `data-md-end` for the members whose pill opens or closes there, and the valued
 * `data-md-checkbox` / `data-md-quote` / `data-md-list`. Stale tags are cleared
 * first, so a populated→empty transition drops the old ones. `root` is the source
 * view's shadow root (or any container holding the `[data-content] [data-line]`
 * rows). Idempotent and safe to call on every repaint.
 *
 * Rows are visited for every line either map names: a prose-labelled reference
 * produces a file-reference span but no inline run at all (links.ts emits no
 * link range for a label that already resolved to a reference), and that line
 * still needs its cut.
 *
 * `quoteDepth` is the per-line blockquote nesting depth (links.ts), written to
 * the ROW as data-quote-depth. It defaults to empty so the pass still runs for a
 * view with no quote layer; the one production caller always supplies it.
 */
export function decorateInlineRuns(
  root: ParentNode,
  spans: InlineSpanMap,
  refs: FileRefSpanMap,
  quoteDepth: ReadonlyMap<number, number> = new Map(),
): void {
  for (const stale of root.querySelectorAll(STALE)) {
    for (const attr of ATTRS) stale.removeAttribute(attr);
  }
  // Index the rows once and read the line number off each, rather than a
  // querySelector per marked line. Unlike the file-reference and link maps — a
  // handful of entries per plan — this map is DENSE: links.ts records a line for
  // any emphasis, inline code, link, checkbox or quote marker, so it names most
  // of a prose document, and a per-line lookup would walk the whole subtree
  // hundreds of times on every repaint. Descendant, not child: an overflowing
  // code block's rows get moved into a scroll card (codeBlockScroll.ts) and a
  // table's rows into a table card (tables.ts), so either way they are no longer
  // direct children of [data-content]. Same shape as tagCodeBlockRows.
  const rows = new Map<number, Element>();
  for (const row of root.querySelectorAll("[data-content] [data-line]")) {
    const line = Number(row.getAttribute("data-line"));
    if (Number.isFinite(line)) rows.set(line, row);
  }
  // spans and refs only: a quoted line is always in spans, because its depth is
  // counted from marker intervals that each become a run (inlineSpans.ts pins that
  // implication). Unioning quoteDepth in as well would add a key set that is
  // provably a subset — and a branch no repaint can reach is a branch nobody can
  // test honestly.
  for (const line of new Set([...spans.keys(), ...refs.keys()])) {
    const row = rows.get(line);
    if (row === undefined) continue;
    setAttr(row, "data-quote-depth", quoteDepth.get(line)?.toString());
    const runs = spans.get(line) ?? [];
    const cuts = new Set<number>();
    for (const run of runs) {
      cuts.add(run.startCol);
      cuts.add(run.endCol);
    }
    for (const ref of refs.get(line) ?? []) {
      cuts.add(ref.startCol);
      cuts.add(ref.endCol);
    }
    splitTokens(
      row,
      [...cuts].sort((a, b) => a - b),
    );
    const groups = new Map(MEMBERS.map((member) => [member, pillGroups(runs, member)]));
    // The code groups that WRAP a reference rather than merely touching one, so a
    // path cited in backticks reads as one reference chip end to end.
    const cited = (groups.get("code") ?? []).filter((g) =>
      (refs.get(line) ?? []).some((r) => g.startCol <= r.startCol && r.endCol <= g.endCol),
    );
    tagRow(row, runs, groups, cited);
  }
}

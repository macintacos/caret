// Turns the flat inline runs (inlineSpans.ts) into decorable DOM for the plan
// view (EXC-867). shiki paints each row as a sequence of classless token spans
// whose text concatenates to the line; this pass makes that sequence FINER until
// no token straddles a run boundary, then tags each token with the run covering
// it. Everything downstream — the emphasis ink, the pills, the checkbox and
// blockquote decorations — is then one CSS rule against an attribute.
//
// It SPLITS ONLY, and never merges. Merging would be the obvious way to make one
// element out of one run, and it is wrong twice over: shiki colours `**`, `bold`
// and `**` as three different tokens, so fusing them throws away the marker ink
// the theme deliberately dims; and tagTokenAt (fileRefTag.ts), tagLanguageToken
// and tagFenceToken (codeBlocks.ts) all locate a token by walking direct
// children and accumulating text length, so a coarser partition can hide the
// boundary they need. Splitting only ever refines, so every boundary shiki drew
// survives and every column those walkers look for is still a child boundary.
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
// reference, which shiki emits as one coarse run, take the glyph at all (the
// upgrade path the `ponytail:` note in links.ts points here for).
//
// Those cuts feed the cut set ONLY, never the grouping above. A reference cut
// inside a codespan would otherwise split it into three runs and three pills
// instead of one — a bug the inline-code chip (EXC-868) would inherit.
//
// Idempotency is a hard requirement, not a nicety: SourceView.svelte runs this
// from a MutationObserver watching childList over the whole subtree, so a pass
// that re-splits a settled row would loop forever. An already-correct child has
// no cut strictly inside it and is left completely untouched, the same way
// syncCodeBlockCards leaves a settled block alone. Attribute writes are free —
// the observer does not watch attributes — so only node splitting is conditional.

import type { FileRefSpanMap } from "$lib/diffview/fileRefs.ts";
import type { ColumnRange, InlineSpan, InlineSpanMap } from "$lib/diffview/inlineSpans.ts";

// The inline-markup attributes that ride in the `data-md` token list, in the
// order they are listed. A token list rather than an attribute per member so CSS
// reaches one with `[data-md~="bold"]` and a new decoration costs one rule, not a
// new attribute name. `checkbox` and `quoteMarker` carry values, so they stay
// their own valued attributes.
const MEMBERS = ["bold", "italic", "code", "link"] as const;

type Member = (typeof MEMBERS)[number];

const ATTRS = ["data-md", "data-md-start", "data-md-end", "data-md-checkbox", "data-md-quote"];

const STALE = ATTRS.map((attr) => `[${attr}]`).join(",");

/** A run's full attribute set, as a comparable string. Two abutting runs with
 * equal keys are two elements rather than one fragmented element — the
 * distinction pillGroups breaks a group on. */
function attributeKey(span: InlineSpan): string {
  return `${span.bold}|${span.italic}|${span.code}|${span.link}|${span.checkbox}|${span.quoteMarker}`;
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

/** Replaces every direct child a cut falls strictly inside with one clone per
 * piece, so no child straddles a boundary. A child with no interior cut is left
 * as-is — the idempotency guarantee. A child holding elements of its own is
 * skipped defensively; a shiki token holds a single text node. */
function splitRow(row: Element, cuts: number[]): void {
  let col = 0;
  for (const child of [...row.children]) {
    const text = child.textContent ?? "";
    const end = col + text.length;
    const inside = cuts.filter((cut) => cut > col && cut < end);
    if (inside.length > 0 && child.childElementCount === 0) {
      const bounds = [col, ...inside, end];
      child.replaceWith(
        ...bounds.slice(0, -1).map((from, i) => {
          // cloneNode(false) carries the token's inline style and attributes, so
          // the pieces are indistinguishable from the token they replace.
          const piece = child.cloneNode(false) as Element;
          piece.textContent = text.slice(from - col, (bounds[i + 1] ?? end) - col);
          return piece;
        }),
      );
    }
    col = end;
  }
}

/** Tags each direct child with the run covering it. After splitRow every child
 * lies wholly inside one run or inside none, so the covering run is a lookup. */
function tagRow(row: Element, runs: readonly InlineSpan[], groups: Map<Member, ColumnRange[]>) {
  let col = 0;
  for (const child of row.children) {
    const start = col;
    col += child.textContent?.length ?? 0;
    if (col === start) continue;
    const run = runs.find((r) => r.startCol <= start && col <= r.endCol);
    if (run === undefined) continue;
    const list = (members: Member[]) => (members.length > 0 ? members.join(" ") : undefined);
    const set = (attr: string, value: string | undefined) => {
      if (value !== undefined) child.setAttribute(attr, value);
    };
    set("data-md", list(MEMBERS.filter((member) => run[member] !== undefined)));
    set(
      "data-md-start",
      list(MEMBERS.filter((m) => (groups.get(m) ?? []).some((g) => g.startCol === start))),
    );
    set(
      "data-md-end",
      list(MEMBERS.filter((m) => (groups.get(m) ?? []).some((g) => g.endCol === col))),
    );
    set("data-md-checkbox", run.checkbox);
    set("data-md-quote", run.quoteMarker === undefined ? undefined : String(run.quoteMarker));
  }
}

/**
 * Splits each rendered row's shiki tokens so none straddles an inline-run or
 * file-reference boundary, then tags every token with the markup covering it:
 * `data-md` (a `bold italic code link` token list), `data-md-start` /
 * `data-md-end` for the members whose pill opens or closes there, and the valued
 * `data-md-checkbox` / `data-md-quote`. Stale tags are cleared first, so a
 * populated→empty transition drops the old ones. `root` is the source view's
 * shadow root (or any container holding the `[data-content] [data-line]` rows).
 * Idempotent and safe to call on every repaint.
 *
 * Rows are visited for every line either map names: a prose-labelled reference
 * produces a file-reference span but no inline run at all (links.ts emits no
 * link range for a label that already resolved to a reference), and that line
 * still needs its cut.
 */
export function decorateInlineRuns(
  root: ParentNode,
  spans: InlineSpanMap,
  refs: FileRefSpanMap,
): void {
  for (const stale of root.querySelectorAll(STALE)) {
    for (const attr of ATTRS) stale.removeAttribute(attr);
  }
  for (const line of new Set([...spans.keys(), ...refs.keys()])) {
    // Descendant, not child: an overflowing code block's rows get moved into a
    // scroll card (codeBlockScroll.ts), so they are no longer direct children of
    // [data-content]. The same query tagCodeBlockRows uses finds them wherever
    // they sit.
    const row = root.querySelector(`[data-content] [data-line="${line}"]`);
    if (row === null) continue;
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
    splitRow(
      row,
      [...cuts].sort((a, b) => a - b),
    );
    tagRow(row, runs, new Map(MEMBERS.map((member) => [member, pillGroups(runs, member)])));
  }
}

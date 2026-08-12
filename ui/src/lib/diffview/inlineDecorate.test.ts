import "@ui/test-setup.ts";
import { beforeEach, expect, test } from "bun:test";

import type { FileRefSpan, FileRefSpanMap } from "$lib/diffview/fileRefs.ts";
import { tagFileRefTokens } from "$lib/diffview/fileRefTag.ts";
import { decorateInlineRuns } from "$lib/diffview/inlineDecorate.ts";
import type { InlineSpan, InlineSpanMap } from "$lib/diffview/inlineSpans.ts";

// decorateInlineRuns splits a row's shiki tokens at every inline-run boundary
// and tags each resulting child with the run covering it, so the override sheet
// can draw the markdown pills. The token structure (shiki spans whose text
// concatenates to the line) only exists in a real browser, so this is exercised
// with a hand-built stand-in DOM; the live shadow-root behavior is covered by e2e.

function row(line: number, tokens: string[]): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-line", String(line));
  for (const t of tokens) {
    const span = document.createElement("span");
    span.textContent = t;
    el.appendChild(span);
  }
  return el;
}

function root(...rows: HTMLElement[]): HTMLElement {
  const host = document.createElement("div");
  const content = document.createElement("div");
  content.setAttribute("data-content", "");
  for (const r of rows) content.appendChild(r);
  host.appendChild(content);
  return host;
}

function spanMap(entries: [number, InlineSpan[]][]): InlineSpanMap {
  return new Map(entries);
}

function refMap(entries: [number, FileRefSpan[]][]): FileRefSpanMap {
  return new Map(entries);
}

/** One record per direct child of a row: its text plus the three token-list
 * attributes, so a whole decorated row is asserted in a single toEqual. */
function pieces(
  host: HTMLElement,
  line = 1,
): { text: string; md: string | null; start: string | null; end: string | null }[] {
  const rowEl = host.querySelector(`[data-line="${line}"]`);
  return [...(rowEl?.children ?? [])].map((child) => ({
    text: child.textContent ?? "",
    md: child.getAttribute("data-md"),
    start: child.getAttribute("data-md-start"),
    end: child.getAttribute("data-md-end"),
  }));
}

/** One record per direct child of a row: its text plus the nested-member tags —
 * the `pieces` shape for the inner pill the sheet draws on a pseudo-element. */
function nested(
  host: HTMLElement,
  line = 1,
): { text: string; inner: string | null; start: boolean; end: boolean }[] {
  const rowEl = host.querySelector(`[data-line="${line}"]`);
  return [...(rowEl?.children ?? [])].map((child) => ({
    text: child.textContent ?? "",
    inner: child.getAttribute("data-md-inner"),
    start: child.hasAttribute("data-md-inner-start"),
    end: child.hasAttribute("data-md-inner-end"),
  }));
}

/** One record per direct child of a row: its text plus whether it belongs to a
 * codespan the pass found a file reference inside. */
function cited(host: HTMLElement, line = 1): { text: string; cite: boolean }[] {
  const rowEl = host.querySelector(`[data-line="${line}"]`);
  return [...(rowEl?.children ?? [])].map((child) => ({
    text: child.textContent ?? "",
    cite: child.hasAttribute("data-md-cite"),
  }));
}

/** One record per direct child of a row: its text plus the list-marker value —
 * the `pieces` shape for the valued attribute rather than the token lists. */
function markers(host: HTMLElement, line = 1): { text: string; list: string | null }[] {
  const rowEl = host.querySelector(`[data-line="${line}"]`);
  return [...(rowEl?.children ?? [])].map((child) => ({
    text: child.textContent ?? "",
    list: child.getAttribute("data-md-list"),
  }));
}

function fileRefs(host: HTMLElement): string[] {
  return [...host.querySelectorAll("[data-file-ref]")].map((el) => el.textContent ?? "");
}

let host: HTMLElement;
beforeEach(() => {
  document.body.replaceChildren();
});

test("tags every token of a bold element, with the pill ends on the outer two", () => {
  // `**x**` as the three tokens shiki emits — the markers are coloured
  // differently from the text, so they are separate tokens. Every token carries
  // the member; only the outer two carry the pill's rounded ends.
  host = root(row(1, ["**", "x", "**"]));
  decorateInlineRuns(host, spanMap([[1, [{ startCol: 0, endCol: 5, bold: true }]]]), new Map());
  expect(pieces(host)).toEqual([
    { text: "**", md: "bold", start: "bold", end: null },
    { text: "x", md: "bold", start: null, end: null },
    { text: "**", md: "bold", start: null, end: "bold" },
  ]);
});

test("splits a coarse token that straddles a run boundary, cloning its ink", () => {
  host = root(row(1, ["**a**b"]));
  const token = host.querySelector("[data-line] > span");
  token?.setAttribute("style", "color:#f00");
  decorateInlineRuns(host, spanMap([[1, [{ startCol: 0, endCol: 5, bold: true }]]]), new Map());
  expect(pieces(host)).toEqual([
    { text: "**a**", md: "bold", start: "bold", end: "bold" },
    { text: "b", md: null, start: null, end: null },
  ]);
  // cloneNode(false) carries the token's inline style onto both halves, so the
  // split is invisible to the reader.
  expect(
    [...(host.querySelector("[data-line]")?.children ?? [])].map((c) => c.getAttribute("style")),
  ).toEqual(["color:#f00", "color:#f00"]);
});

test("two abutting runs with identical attributes draw two pills", () => {
  // `*a*_b_`. inlineSpans deliberately does not fuse abutting elements, so an
  // identical attribute set on two adjacent runs means two elements — and two
  // pills. Fusing them here would erase the boundary between them.
  host = root(row(1, ["*a*", "_b_"]));
  decorateInlineRuns(
    host,
    spanMap([
      [
        1,
        [
          { startCol: 0, endCol: 3, italic: true },
          { startCol: 3, endCol: 6, italic: true },
        ],
      ],
    ]),
    new Map(),
  );
  expect(pieces(host)).toEqual([
    { text: "*a*", md: "italic", start: "italic", end: "italic" },
    { text: "_b_", md: "italic", start: "italic", end: "italic" },
  ]);
});

test("one element fragmented by a nested element draws a single pill", () => {
  // ``**a `c` b**`` — three runs, one bold ELEMENT. Their attribute sets differ,
  // so the bold group spans all three and the pill opens once and closes once.
  //
  // The nested code run takes NO cap, even though its own group both opens and
  // closes on it. border-radius is one geometric property of the box and clips
  // every background layer on it, so capping there would round the bold tint too
  // and punch a notch through the middle of the bold pill. A cap lands only where
  // every member the child carries ends, which is why the outermost pill wins.
  host = root(row(1, ["**a", "`c`", "b**"]));
  decorateInlineRuns(
    host,
    spanMap([
      [
        1,
        [
          { startCol: 0, endCol: 3, bold: true },
          { startCol: 3, endCol: 6, bold: true, code: true },
          { startCol: 6, endCol: 9, bold: true },
        ],
      ],
    ]),
    new Map(),
  );
  expect(pieces(host)).toEqual([
    { text: "**a", md: "bold", start: "bold", end: null },
    { text: "`c`", md: "bold code", start: null, end: null },
    { text: "b**", md: "bold", start: null, end: "bold" },
  ]);
});

test("names the nested member and caps its own pill", () => {
  // The same ``**a `c` b**``, read for the inner pill rather than the outer one. The code
  // group is narrower than the bold group running through the same child, so code is the
  // NESTED member — and its ends are the ones the sheet rounds on a pseudo-element, since
  // the child's own radius belongs to the bold pill still passing through it.
  host = root(row(1, ["**a", "`c`", "b**"]));
  decorateInlineRuns(
    host,
    spanMap([
      [
        1,
        [
          { startCol: 0, endCol: 3, bold: true },
          { startCol: 3, endCol: 6, bold: true, code: true },
          { startCol: 6, endCol: 9, bold: true },
        ],
      ],
    ]),
    new Map(),
  );
  expect(nested(host)).toEqual([
    { text: "**a", inner: null, start: false, end: false },
    { text: "`c`", inner: "code", start: true, end: true },
    { text: "b**", inner: null, start: false, end: false },
  ]);
});

test("closes a fragmented inner pill once, at its outer ends", () => {
  // ``**a `c` b**`` again, with shiki cutting the codespan at its backticks — which it
  // really does on a row carrying other markup. All three fragments carry the nested
  // member; only the outer two cap, or the inner pill would pinch at every seam, which is
  // the same rule the outer pill follows one level up.
  host = root(row(1, ["**a", "`", "c", "`", "b**"]));
  decorateInlineRuns(
    host,
    spanMap([
      [
        1,
        [
          { startCol: 0, endCol: 3, bold: true },
          { startCol: 3, endCol: 6, bold: true, code: true },
          { startCol: 6, endCol: 9, bold: true },
        ],
      ],
    ]),
    new Map(),
  );
  expect(nested(host)).toEqual([
    { text: "**a", inner: null, start: false, end: false },
    { text: "`", inner: "code", start: true, end: false },
    { text: "c", inner: "code", start: false, end: false },
    { text: "`", inner: "code", start: false, end: true },
    { text: "b**", inner: null, start: false, end: false },
  ]);
});

test("two members over the same span are one pill, not a nested pair", () => {
  // `***x***` reaching the pass as a single run carrying both members: their groups have
  // the same extent, so neither is inside the other and neither moves to the pseudo — the
  // child caps normally and the two washes composite over one shape.
  host = root(row(1, ["***x***"]));
  decorateInlineRuns(
    host,
    spanMap([[1, [{ startCol: 0, endCol: 7, bold: true, italic: true }]]]),
    new Map(),
  );
  expect(nested(host)).toEqual([{ text: "***x***", inner: null, start: false, end: false }]);
});

test("a nested element's own group still caps once it is alone on the child", () => {
  // The same code run, this time NOT inside anything: `x` then plain prose. Its
  // group is the only member on the child, so "every member ends here" is just
  // itself and the pill caps normally. This is the other half of the rule above —
  // the suppression is about nesting, not about inner members never capping.
  host = root(row(1, ["`x`", " after"]));
  decorateInlineRuns(host, spanMap([[1, [{ startCol: 0, endCol: 3, code: true }]]]), new Map());
  expect(pieces(host)).toEqual([
    { text: "`x`", md: "code", start: "code", end: "code" },
    { text: " after", md: null, start: null, end: null },
  ]);
});

test("a run carrying two members lists both", () => {
  host = root(row(1, ["***x***"]));
  decorateInlineRuns(
    host,
    spanMap([[1, [{ startCol: 0, endCol: 7, bold: true, italic: true }]]]),
    new Map(),
  );
  expect(pieces(host)).toEqual([
    { text: "***x***", md: "bold italic", start: "bold italic", end: "bold italic" },
  ]);
});

test("carries the checkbox and quote-marker values on their own runs", () => {
  host = root(row(1, ["> ", "- ", "[x]", " done"]));
  decorateInlineRuns(
    host,
    spanMap([
      [
        1,
        [
          { startCol: 0, endCol: 1, quoteMarker: 1 },
          { startCol: 4, endCol: 7, checkbox: "checked" },
        ],
      ],
    ]),
    new Map(),
  );
  const row1 = host.querySelector("[data-line]");
  expect([...(row1?.children ?? [])].map((c) => c.getAttribute("data-md-quote"))).toEqual([
    "1",
    null,
    null,
    null,
    null,
  ]);
  expect([...(row1?.children ?? [])].map((c) => c.getAttribute("data-md-checkbox"))).toEqual([
    null,
    null,
    null,
    "checked",
    null,
  ]);
  // Neither is an inline-markup member, so neither run gets a data-md list.
  expect(host.querySelectorAll("[data-md]").length).toBe(0);
});

test("carries the list-marker kind on the marker run alone", () => {
  // EXC-861. The marker run covers the `-` and not the space after it, so the
  // coarse token shiki paints has to be cut — which is the same split every other
  // run here relies on, and what keeps the glyph over one character cell.
  host = root(row(1, ["  ", "- ", "item"]));
  decorateInlineRuns(
    host,
    spanMap([[1, [{ startCol: 2, endCol: 3, listMarker: "bullet" }]]]),
    new Map(),
  );
  expect(markers(host)).toEqual([
    { text: "  ", list: null },
    { text: "-", list: "bullet" },
    { text: " ", list: null },
    { text: "item", list: null },
  ]);
  // A marker is not an inline-markup member, so it takes no data-md token list
  // and none of the chip layers.
  expect(host.querySelectorAll("[data-md]").length).toBe(0);
});

test("a task item's marker and its checkbox each carry their own value", () => {
  // The pair EXC-860 builds on: one treatment per row, decided in the emission
  // (the marker is `task`, never `bullet`) and readable here as two attributes on
  // two different children.
  host = root(row(1, ["- ", "[x]", " done"]));
  decorateInlineRuns(
    host,
    spanMap([
      [
        1,
        [
          { startCol: 0, endCol: 1, listMarker: "task" },
          { startCol: 2, endCol: 5, checkbox: "checked" },
        ],
      ],
    ]),
    new Map(),
  );
  const rowEl = host.querySelector("[data-line]");
  expect(markers(host).map((m) => m.list)).toEqual(["task", null, null, null]);
  expect([...(rowEl?.children ?? [])].map((c) => c.getAttribute("data-md-checkbox"))).toEqual([
    null,
    null,
    "checked",
    null,
  ]);
});

test("drops a stale list marker when the line stops carrying one", () => {
  host = root(row(1, ["- ", "item"]));
  decorateInlineRuns(
    host,
    spanMap([[1, [{ startCol: 0, endCol: 1, listMarker: "bullet" }]]]),
    new Map(),
  );
  expect(markers(host).map((m) => m.list)).toEqual(["bullet", null, null]);
  decorateInlineRuns(host, new Map(), new Map());
  expect(markers(host).map((m) => m.list)).toEqual([null, null, null]);
});

test("cuts a codespan at its file reference without splitting the code pill", () => {
  // The citation shape: `` [`foo/bar.ts`](foo/bar.ts) `` collapses to the display
  // text `` `foo/bar.ts` ``. The codespan run covers the backticks at [0,12) while
  // the merged reference sits inside them at [1,11) — two partitions that
  // interleave. The reference's columns join the CUT set only, so the child
  // tagTokenAt needs exists by construction while the code group stays one pill.
  const refs = refMap([[1, [{ startCol: 1, endCol: 11, path: "foo/bar.ts" }]]]);
  host = root(row(1, ["`foo/bar.ts`"]));
  decorateInlineRuns(host, spanMap([[1, [{ startCol: 0, endCol: 12, code: true }]]]), refs);
  expect(pieces(host)).toEqual([
    { text: "`", md: "code", start: "code", end: null },
    { text: "foo/bar.ts", md: "code", start: null, end: null },
    { text: "`", md: "code", start: null, end: "code" },
  ]);
  // End to end: the real tagger now finds a child that begins at the reference's
  // start and ends inside it, so the glyph lands on the filename.
  tagFileRefTokens(host, refs);
  expect(fileRefs(host)).toEqual(["foo/bar.ts"]);
  // Every token of that codespan is marked, backticks included, because the pill is one
  // REFERENCE chip rather than a code chip with a reference inside it — the sheet rebinds
  // the group's tint off this attribute so it does not change colour at the backticks.
  // This three-token shape is also what the sheet's hover spread selects through: with no
  // element around the group, it reaches the backticks as the reference's two ADJACENT
  // siblings, so a tokenization that put anything between them would strand the wash.
  expect(cited(host)).toEqual([
    { text: "`", cite: true },
    { text: "foo/bar.ts", cite: true },
    { text: "`", cite: true },
  ]);
});

test("leaves a codespan that merely abuts a reference uncited", () => {
  // `` `x` `` then a bare path: the reference sits outside the code group rather than
  // inside it, so the codespan keeps its own tint. Containment is the test, not proximity
  // — a row citing one path and quoting an unrelated symbol must render two colours.
  const refs = refMap([[1, [{ startCol: 4, endCol: 14, path: "foo/bar.ts" }]]]);
  host = root(row(1, ["`x`", " foo/bar.ts"]));
  decorateInlineRuns(host, spanMap([[1, [{ startCol: 0, endCol: 3, code: true }]]]), refs);
  expect(cited(host)).toEqual([
    { text: "`x`", cite: false },
    { text: " ", cite: false },
    { text: "foo/bar.ts", cite: false },
  ]);
});

test("a link label wrapping a codespan still draws one continuous link pill", () => {
  // `` [`foo` bar](https://x.test) `` collapses to the display text `` `foo` bar ``, which
  // is two runs: the codespan carries `code link` and the tail carries `link` alone. The
  // link chip (EXC-859) must close ONCE across both — the same property the file-reference
  // cut preserves for the code pill above, seen from the other member's side. So the cap
  // lands only where every member on the child opens or closes: `code` ending at column 5
  // does not close the link running through it.
  host = root(row(1, ["`foo` bar"]));
  decorateInlineRuns(
    host,
    spanMap([
      [
        1,
        [
          { startCol: 0, endCol: 5, code: true, link: true },
          { startCol: 5, endCol: 9, link: true },
        ],
      ],
    ]),
    new Map(),
  );
  expect(pieces(host)).toEqual([
    { text: "`foo`", md: "code link", start: "code link", end: null },
    { text: " bar", md: "link", start: null, end: "link" },
  ]);
});

test("splits a prose-labelled reference out of its coarse token", () => {
  // A collapsed `[the config](config/app.ts)` label is plain prose, so shiki
  // emits the whole line as one token and tagFileRefTokens refuses it (it would
  // chip the whole sentence). The line carries no inline run at all — links.ts
  // emits no link range for a label that produced a reference — so the cut has to
  // come from the reference map alone.
  const refs = refMap([
    [1, [{ startCol: 4, endCol: 14, path: "config/app.ts", target: "config/app.ts" }]],
  ]);
  host = root(row(1, ["see the config here"]));
  decorateInlineRuns(host, new Map(), refs);
  expect(pieces(host).map((p) => p.text)).toEqual(["see ", "the config", " here"]);
  expect(host.querySelectorAll("[data-md]").length).toBe(0);
  tagFileRefTokens(host, refs);
  expect(fileRefs(host)).toEqual(["the config"]);
});

test("decorates a row that a scroll card re-parented", () => {
  // An overflowing code block's rows are moved into a scroll card, so they are no
  // longer direct children of [data-content] — the same descendant query
  // tagCodeBlockRows uses finds them wherever they sit.
  host = root();
  const card = document.createElement("div");
  card.appendChild(row(1, ["**x**"]));
  host.querySelector("[data-content]")?.appendChild(card);
  decorateInlineRuns(host, spanMap([[1, [{ startCol: 0, endCol: 5, bold: true }]]]), new Map());
  expect(pieces(host)).toEqual([{ text: "**x**", md: "bold", start: "bold", end: "bold" }]);
});

test("a second pass over a settled row mutates no nodes", () => {
  // SourceView runs this inside a childList MutationObserver, so a pass that
  // re-splits an already-correct row would loop forever. Attribute writes are
  // free — the observer does not watch them — so only splitting is conditional.
  const spans = spanMap([[1, [{ startCol: 0, endCol: 12, code: true }]]]);
  const refs = refMap([[1, [{ startCol: 1, endCol: 11, path: "foo/bar.ts" }]]]);
  host = root(row(1, ["`foo/bar.ts`"]));
  decorateInlineRuns(host, spans, refs);
  const observer = new MutationObserver(() => {});
  observer.observe(host, { childList: true, subtree: true });
  decorateInlineRuns(host, spans, refs);
  expect(observer.takeRecords()).toEqual([]);
  observer.disconnect();
});

test("is a no-op for a line whose row is not rendered", () => {
  host = root(row(1, ["only here"]));
  expect(() =>
    decorateInlineRuns(host, spanMap([[9, [{ startCol: 0, endCol: 4, bold: true }]]]), new Map()),
  ).not.toThrow();
  expect(host.querySelectorAll("[data-md]").length).toBe(0);
});

test("clears stale tags before applying the new set", () => {
  host = root(row(1, ["**a**", "b"]));
  decorateInlineRuns(host, spanMap([[1, [{ startCol: 0, endCol: 5, bold: true }]]]), new Map());
  expect(pieces(host)).toEqual([
    { text: "**a**", md: "bold", start: "bold", end: "bold" },
    { text: "b", md: null, start: null, end: null },
  ]);
  // A repaint whose map no longer marks the line must drop the prior tags.
  decorateInlineRuns(host, new Map(), new Map());
  expect(pieces(host)).toEqual([
    { text: "**a**", md: null, start: null, end: null },
    { text: "b", md: null, start: null, end: null },
  ]);
});

test("moves the tags when the same line's runs change", () => {
  host = root(row(1, ["*a*", "*b*"]));
  decorateInlineRuns(host, spanMap([[1, [{ startCol: 0, endCol: 3, italic: true }]]]), new Map());
  expect(pieces(host).map((p) => p.md)).toEqual(["italic", null]);
  decorateInlineRuns(host, spanMap([[1, [{ startCol: 3, endCol: 6, code: true }]]]), new Map());
  expect(pieces(host).map((p) => p.md)).toEqual([null, "code"]);
});

// EXC-863: the whole-line half of the quote seam. Subduing a quote is a property
// of the ROW rather than of any run on it, so the depth lands on the row element
// and the sheet reaches every token on the line through one descendant selector.
function depths(host: HTMLElement): (string | null)[] {
  return [...host.querySelectorAll("[data-line]")].map((r) => r.getAttribute("data-quote-depth"));
}

test("tags each quoted row with its own depth", () => {
  host = root(row(1, ["> ", "one"]), row(2, ["> > ", "two"]), row(3, ["plain"]));
  decorateInlineRuns(
    host,
    spanMap([
      [1, [{ startCol: 0, endCol: 1, quoteMarker: 1 }]],
      [
        2,
        [
          { startCol: 0, endCol: 1, quoteMarker: 1 },
          { startCol: 2, endCol: 3, quoteMarker: 2 },
        ],
      ],
    ]),
    new Map(),
    new Map([
      [1, 1],
      [2, 2],
    ]),
  );
  expect(depths(host)).toEqual(["1", "2", null]);
});

test("drops the depth when a repaint no longer quotes the line", () => {
  const quoted = spanMap([[1, [{ startCol: 0, endCol: 1, quoteMarker: 1 }]]]);
  host = root(row(1, ["> ", "quoted"]));
  decorateInlineRuns(host, quoted, new Map(), new Map([[1, 1]]));
  expect(depths(host)).toEqual(["1"]);
  decorateInlineRuns(host, new Map(), new Map(), new Map());
  expect(depths(host)).toEqual([null]);
});

// The mixing cases EXC-863 names, carried through to the DOM rather than stopping
// at the span layer: what has to hold for each is that every marker gets its own
// element (one bar per level), the row carries the depth (the subdue), and the
// construct inside keeps its own tags. Columns come from inlineSpans.test.ts; this
// is the half that says the decoration actually lands.
test.each([
  ["a list inside a quote", ["> ", "- ", "item"], [{ startCol: 0, endCol: 1, quoteMarker: 1 }], 1],
  [
    "a table row inside a quote",
    ["> ", "| a | ", "b", " |"],
    [{ startCol: 0, endCol: 1, quoteMarker: 1 }],
    1,
  ],
  [
    "a fence row inside a quote",
    ["> ", "```", "ts"],
    [{ startCol: 0, endCol: 1, quoteMarker: 1 }],
    1,
  ],
  [
    "a quote inside a list item",
    ["- ", "> ", "quoted"],
    [{ startCol: 2, endCol: 3, quoteMarker: 1 }],
    1,
  ],
  [
    "three levels inside a list item",
    ["- ", "> ", "> ", "> ", "deep"],
    [
      { startCol: 2, endCol: 3, quoteMarker: 1 },
      { startCol: 4, endCol: 5, quoteMarker: 2 },
      { startCol: 6, endCol: 7, quoteMarker: 3 },
    ],
    3,
  ],
])("draws one marker element per level for %s", (_name, tokens, runs, depth) => {
  host = root(row(1, tokens as string[]));
  decorateInlineRuns(
    host,
    spanMap([[1, runs as InlineSpan[]]]),
    new Map(),
    new Map([[1, depth as number]]),
  );
  const rowEl = host.querySelector('[data-line="1"]') as Element;
  expect(rowEl.getAttribute("data-quote-depth")).toBe(String(depth));
  expect(
    [...rowEl.querySelectorAll("[data-md-quote]")].map((m) => m.getAttribute("data-md-quote")),
  ).toEqual((runs as InlineSpan[]).map((r) => String(r.quoteMarker)));
  // Each marker element holds exactly the one character the bar is drawn over, so
  // the bar cannot span more than its own column.
  for (const m of rowEl.querySelectorAll("[data-md-quote]")) expect(m.textContent).toBe(">");
});

test("keeps a chip's own tags on a quoted row", () => {
  // "inline affordances inside the quote keep their styling in subdued form": the
  // subdue is a row-level fade, so what has to be true here is that the chip's
  // members survive the quote entirely — nothing strips them.
  host = root(row(1, ["> ", "**", "bold", "**", " and ", "`c`"]));
  decorateInlineRuns(
    host,
    spanMap([
      [
        1,
        [
          { startCol: 0, endCol: 1, quoteMarker: 1 },
          { startCol: 2, endCol: 10, bold: true },
          { startCol: 15, endCol: 18, code: true },
        ],
      ],
    ]),
    new Map(),
    new Map([[1, 1]]),
  );
  // Seven children, not six: the leading "> " token straddles the marker run and is
  // split, which is what gives the bar an element holding exactly the marker.
  expect(pieces(host).map((p) => p.text)).toEqual([">", " ", "**", "bold", "**", " and ", "`c`"]);
  expect(pieces(host).map((p) => p.md)).toEqual([null, null, "bold", "bold", "bold", null, "code"]);
  expect(pieces(host).map((p) => p.start)).toEqual([null, null, "bold", null, null, null, "code"]);
  expect(pieces(host).map((p) => p.end)).toEqual([null, null, null, null, "bold", null, "code"]);
});

test("leaves a row named only by the reference map unquoted", () => {
  // The loop visits refs-only rows for their cut; the depth lookup simply misses,
  // so nothing is tagged. Pins that the row tag reads the depth map rather than
  // the fact that the row was visited.
  host = root(row(1, ["src/a.ts", " here"]));
  decorateInlineRuns(
    host,
    new Map(),
    refMap([[1, [{ startCol: 0, endCol: 8, path: "src/a.ts" }]]]),
    new Map(),
  );
  expect(depths(host)).toEqual([null]);
});

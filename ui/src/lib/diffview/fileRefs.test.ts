import { describe, expect, test } from "bun:test";

import {
  buildFileRefLayer,
  classify,
  type FileRefSpan,
  type FileRefSpanMap,
  mergeFileRefSpans,
  pathCandidates,
} from "$lib/diffview/fileRefs.ts";

// buildFileRefLayer is one of two detection sources for the filename-reference
// feature (EXC-687): it scans a plan's display source for path-shaped tokens
// *inside inline-code spans* and *inside parentheses* (EXC-1184), and returns
// per-line spans. The other is the link layer's emission over collapsed
// markdown-link labels (EXC-954), which mergeFileRefSpans below unions with this
// one. Everything else stays out: backticks are an author signalling "this is a
// path", a parenthesis carrying one space-free separator-bearing run is a
// citation, and the rest of prose is ordinary words. Shape is only a plausibility
// floor — the filesystem, not the
// parser, decides what a token is (EXC-916) — so a bare word, a directory, and a
// dotfile are all offered to the daemon, and only a token with no letter in its
// last segment ("3.14", "42") is refused outright. Columns index the display line
// so they line up with the rendered tokens; line numbers are 1-based.

function only(text: string): FileRefSpan[] {
  const map = buildFileRefLayer(text);
  expect(map.size).toBeLessThanOrEqual(1);
  return map.get(1) ?? [];
}

function spanFor(text: string, needle: string): FileRefSpan | undefined {
  return only(text).find((s) => text.slice(s.startCol, s.endCol) === needle);
}

describe("detection (inside inline code)", () => {
  test("detects a bare filename with a known extension", () => {
    const s = spanFor("See `foo.ts` here", "foo.ts");
    expect(s).toBeDefined();
    expect(s?.path).toBe("foo.ts");
    expect(s?.line).toBeUndefined();
  });

  test("detects a path with directory separators", () => {
    const s = spanFor("edit `ui/src/lib/api.ts` today", "ui/src/lib/api.ts");
    expect(s?.path).toBe("ui/src/lib/api.ts");
  });

  test("parses a trailing :line into a line number, covering it in the span", () => {
    const s = spanFor("look at `foo.ts:29` now", "foo.ts:29");
    expect(s?.path).toBe("foo.ts");
    expect(s?.line).toBe(29);
  });

  test("parses a :line:col suffix, keeping the line", () => {
    const s = spanFor("at `src/x.ts:29:5` there", "src/x.ts:29:5");
    expect(s?.path).toBe("src/x.ts");
    expect(s?.line).toBe(29);
    // A column is not a range end — the second number is where the reference
    // sits on line 29, not a ninth line to frame.
    expect(s?.endLine).toBeUndefined();
  });

  test("parses a :start-end range, covering the whole run in the span", () => {
    // The span is the click target, so the end-line tail has to be inside it —
    // a reader clicking `-162` is clicking the reference they can see.
    const s = spanFor("read `doc/DEVELOPMENT.md:154-162` first", "doc/DEVELOPMENT.md:154-162");
    expect(s?.path).toBe("doc/DEVELOPMENT.md");
    expect(s?.line).toBe(154);
    expect(s?.endLine).toBe(162);
  });

  test.each([
    ["en dash", "doc/DEVELOPMENT.md:154–162"],
    ["comma", "doc/DEVELOPMENT.md:154,162"],
    ["L-prefixed", "doc/DEVELOPMENT.md:L154-L162"],
    ["hash L-prefixed", "doc/DEVELOPMENT.md#L154-L162"],
    ["hash after colon", "doc/DEVELOPMENT.md:#L154-L162"],
  ])("parses the %s range spelling", (_name, run) => {
    const s = spanFor(`read \`${run}\` first`, run);
    expect(s?.path).toBe("doc/DEVELOPMENT.md");
    expect(s?.line).toBe(154);
    expect(s?.endLine).toBe(162);
  });

  test.each([
    ["a bare #L line", "doc/DEVELOPMENT.md#L154"],
    ["a :L line", "doc/DEVELOPMENT.md:L154"],
  ])("parses %s the same as a plain :line", (_name, run) => {
    const s = spanFor(`read \`${run}\` first`, run);
    expect(s?.path).toBe("doc/DEVELOPMENT.md");
    expect(s?.line).toBe(154);
    expect(s?.endLine).toBeUndefined();
  });

  test("reads a numeric #fragment as an anchor, not as a line", () => {
    // `#` without an `L` introduces a URL fragment. Treating `#3` as line 3
    // would make a link to a numbered anchor open a file preview instead.
    const s = spanFor("see `doc/DEVELOPMENT.md#3` there", "doc/DEVELOPMENT.md");
    expect(s?.path).toBe("doc/DEVELOPMENT.md");
    expect(s?.line).toBeUndefined();
  });

  test("a range missing its end is just a line, and the span stops before the dash", () => {
    const s = spanFor("read `doc/DEVELOPMENT.md:154-` first", "doc/DEVELOPMENT.md:154");
    expect(s?.path).toBe("doc/DEVELOPMENT.md");
    expect(s?.line).toBe(154);
    expect(s?.endLine).toBeUndefined();
  });

  test("detects a directory written with a trailing slash", () => {
    // The slash is not a discriminator — it is carried through to the daemon,
    // which is the only thing that knows this is a directory (EXC-916).
    const s = spanFor("see `src/daemon/` there", "src/daemon/");
    expect(s?.path).toBe("src/daemon/");
  });

  test("detects a bare extensionless word", () => {
    const s = spanFor("look in `dist` now", "dist");
    expect(s?.path).toBe("dist");
  });

  test("detects a dotfile", () => {
    const s = spanFor("edit `.env` first", ".env");
    expect(s?.path).toBe(".env");
  });

  test("detects multiple references, each in its own code span", () => {
    const spans = only("both `a.ts` and `b/c.css` matter");
    expect(spans.map((s) => s.path).sort()).toEqual(["a.ts", "b/c.css"]);
  });

  test("keys spans by 1-based line number", () => {
    const map = buildFileRefLayer("intro\nsee `foo.ts`\nend");
    expect(map.has(1)).toBe(false);
    expect(map.get(2)?.[0]?.path).toBe("foo.ts");
  });
});

// A parenthesized citation is the scan's second scope (EXC-1184): plans name a
// symbol and cite the file beside it — `Emailer.attempt_send` (spam/email.py:127-141).
// Four gates keep the widening off ordinary prose, enumerated at scanLine's paren
// loop: the run's shape (no whitespace, no nested parens), a `]` predecessor test,
// no overlap with a code span, and worthAsking. Each has a fixture below that goes
// RED when that one gate is removed — a gate its own fixture passes without is
// documentation rather than an invariant.
describe("detection (parenthesized prose)", () => {
  test("detects a cited range written in bare parentheses", () => {
    const s = spanFor(
      "Today `Emailer.attempt_send` (spam/email.py:127-141) sends the email first",
      "spam/email.py:127-141",
    );
    expect(s).toBeDefined();
    expect(s?.path).toBe("spam/email.py");
    expect(s?.line).toBe(127);
    expect(s?.endLine).toBe(141);
  });

  test("detects a single cited line", () => {
    const s = spanFor(
      "parses (spam/models/retool_api.py:65) already",
      "spam/models/retool_api.py:65",
    );
    expect(s?.path).toBe("spam/models/retool_api.py");
    expect(s?.line).toBe(65);
  });

  test("detects a directory with no citation", () => {
    expect(spanFor("see (src/daemon/) for the rest", "src/daemon/")?.path).toBe("src/daemon/");
  });

  test("the span covers the interior only, never the parentheses", () => {
    // CANDIDATE_RE admits neither bracket, so a span that swallowed one would put
    // the glyph on punctuation the author wrote as a delimiter, not as a path.
    const spans = only("see (src/daemon/) for the rest");
    expect(spans).toHaveLength(1);
    expect(spans[0]?.startCol).toBe(5);
    expect(spans[0]?.endCol).toBe(16);
  });

  test.each([
    // Each fixture carries a path the gate under test is the ONLY thing refusing.
    // A whitespace fixture whose every word also fails worthAsking, or an image
    // fixture whose target is also a URL, would pass with its gate deleted.
    ["a run holding whitespace", "it is (a note about src/a.ts here)"],
    ["an image target", "![shot](docs/pic.png)"],
    ["a non-collapsing link target", "see [docs](github.com/o/r) here"],
    ["a parenthetical with no separator", "a note (sic) and (deprecated) and (EXC-1065)"],
    ["a version with no letter in its last segment", "version (2.0) shipped"],
    ["a URL in parentheses", "fetch (https://example.com/app.ts) now"],
  ])("ignores %s", (_name, text) => {
    expect(buildFileRefLayer(text).size).toBe(0);
  });

  test("a parenthesized code span yields one span, not two", () => {
    // The code scan already owns it, and its columns sit tight against the
    // filename rather than against the backticks.
    const spans = only("code (`foo.ts`) wrapped");
    expect(spans).toHaveLength(1);
    expect(spans[0]?.path).toBe("foo.ts");
  });

  test("a paren inside a spacey code span belongs to the command", () => {
    // The code scan abandons a span holding whitespace, but its RANGE is still
    // collected — otherwise the paren scan would pick the command apart, which is
    // the offer EXC-1065 removed.
    expect(buildFileRefLayer("run `sed -n '1,5p' (a/b.ts)` first").size).toBe(0);
  });

  test("a line carrying both sources returns its spans in startCol order", () => {
    // The paren reference sits LEFT of the code one, which is the opposite of the
    // order the two loops append in — so this reds the moment the sort goes, and
    // with it mergeFileRefSpans' "leftmost scanned span" promise.
    const spans = only("see (src/a.ts) and `x/y.ts` end");
    expect(spans.map((s) => s.path)).toEqual(["src/a.ts", "x/y.ts"]);
  });

  test.each([
    ["at the start of the line", "(foo.ts) leads", ["foo.ts"]],
    ["nested brackets", "((foo.ts))", ["foo.ts"]],
    ["two adjacent runs", "(a.ts)(b.ts)", ["a.ts", "b.ts"]],
    ["two runs in one paren", "(a.ts,b.ts)", ["a.ts", "b.ts"]],
    ["an unclosed paren", "(unclosed a.ts", []],
  ])("handles %s", (_name, text, paths) => {
    // The first row is the only place the implementation reads an out-of-bounds
    // index (`source[-1]`), which reads back undefined rather than throwing.
    expect(only(text).map((s) => s.path)).toEqual(paths);
  });
});

describe("the plausibility floor", () => {
  test.each([
    ["the ratio `3.14` exactly", "decimal number"],
    ["at line `42` there", "bare number"],
    ["version `1.2.3` shipped", "dotted version"],
    ["pass `--` to stop", "punctuation only"],
  ])("ignores %j (%s)", (text) => {
    expect(buildFileRefLayer(text).size).toBe(0);
  });

  test.each([
    ["`e.g` here", "prose abbreviation"],
    ["either `and/or` both", "slash word"],
    ["call `obj.property` on it", "member access"],
  ])("offers %j (%s) to the daemon anyway", (text) => {
    // Cheap to refuse server-side (one stat, and no basename walk without a
    // known extension), and refusing it here is the guess EXC-916 removes.
    expect(buildFileRefLayer(text).size).toBe(1);
  });
});

describe("exclusions", () => {
  test("does not detect a path in bare prose, outside a code span or a parenthesis", () => {
    expect(buildFileRefLayer("edit src/foo.ts in prose").size).toBe(0);
  });

  test("does not detect a filename that is part of a code-spanned URL", () => {
    expect(buildFileRefLayer("see `https://example.com/app.ts` docs").size).toBe(0);
  });

  test("does not detect anything inside a code span that holds spaces", () => {
    // `bun test <blah>` is a command, not a path — but `test` is a real
    // directory, so per-word candidates made the whole span read as a folder.
    expect(buildFileRefLayer("run `bun test <blah>` first").size).toBe(0);
    expect(buildFileRefLayer("run `cd src` first").size).toBe(0);
  });

  test("skips only the spacey span, not the whole line", () => {
    const spans = only("see `bun test` and `src/foo.ts` here");
    expect(spans.map((s) => s.path)).toEqual(["src/foo.ts"]);
  });

  test("still detects a path padded by CommonMark's code-span spaces", () => {
    // ``` ` foo.ts ` ``` renders as `foo.ts`; the padding is not a word break.
    // The needle is the SPAN's text, and the span covers the candidate only —
    // the padding sits outside it, as it does for any prose around a reference.
    expect(spanFor("look at ` foo.ts ` now", "foo.ts")?.path).toBe("foo.ts");
  });

  test("does not detect references inside a fenced code block", () => {
    const text = [
      "```ts",
      "import x from '$lib/diffview/foo.ts'",
      "```",
      "but `foo.ts` in prose",
    ].join("\n");
    const map = buildFileRefLayer(text);
    // The fenced lines (1–3) are skipped; only the prose line 4's code span scans.
    expect(map.has(2)).toBe(false);
    expect(map.get(4)?.[0]?.path).toBe("foo.ts");
  });
});

describe("confinement is the daemon's job, not the parser's", () => {
  test("still emits a candidate span for a ../ escape (the daemon refuses it)", () => {
    const s = spanFor("edit `../lib/x.ts` please", "../lib/x.ts");
    expect(s?.path).toBe("../lib/x.ts");
  });
});

// classify is the one definition of "path-shaped" in the codebase. It is exported
// so the link layer applies the SAME gate to a `[label](target)` target to decide
// whether it is a path at all (EXC-954) — a second, drifting notion of what looks
// like a path would let the two decoration paths disagree about the same text. The
// link layer then narrows further on its own to decide the REFERENCE rather than
// the collapse, which is why `guide` classifies here yet earns no citation: its
// label collapses under a plain link run instead.
describe("classify", () => {
  test("accepts a path with a known extension", () => {
    expect(classify("a/b.md")).toEqual({ path: "a/b.md", line: undefined });
  });

  test("splits a trailing :line off the path", () => {
    expect(classify("a/b.md:42")).toEqual({ path: "a/b.md", line: 42 });
  });

  test("splits a trailing :start-end range off the path", () => {
    expect(classify("a/b.md:42-50")).toEqual({ path: "a/b.md", line: 42, endLine: 50 });
  });

  test("normalizes a reversed range, so every consumer gets line <= endLine", () => {
    // Normalized here rather than downstream: one place, and the preview's
    // membership test and framing math can then assume the pair is ordered.
    expect(classify("a/b.md:50-42")).toEqual({ path: "a/b.md", line: 42, endLine: 50 });
  });

  test.each([
    ["an extensionless word", "guide", "guide"],
    ["a trailing-slash directory", "src/daemon/", "src/daemon/"],
    ["a dotfile", ".env", ".env"],
  ])("accepts %s", (_name, raw, path) => {
    expect(classify(raw)).toEqual({ path, line: undefined });
  });

  test.each([
    ["a bare number", "42"],
    ["a decimal", "3.14"],
    ["a dotted version", "1.2.3"],
    ["punctuation with no name", "--"],
  ])("rejects %s — no letter to make it a plausible path", (_name, raw) => {
    expect(classify(raw)).toBeNull();
  });
});

// pathCandidates is the tokenizer half of the scan: the maximal path-shaped runs
// in one piece of text, with URLs masked and classify() applied. It is shared —
// scanLine below applies it to an inline-code interior and to a parenthesized
// interior, and the editor's chip scan (lib/editorRefs.ts, EXC-1177) applies it
// to the document's prose with code masked out — so what counts as a path-shaped
// run has one definition rather than one per surface.
describe("pathCandidates", () => {
  test("offsets each run into the text it was given", () => {
    // Every word clears the plausibility floor — the floor is deliberately low
    // and the filesystem is the real gate — so the run of interest is picked out
    // by its offsets rather than by being the only one.
    expect(pathCandidates("see a/b.md now")).toContainEqual({
      start: 4,
      end: 10,
      path: "a/b.md",
      line: undefined,
      endLine: undefined,
    });
  });

  test("carries a trailing range into the run's end, so the whole reference is one candidate", () => {
    expect(pathCandidates("a/b.md:42-50")).toEqual([
      { start: 0, end: 12, path: "a/b.md", line: 42, endLine: 50 },
    ]);
  });

  test("masks a URL, so its path-shaped tail is never a candidate", () => {
    expect(pathCandidates("https://example.com/app.ts")).toEqual([]);
  });

  test("drops a run with no letter in its last segment", () => {
    expect(pathCandidates("3.14")).toEqual([]);
  });

  test("finds every run in the text", () => {
    expect(pathCandidates("a.ts and b.ts").map((c) => c.path)).toEqual(["a.ts", "and", "b.ts"]);
  });
});

// mergeFileRefSpans unions the references the scan finds in inline code and in
// parenthesized runs with the ones the link layer EMITS over collapsed labels
// (EXC-954). The two can land
// on the same text — a markdown link whose label is itself an inline-code path —
// and two overlapping spans would tag two tokens and draw two glyphs, so the
// merge must collapse each collision to exactly one span.
describe("mergeFileRefSpans", () => {
  const map = (...entries: [number, FileRefSpan[]][]): FileRefSpanMap => new Map(entries);

  test("unions spans from disjoint lines", () => {
    const merged = mergeFileRefSpans(
      map([1, [{ startCol: 0, endCol: 6, path: "a/b.md" }]]),
      map([3, [{ startCol: 2, endCol: 8, path: "c/d.ts" }]]),
    );
    expect(merged.get(1)?.map((s) => s.path)).toEqual(["a/b.md"]);
    expect(merged.get(3)?.map((s) => s.path)).toEqual(["c/d.ts"]);
  });

  test("keeps a non-overlapping emitted span on a line that also has a scanned one", () => {
    const merged = mergeFileRefSpans(
      map([1, [{ startCol: 0, endCol: 6, path: "a/b.md" }]]),
      map([1, [{ startCol: 20, endCol: 26, path: "c/d.ts" }]]),
    );
    expect(merged.get(1)).toHaveLength(2);
  });

  test("anchors on the leftmost scanned span even when handed them out of order", () => {
    // The anchor pick is `find`, so "leftmost" is a property of the array. Every
    // producer sorts today; the merge re-sorts anyway, so this holds for one
    // that does not — and the label's cited range survives, which is what a
    // wrong anchor silently drops (EXC-1192).
    const merged = mergeFileRefSpans(
      map([
        1,
        [
          { startCol: 12, endCol: 16, path: "b.ts" },
          { startCol: 1, endCol: 5, path: "a.ts" },
        ],
      ]),
      map([1, [{ startCol: 0, endCol: 17, path: "a.ts" }]]),
    );
    expect(merged.get(1)).toHaveLength(1);
    expect(merged.get(1)?.[0]?.startCol).toBe(1);
  });

  test("sorts each line's spans by startCol", () => {
    const merged = mergeFileRefSpans(
      map([1, [{ startCol: 20, endCol: 26, path: "late.ts" }]]),
      map([1, [{ startCol: 0, endCol: 8, path: "early.ts" }]]),
    );
    expect(merged.get(1)?.map((s) => s.path)).toEqual(["early.ts", "late.ts"]);
  });

  test("an overlapping pair collapses to one span — the label never draws two glyphs", () => {
    // The backticked-path label `` [`a.ts`](a.ts) ``: the scan finds the path
    // inside the backticks, the link layer emits over the whole label.
    const merged = mergeFileRefSpans(
      map([1, [{ startCol: 1, endCol: 5, path: "a.ts" }]]),
      map([1, [{ startCol: 0, endCol: 6, path: "a.ts", target: "a.ts" }]]),
    );
    expect(merged.get(1)).toHaveLength(1);
    // The scanned columns win — inline code is where a path gets its own shiki
    // token, so they place the glyph tight against the filename.
    expect(merged.get(1)?.[0]?.startCol).toBe(1);
    expect(merged.get(1)?.[0]?.endCol).toBe(5);
    expect(merged.get(1)?.[0]?.path).toBe("a.ts");
  });

  test("every overlapping scanned span collapses, not just the first", () => {
    // A label citing two inline-code paths — [`a.ts` and `b.ts`](c/d.ts). Both
    // scanned spans sit under the one emitted span; leaving the second would
    // draw a second glyph and make `b.ts` independently clickable, pointing at
    // a file the link never named.
    const merged = mergeFileRefSpans(
      map([
        1,
        [
          { startCol: 1, endCol: 5, path: "a.ts" },
          { startCol: 12, endCol: 16, path: "b.ts" },
        ],
      ]),
      map([1, [{ startCol: 0, endCol: 17, path: "c/d.ts", target: "c/d.ts" }]]),
    );
    expect(merged.get(1)).toHaveLength(1);
    expect(merged.get(1)?.[0]?.path).toBe("c/d.ts");
    // The leftmost scanned span places the glyph.
    expect(merged.get(1)?.[0]?.startCol).toBe(1);
  });

  test("a collapsed collision keeps the emitted span's cited range", () => {
    // The survivor is rebuilt field by field, so a range dropped here would
    // leave the preview framing one line of a span the link plainly cites.
    const merged = mergeFileRefSpans(
      map([1, [{ startCol: 1, endCol: 5, path: "a.ts" }]]),
      map([
        1,
        [{ startCol: 0, endCol: 6, path: "b/c.ts", line: 7, endLine: 19, target: "b/c.ts:7-19" }],
      ]),
    );
    expect(merged.get(1)?.[0]?.line).toBe(7);
    expect(merged.get(1)?.[0]?.endLine).toBe(19);
  });

  test("on a collision the emitted path wins — the click opens the link's target", () => {
    // `` [`a.ts`](b/c.ts) ``: the label names one file, the link points at another.
    const merged = mergeFileRefSpans(
      map([1, [{ startCol: 1, endCol: 5, path: "a.ts" }]]),
      map([1, [{ startCol: 0, endCol: 6, path: "b/c.ts", line: 7, target: "b/c.ts:7" }]]),
    );
    expect(merged.get(1)).toHaveLength(1);
    expect(merged.get(1)?.[0]?.path).toBe("b/c.ts");
    expect(merged.get(1)?.[0]?.line).toBe(7);
    expect(merged.get(1)?.[0]?.target).toBe("b/c.ts:7");
  });

  test("a target naming no line keeps the label's cited range", () => {
    // `` [`a.ts:5-9`](a.ts) ``: the label is the only half that cites a line, so
    // taking the emitted span's line unconditionally would discard the citation
    // and open the preview on the file's head with nothing washed. The link layer
    // emits no target for this shape — the label already shows it (links.ts).
    const merged = mergeFileRefSpans(
      map([1, [{ startCol: 1, endCol: 9, path: "a.ts", line: 5, endLine: 9 }]]),
      map([1, [{ startCol: 0, endCol: 10, path: "a.ts" }]]),
    );
    expect(merged.get(1)).toHaveLength(1);
    expect(merged.get(1)?.[0]?.line).toBe(5);
    expect(merged.get(1)?.[0]?.endLine).toBe(9);
    // The leftmost scanned span still places the glyph, and its end still covers
    // the range tail, so a click on the `-9` lands on the reference.
    expect(merged.get(1)?.[0]?.startCol).toBe(1);
    expect(merged.get(1)?.[0]?.endCol).toBe(9);
  });

  test("a target naming a different path never inherits the label's line", () => {
    // `` [`a.ts:10`](b/c.ts) ``: the label's citation is about a.ts, so carrying it
    // over would frame line 10 of a file the label never cited. Dropping it beats
    // guessing, which is why the path guard is not just a `??` away.
    const merged = mergeFileRefSpans(
      map([1, [{ startCol: 1, endCol: 9, path: "a.ts", line: 10 }]]),
      map([1, [{ startCol: 0, endCol: 10, path: "b/c.ts", target: "b/c.ts" }]]),
    );
    expect(merged.get(1)?.[0]?.path).toBe("b/c.ts");
    expect(merged.get(1)?.[0]?.line).toBeUndefined();
  });

  test("the cited range comes from one span, never a field from each", () => {
    // `` [`a.ts:10-20`](a.ts:42) ``: mixing the target's start with the label's end
    // yields the reversed 42–20, a range classify's own normalization would never
    // produce and the preview cannot frame. The target wins whole instead.
    const merged = mergeFileRefSpans(
      map([1, [{ startCol: 1, endCol: 11, path: "a.ts", line: 10, endLine: 20 }]]),
      map([1, [{ startCol: 0, endCol: 12, path: "a.ts", line: 42, target: "a.ts:42" }]]),
    );
    expect(merged.get(1)?.[0]?.line).toBe(42);
    expect(merged.get(1)?.[0]?.endLine).toBeUndefined();
  });
});

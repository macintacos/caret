import { describe, expect, test } from "bun:test";

import {
  buildFileRefLayer,
  classify,
  type FileRefSpan,
  type FileRefSpanMap,
  mergeFileRefSpans,
} from "$lib/diffview/fileRefs.ts";

// buildFileRefLayer is one of two detection sources for the filename-reference
// feature (EXC-687): it scans a plan's display source for path-shaped tokens
// *inside inline-code spans* and returns per-line spans. The other is the link
// layer's emission over collapsed markdown-link labels (EXC-954), which
// mergeFileRefSpans below unions with this one. This scan stays scoped to inline
// code because that is where a path renders as its own shiki token (prose is one
// coarse run). Shape is only a plausibility floor — the filesystem, not the
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
    const s = spanFor("read `doc/ADVANCED.md:154-162` first", "doc/ADVANCED.md:154-162");
    expect(s?.path).toBe("doc/ADVANCED.md");
    expect(s?.line).toBe(154);
    expect(s?.endLine).toBe(162);
  });

  test.each([
    ["en dash", "doc/ADVANCED.md:154–162"],
    ["L-prefixed", "doc/ADVANCED.md:L154-L162"],
    ["hash L-prefixed", "doc/ADVANCED.md#L154-L162"],
    ["hash after colon", "doc/ADVANCED.md:#L154-L162"],
  ])("parses the %s range spelling", (_name, run) => {
    const s = spanFor(`read \`${run}\` first`, run);
    expect(s?.path).toBe("doc/ADVANCED.md");
    expect(s?.line).toBe(154);
    expect(s?.endLine).toBe(162);
  });

  test.each([
    ["a bare #L line", "doc/ADVANCED.md#L154"],
    ["a :L line", "doc/ADVANCED.md:L154"],
  ])("parses %s the same as a plain :line", (_name, run) => {
    const s = spanFor(`read \`${run}\` first`, run);
    expect(s?.path).toBe("doc/ADVANCED.md");
    expect(s?.line).toBe(154);
    expect(s?.endLine).toBeUndefined();
  });

  test("reads a numeric #fragment as an anchor, not as a line", () => {
    // `#` without an `L` introduces a URL fragment. Treating `#3` as line 3
    // would make a link to a numbered anchor open a file preview instead.
    const s = spanFor("see `doc/ADVANCED.md#3` there", "doc/ADVANCED.md");
    expect(s?.path).toBe("doc/ADVANCED.md");
    expect(s?.line).toBeUndefined();
  });

  test("a range missing its end is just a line, and the span stops before the dash", () => {
    const s = spanFor("read `doc/ADVANCED.md:154-` first", "doc/ADVANCED.md:154");
    expect(s?.path).toBe("doc/ADVANCED.md");
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
  test("does not detect a path in prose (only inside inline code)", () => {
    expect(buildFileRefLayer("edit src/foo.ts in prose").size).toBe(0);
  });

  test("does not detect a filename that is part of a code-spanned URL", () => {
    expect(buildFileRefLayer("see `https://example.com/app.ts` docs").size).toBe(0);
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
// so the link layer applies the SAME gate to a `[label](target)` target before
// collapsing it (EXC-954) — a second, drifting notion of what looks like a path
// would let the two decoration paths disagree about the same text. The link layer
// then narrows further on its own, which is why `guide` classifies here yet still
// leaves a link literal.
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

// mergeFileRefSpans unions the references the layers SCAN out of inline code with
// the ones the link layer EMITS over collapsed labels (EXC-954). The two can land
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
});

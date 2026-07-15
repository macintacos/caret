import { describe, expect, test } from "bun:test";

import { buildFileRefLayer, type FileRefSpan } from "$lib/diffview/fileRefs.ts";

// buildFileRefLayer is the pure detection half of the filename-hover feature
// (EXC-687): it scans a plan's display source for path-shaped tokens *inside
// inline-code spans* and returns per-line spans. Detection is scoped to inline
// code because that is where a path renders as its own shiki token (prose is one
// coarse run); it is deliberately permissive on *shape* — whether a candidate is
// a real file is the daemon's call — but keeps precision high by requiring a
// known file extension, so an in-code "e.g" or "3.14" never becomes a candidate.
// Columns index the display line so they line up with the rendered tokens; line
// numbers are 1-based.

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

describe("precision — non-files in code are not detected", () => {
  test.each([
    ["`e.g` here", "prose abbreviation"],
    ["the ratio `3.14` exactly", "decimal number"],
    ["either `and/or` both", "slash word, no extension"],
    ["call `obj.property` on it", "member access, unknown extension"],
  ])("ignores %j (%s)", (text) => {
    expect(buildFileRefLayer(text).size).toBe(0);
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

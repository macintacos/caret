import "@ui/test-setup.ts";
import { beforeEach, expect, test } from "bun:test";

import { celledRow, fileRefTexts, root, row } from "@ui/test-diffview-dom.ts";
import type { FileRefSpan, FileRefSpanMap } from "$lib/diffview/fileRefs.ts";
import { tagFileRefTokens } from "$lib/diffview/fileRefTag.ts";

// tagFileRefTokens marks the token span that begins each resolved file reference
// with data-file-ref, so the override sheet can render the file icon before it.
// The token structure (shiki spans whose text concatenates to the line) only
// exists in a real browser, so this is exercised with a hand-built stand-in DOM;
// the live shadow-root behavior is covered by e2e.

function map(entries: [number, FileRefSpan[]][]): FileRefSpanMap {
  return new Map(entries);
}

const tagged = fileRefTexts;

let host: HTMLElement;
beforeEach(() => {
  document.body.replaceChildren();
});

test("tags the token that starts a reference", () => {
  host = root(row(1, ["edit ", "src/foo.ts", " now"]));
  tagFileRefTokens(host, map([[1, [{ startCol: 5, endCol: 15, path: "src/foo.ts" }]]]));
  expect(tagged(host)).toEqual(["src/foo.ts"]);
});

test("tags the first token when the path is split across several tokens", () => {
  host = root(row(1, ["src", "/", "a", ".", "ts"]));
  tagFileRefTokens(host, map([[1, [{ startCol: 0, endCol: 8, path: "src/a.ts" }]]]));
  expect(tagged(host)).toEqual(["src"]);
});

test("tags references across multiple lines", () => {
  host = root(row(2, ["see ", "a.ts"]), row(4, ["and ", "b.css", " too"]));
  tagFileRefTokens(
    host,
    map([
      [2, [{ startCol: 4, endCol: 8, path: "a.ts" }]],
      [4, [{ startCol: 4, endCol: 9, path: "b.css" }]],
    ]),
  );
  expect(tagged(host).sort()).toEqual(["a.ts", "b.css"]);
});

test("clears stale tags before applying the new set", () => {
  host = root(row(1, ["old.ts", " ", "new.ts"]));
  tagFileRefTokens(host, map([[1, [{ startCol: 0, endCol: 6, path: "old.ts" }]]]));
  expect(tagged(host)).toEqual(["old.ts"]);
  // A re-tag pointing at the other token must drop the first tag.
  tagFileRefTokens(host, map([[1, [{ startCol: 7, endCol: 13, path: "new.ts" }]]]));
  expect(tagged(host)).toEqual(["new.ts"]);
});

test("does not tag a coarse token that only contains the reference mid-run", () => {
  // A single prose-like token spanning the whole line: the reference starts at
  // column 6, inside it, not at its boundary — so no icon is placed (the guard
  // that keeps the icon off a token wider than the path).
  host = root(row(1, ["prose src/foo.ts here"]));
  tagFileRefTokens(host, map([[1, [{ startCol: 6, endCol: 16, path: "src/foo.ts" }]]]));
  expect(tagged(host)).toEqual([]);
});

test("does not tag a coarse token that starts at the reference but runs past it", () => {
  // A file link collapsed into prose: shiki emits the whole line as one token,
  // which begins exactly where the reference does. Tagging it would draw the
  // glyph and the hover chip around the entire sentence, so the icon is omitted
  // rather than misplaced — the same call the mid-run guard above makes.
  host = root(row(1, ["src/foo.ts holds the key."]));
  tagFileRefTokens(host, map([[1, [{ startCol: 0, endCol: 10, path: "src/foo.ts" }]]]));
  expect(tagged(host)).toEqual([]);
});

// EXC-918: the daemon says what a reference resolved to, and the tag carries it
// so the override sheet can draw a folder glyph instead of a file one. A file
// keeps the valueless attribute it has always had, so its markup is unchanged
// and every `[data-file-ref]` selector still matches both kinds.
test("tags a directory reference with the directory kind", () => {
  host = root(row(1, ["open ", "src/lib", " next"]));
  tagFileRefTokens(
    host,
    map([[1, [{ startCol: 5, endCol: 12, path: "src/lib", kind: "directory" }]]]),
  );
  expect(host.querySelector("[data-file-ref]")?.getAttribute("data-file-ref")).toBe("directory");
});

test("leaves a file reference's tag valueless", () => {
  host = root(row(1, ["edit ", "src/foo.ts", " now"]));
  tagFileRefTokens(
    host,
    map([[1, [{ startCol: 5, endCol: 15, path: "src/foo.ts", kind: "file" }]]]),
  );
  expect(host.querySelector("[data-file-ref]")?.getAttribute("data-file-ref")).toBe("");
});

test("is a no-op for a line whose row is not rendered", () => {
  host = root(row(1, ["only ", "here.ts"]));
  expect(() =>
    tagFileRefTokens(host, map([[9, [{ startCol: 0, endCol: 7, path: "gone.ts" }]]])),
  ).not.toThrow();
  expect(tagged(host)).toEqual([]);
});

// EXC-864: a table row groups its tokens into cell elements, so the pass has to
// reach the token one level down.
test("tags a reference whose token sits inside a table cell", () => {
  //                     | a | src/x.ts |
  // columns             0    4 6      14
  host = root(celledRow(1, [["| a "], ["| ", "src/x.ts", " |"]]));
  tagFileRefTokens(host, map([[1, [{ startCol: 6, endCol: 14, path: "src/x.ts" }]]]));
  expect(tagged(host)).toEqual(["src/x.ts"]);
});

// An over-wide fenced block is re-parented into a scroll card, so the pass has to
// reach a token through that too.
/** A root whose rows sit inside a card rather than directly under [data-content]. */
function carded(...rows: HTMLElement[]): HTMLElement {
  const host = document.createElement("div");
  const content = document.createElement("div");
  content.setAttribute("data-content", "");
  const card = document.createElement("div");
  for (const r of rows) card.appendChild(r);
  content.appendChild(card);
  host.appendChild(content);
  return host;
}

test("tags a reference on a row that has been re-parented into a card", () => {
  host = carded(row(1, ["edit ", "src/foo.ts", " now"]));
  tagFileRefTokens(host, map([[1, [{ startCol: 5, endCol: 15, path: "src/foo.ts" }]]]));
  expect(tagged(host)).toEqual(["src/foo.ts"]);
});

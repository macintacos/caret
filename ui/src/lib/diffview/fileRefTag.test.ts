import "../../../test-setup.ts";
import { beforeEach, expect, test } from "bun:test";

import type { FileRefSpan, FileRefSpanMap } from "$lib/diffview/fileRefs.ts";
import { tagFileRefTokens } from "$lib/diffview/fileRefTag.ts";

// tagFileRefTokens marks the token span that begins each resolved file reference
// with data-file-ref, so the override sheet can render the file icon before it.
// The token structure (shiki spans whose text concatenates to the line) only
// exists in a real browser, so this is exercised with a hand-built stand-in DOM;
// the live shadow-root behavior is covered by e2e.

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

function map(entries: [number, FileRefSpan[]][]): FileRefSpanMap {
  return new Map(entries);
}

function tagged(host: HTMLElement): string[] {
  return [...host.querySelectorAll("[data-file-ref]")].map((el) => el.textContent ?? "");
}

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

test("is a no-op for a line whose row is not rendered", () => {
  host = root(row(1, ["only ", "here.ts"]));
  expect(() =>
    tagFileRefTokens(host, map([[9, [{ startCol: 0, endCol: 7, path: "gone.ts" }]]])),
  ).not.toThrow();
  expect(tagged(host)).toEqual([]);
});

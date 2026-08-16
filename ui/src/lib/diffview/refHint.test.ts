import "@ui/test-setup.ts";
import { beforeEach, describe, expect, test } from "bun:test";

import type { RectReader } from "$lib/diffview/codeCopy.ts";
import type { FileRefSpan, FileRefSpanMap } from "$lib/diffview/fileRefs.ts";
import { dismissRefHint, isRefHintDismissed, pickRefHintAnchors } from "$lib/diffview/refHint.ts";

// Both halves of the one-time reference hint (EXC-1061): the per-kind dismissal
// flags, against the happy-dom localStorage test-setup wires, and the anchor
// pick, against a hand-built shadow host. happy-dom lays nothing out, so the
// geometry runs through an injected rect reader — the same seam codeCopy uses.

type Rect = ReturnType<RectReader>;

const SCROLLER: Rect = { top: 0, bottom: 100, left: 0, right: 400 };
const VISIBLE: Rect = { top: 10, bottom: 20, left: 100, right: 200 };
const BELOW: Rect = { top: 500, bottom: 510, left: 100, right: 200 };

/** A host whose shadow root holds `[data-content] [data-line]` rows of token
 * spans, matching the structure the source view renders. */
function makeHost(rows: [number, string[]][]): HTMLElement {
  const host = document.createElement("div");
  const root = host.attachShadow({ mode: "open" });
  const content = document.createElement("div");
  content.setAttribute("data-content", "");
  for (const [line, tokens] of rows) {
    const row = document.createElement("div");
    row.setAttribute("data-line", String(line));
    for (const text of tokens) {
      const span = document.createElement("span");
      span.textContent = text;
      row.appendChild(span);
    }
    content.appendChild(row);
  }
  root.appendChild(content);
  return host;
}

/** Lays every token inside the scroller's box, except the ones named in
 * `rects` — keyed by token text, so a test can push one out of view. */
function reader(scroller: HTMLElement, rects: Record<string, Rect> = {}): RectReader {
  return (el) => (el === scroller ? SCROLLER : (rects[el.textContent ?? ""] ?? VISIBLE));
}

function span(
  startCol: number,
  endCol: number,
  path: string,
  kind?: FileRefSpan["kind"],
): FileRefSpan {
  return { startCol, endCol, path, kind };
}

beforeEach(() => {
  localStorage.clear();
});

describe("ref hint dismissal", () => {
  test("starts undismissed per kind on a fresh store", () => {
    expect(isRefHintDismissed("file")).toBe(false);
    expect(isRefHintDismissed("directory")).toBe(false);
  });

  test("dismissing one kind leaves the other alone", () => {
    dismissRefHint("file");
    expect(isRefHintDismissed("file")).toBe(true);
    expect(isRefHintDismissed("directory")).toBe(false);
  });

  test("dismissal is idempotent and persists", () => {
    dismissRefHint("directory");
    dismissRefHint("directory");
    expect(isRefHintDismissed("directory")).toBe(true);
    expect(isRefHintDismissed("file")).toBe(false);
  });
});

describe("pickRefHintAnchors", () => {
  test("returns nothing without a shadow root", () => {
    const host = document.createElement("div");
    const scroller = document.createElement("div");
    const refs: FileRefSpanMap = new Map([[1, [span(0, 4, "a.ts", "file")]]]);
    expect(pickRefHintAnchors(host, scroller, refs, ["file"], reader(scroller))).toEqual([]);
  });

  test("visits line keys in ascending numeric order, not insertion order", () => {
    const host = makeHost([
      [2, ["a.ts"]],
      [10, ["b.ts"]],
    ]);
    const scroller = document.createElement("div");
    // Insertion order puts the LOWER line last — what mergeFileRefSpans does
    // when a link-emitted line follows the scanned ones.
    const refs: FileRefSpanMap = new Map();
    refs.set(10, [span(0, 4, "b.ts", "file")]);
    refs.set(2, [span(0, 4, "a.ts", "file")]);
    const got = pickRefHintAnchors(host, scroller, refs, ["file"], reader(scroller));
    expect(got.map((a) => a.span.path)).toEqual(["a.ts"]);
  });

  test("anchors at most one token per requested kind", () => {
    const host = makeHost([[1, ["a.ts", " ", "b.ts", " ", "src/lib"]]]);
    const scroller = document.createElement("div");
    const refs: FileRefSpanMap = new Map([
      [
        1,
        [
          span(0, 4, "a.ts", "file"),
          span(5, 9, "b.ts", "file"),
          span(10, 17, "src/lib", "directory"),
        ],
      ],
    ]);
    const got = pickRefHintAnchors(host, scroller, refs, ["file", "directory"], reader(scroller));
    expect(got.map((a) => [a.kind, a.span.path])).toEqual([
      ["file", "a.ts"],
      ["directory", "src/lib"],
    ]);
    expect(got.map((a) => a.token.textContent)).toEqual(["a.ts", "src/lib"]);
  });

  test("ignores a kind that was not requested", () => {
    const host = makeHost([[1, ["a.ts", " ", "src/lib"]]]);
    const scroller = document.createElement("div");
    const refs: FileRefSpanMap = new Map([
      [1, [span(0, 4, "a.ts", "file"), span(5, 12, "src/lib")]],
    ]);
    expect(pickRefHintAnchors(host, scroller, refs, ["directory"], reader(scroller))).toEqual([]);
  });

  test("skips a kind whose only token is outside the scroller's viewport", () => {
    const host = makeHost([[1, ["a.ts", " ", "src/lib"]]]);
    const scroller = document.createElement("div");
    const refs: FileRefSpanMap = new Map([
      [1, [span(0, 4, "a.ts", "file"), span(5, 12, "src/lib", "directory")]],
    ]);
    const got = pickRefHintAnchors(
      host,
      scroller,
      refs,
      ["file", "directory"],
      reader(scroller, { "src/lib": BELOW }),
    );
    expect(got.map((a) => a.span.path)).toEqual(["a.ts"]);
  });

  test("skips a line whose row is not rendered", () => {
    const host = makeHost([[3, ["a.ts"]]]);
    const scroller = document.createElement("div");
    const refs: FileRefSpanMap = new Map([
      [1, [span(0, 5, "gone.ts", "file")]],
      [3, [span(0, 4, "a.ts", "file")]],
    ]);
    const read = reader(scroller);
    expect(() => pickRefHintAnchors(host, scroller, refs, ["file"], read)).not.toThrow();
    expect(
      pickRefHintAnchors(host, scroller, refs, ["file"], read).map((a) => a.span.path),
    ).toEqual(["a.ts"]);
  });

  test("skips a span no token begins", () => {
    // One coarse prose token: the reference starts inside it, so there is no
    // token that begins the reference and the span yields no anchor.
    const host = makeHost([
      [1, ["prose a.ts here"]],
      [2, ["b.ts"]],
    ]);
    const scroller = document.createElement("div");
    const refs: FileRefSpanMap = new Map([
      [1, [span(6, 10, "a.ts", "file")]],
      [2, [span(0, 4, "b.ts", "file")]],
    ]);
    const got = pickRefHintAnchors(host, scroller, refs, ["file"], reader(scroller));
    expect(got.map((a) => a.span.path)).toEqual(["b.ts"]);
  });

  test("reports the token's first-rect top-right in scroller content coords", () => {
    const host = makeHost([[1, ["a.ts"]]]);
    const scroller = document.createElement("div");
    scroller.scrollTop = 50;
    scroller.scrollLeft = 10;
    const read: RectReader = (el) =>
      el === scroller
        ? { top: 5, bottom: 1000, left: 8, right: 400 }
        : { top: 100, bottom: 110, left: 100, right: 300 };
    const refs: FileRefSpanMap = new Map([[1, [span(0, 4, "a.ts", "file")]]]);
    // top = 100 - (5 - 50) = 145 ; left = 300 - (8 - 10) = 302
    const got = pickRefHintAnchors(host, scroller, refs, ["file"], read);
    expect(got.map((a) => ({ top: a.top, left: a.left }))).toEqual([{ top: 145, left: 302 }]);
  });
});

import "@ui/test-setup.ts";
import { beforeEach, describe, expect, test } from "bun:test";

import type { RectReader } from "$lib/diffview/codeCopy.ts";
import { scrolledOffsetReader } from "$lib/diffview/dom-fixture.ts";
import type { FileRefSpan, FileRefSpanMap } from "$lib/diffview/fileRefs.ts";
import {
  dismissRefHint,
  isRefHintDismissed,
  pickRefHintAnchors,
  refHintToken,
  syncRefHints,
} from "$lib/diffview/refHint.ts";

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
    const read = scrolledOffsetReader(scroller);
    const refs: FileRefSpanMap = new Map([[1, [span(0, 4, "a.ts", "file")]]]);
    // top = 100 - (5 - 50) = 145 ; left = 300 - (8 - 10) = 302
    const got = pickRefHintAnchors(host, scroller, refs, ["file"], read);
    expect(got.map((a) => ({ top: a.top, left: a.left }))).toEqual([{ top: 145, left: 302 }]);
  });

  test("carries the display line, so the token can be found again later", () => {
    const host = makeHost([[7, ["a.ts"]]]);
    const scroller = document.createElement("div");
    const refs: FileRefSpanMap = new Map([[7, [span(0, 4, "a.ts", "file")]]]);
    expect(pickRefHintAnchors(host, scroller, refs, ["file"], reader(scroller))[0]?.line).toBe(7);
  });
});

// The default reader, which every test above injects past. It is the module's one
// genuinely novel line, so it is exercised directly here.
describe("the default rect reader", () => {
  function stubClientRects(el: Element, ...rects: Rect[]): void {
    Object.defineProperty(el, "getClientRects", { value: () => rects, configurable: true });
  }

  /** A scroller stubbed to a fixed viewport, and the row's single token —
   * shared by the two cases below, which stub the token's own rects differently. */
  function scrollerAndToken(host: HTMLElement): { scroller: HTMLElement; token: Element } {
    const scroller = document.createElement("div");
    stubClientRects(scroller, { top: 0, bottom: 100, left: 0, right: 400 });
    const token = host.shadowRoot?.querySelector("span") as Element;
    return { scroller, token };
  }

  test("anchors to a wrapped token's FIRST fragment, not its union box", () => {
    const host = makeHost([[1, ["src/some/long/path.ts"]]]);
    const { scroller, token } = scrollerAndToken(host);
    // A path wrapped across two rows: the head runs to x=340 on the first row, the
    // tail restarts at the left margin and reaches further right. The union box's
    // top-right is (390, 10) — a point the text never occupies. The first
    // fragment's is (340, 10), where the reference visibly begins.
    stubClientRects(
      token,
      { top: 10, bottom: 20, left: 300, right: 340 },
      { top: 20, bottom: 30, left: 100, right: 390 },
    );
    const refs: FileRefSpanMap = new Map([[1, [span(0, 21, "src/some/long/path.ts", "file")]]]);
    const got = pickRefHintAnchors(host, scroller, refs, ["file"]);
    expect(got.map((a) => ({ top: a.top, left: a.left }))).toEqual([{ top: 10, left: 340 }]);
  });

  test("falls back to the bounding box when a token has no client rects", () => {
    const host = makeHost([[1, ["a.ts"]]]);
    const { scroller, token } = scrollerAndToken(host);
    stubClientRects(token); // none at all
    Object.defineProperty(token, "getBoundingClientRect", {
      value: () => ({ top: 10, bottom: 20, left: 100, right: 200 }),
      configurable: true,
    });
    const refs: FileRefSpanMap = new Map([[1, [span(0, 4, "a.ts", "file")]]]);
    const got = pickRefHintAnchors(host, scroller, refs, ["file"]);
    expect(got.map((a) => ({ top: a.top, left: a.left }))).toEqual([{ top: 10, left: 200 }]);
  });
});

// A backticked path is the repo's commonest citation, and coreStyles.ts § the
// citation carve-out paints the whole group — opening backtick, path, closing
// backtick — as ONE chip, stripping the reference's own fill, inline padding and
// radius. So the path token's right edge is a point inside the pill, and a badge
// anchored there sits in the middle of the chip rather than on its corner.
describe("a reference inside a codespan", () => {
  const TICK_L: Rect = { top: 10, bottom: 20, left: 100, right: 110 };
  const PATH: Rect = { top: 10, bottom: 20, left: 110, right: 190 };
  const TICK_R: Rect = { top: 10, bottom: 20, left: 190, right: 200 };

  /** A one-line row whose tokens each carry data-md-cite — the marker the
   * carve-out keys on, and the only way to tell a pill's members apart. */
  function citeHost(tokens: string[]): HTMLElement {
    const host = makeHost([[1, tokens]]);
    for (const el of host.shadowRoot?.querySelectorAll("[data-line] span") ?? []) {
      el.setAttribute("data-md-cite", "");
    }
    return host;
  }

  const tokensOf = (host: HTMLElement): HTMLElement[] =>
    Array.from(host.shadowRoot?.querySelectorAll("[data-line] span") ?? []);

  /** Lays the row out token by token, by position rather than by text — both
   * backticks read the same, and they are exactly what has to be told apart. */
  function laidOut(scroller: HTMLElement, host: HTMLElement, rects: Rect[]): RectReader {
    const toks = tokensOf(host);
    return (el) => {
      if (el === scroller) return SCROLLER;
      const i = toks.indexOf(el as HTMLElement);
      return i === -1 ? VISIBLE : (rects[i] ?? VISIBLE);
    };
  }

  const anchor = (host: HTMLElement, rects: Rect[]) => {
    const scroller = document.createElement("div");
    const refs: FileRefSpanMap = new Map([[1, [span(1, 5, "a.ts", "file")]]]);
    return pickRefHintAnchors(host, scroller, refs, ["file"], laidOut(scroller, host, rects))[0];
  };

  test("anchors to the pill's right edge, not the path token's", () => {
    const got = anchor(citeHost(["`", "a.ts", "`"]), [TICK_L, PATH, TICK_R]);
    expect({ top: got?.top, left: got?.left }).toEqual({ top: PATH.top, left: TICK_R.right });
  });

  test("stops walking where the pill does", () => {
    // Prose follows the closing backtick. Without the cite marker gating the walk
    // the badge would slide to the end of the sentence.
    const host = citeHost(["`", "a.ts", "`", " and more prose"]);
    tokensOf(host).at(-1)?.removeAttribute("data-md-cite");
    const prose: Rect = { top: 10, bottom: 20, left: 200, right: 380 };
    const got = anchor(host, [TICK_L, PATH, TICK_R, prose]);
    expect(got?.left).toBe(TICK_R.right);
  });

  test("a pill that wrapped keeps the badge on the path's own row", () => {
    // The closing backtick fell to the next row, whose right edge is a corner the
    // path itself never reaches.
    const wrapped: Rect = { top: 30, bottom: 40, left: 100, right: 110 };
    const got = anchor(citeHost(["`", "a.ts", "`"]), [TICK_L, PATH, wrapped]);
    expect({ top: got?.top, left: got?.left }).toEqual({ top: PATH.top, left: PATH.right });
  });
});

describe("syncRefHints", () => {
  const scroller = () => document.createElement("div");

  /** A single "a.ts" hint already placed on line 1 — the fixture shared by the
   * cases below that re-sync from a settled placement. */
  function placedFileHint(): {
    host: HTMLElement;
    sc: HTMLElement;
    refs: FileRefSpanMap;
    placed: ReturnType<typeof syncRefHints>;
  } {
    const host = makeHost([[1, ["a.ts"]]]);
    const sc = scroller();
    const refs: FileRefSpanMap = new Map([[1, [span(0, 4, "a.ts", "file")]]]);
    const placed = syncRefHints(host, sc, refs, ["file"], [], reader(sc));
    return { host, sc, refs, placed };
  }

  test("picks a kind that only comes into view later, keeping the one already placed", () => {
    // The reference kinds are rarely both on screen at once, so a sync that stopped
    // as soon as anything was placed would leave the other kind untaught for good.
    const host = makeHost([
      [1, ["a.ts"]],
      [2, ["src/lib"]],
    ]);
    const sc = scroller();
    const refs: FileRefSpanMap = new Map([
      [1, [span(0, 4, "a.ts", "file")]],
      [2, [span(0, 7, "src/lib", "directory")]],
    ]);
    const kinds = ["file", "directory"] as const;
    // Only the file is on screen at first.
    const first = syncRefHints(host, sc, refs, kinds, [], reader(sc, { "src/lib": BELOW }));
    expect(first.map((h) => h.kind)).toEqual(["file"]);
    // The reviewer scrolls; now both are, and the directory joins.
    const second = syncRefHints(host, sc, refs, kinds, first, reader(sc));
    expect(second.map((h) => h.kind).sort()).toEqual(["directory", "file"]);
  });

  test("re-derives coordinates when the content above a token shifts", () => {
    // Content coordinates survive scrolling, but not a height change above the
    // token — a font arriving, a row repainting, a wide block moving into a card.
    const { host, sc, refs, placed } = placedFileHint();
    expect(placed[0]?.top).toBe(10);

    const shifted = syncRefHints(host, sc, refs, ["file"], placed, (el) =>
      el === sc ? SCROLLER : { top: 40, bottom: 50, left: 100, right: 200 },
    );
    expect(shifted[0]?.top).toBe(40);
    expect(shifted.map((h) => h.kind)).toEqual(["file"]);
  });

  test("never moves a placed hint onto a different reference of its kind", () => {
    // Which reference a kind teaches on is decided once. Scrolling past a later one
    // must re-anchor the badge it has, not adopt the new one.
    const host = makeHost([
      [1, ["a.ts"]],
      [2, ["b.ts"]],
    ]);
    const sc = scroller();
    const refs: FileRefSpanMap = new Map([
      [1, [span(0, 4, "a.ts", "file")]],
      [2, [span(0, 4, "b.ts", "file")]],
    ]);
    const placed = syncRefHints(host, sc, refs, ["file"], [], reader(sc));
    expect(placed[0]?.span.path).toBe("a.ts");
    const again = syncRefHints(host, sc, refs, ["file"], placed, reader(sc));
    expect(again.map((h) => h.span.path)).toEqual(["a.ts"]);
  });

  test("drops a hint whose kind has been retired since the last sync", () => {
    const host = makeHost([[1, ["a.ts", " ", "src/lib"]]]);
    const sc = scroller();
    const refs: FileRefSpanMap = new Map([
      [1, [span(0, 4, "a.ts", "file"), span(5, 12, "src/lib", "directory")]],
    ]);
    const both = syncRefHints(host, sc, refs, ["file", "directory"], [], reader(sc));
    expect(both).toHaveLength(2);
    // The reviewer opened a file, so only the directory is still being taught.
    const after = syncRefHints(host, sc, refs, ["directory"], both, reader(sc));
    expect(after.map((h) => h.kind)).toEqual(["directory"]);
  });

  test("drops a hint whose row has left the document", () => {
    const { host, sc, refs, placed } = placedFileHint();
    host.shadowRoot?.querySelector('[data-line="1"]')?.remove();
    expect(syncRefHints(host, sc, refs, ["file"], placed, reader(sc))).toEqual([]);
  });
});

describe("refHintToken", () => {
  const anchorOn = (host: HTMLElement, line: number) => {
    const scroller = document.createElement("div");
    const refs: FileRefSpanMap = new Map([[line, [span(0, 4, "a.ts", "file")]]]);
    const got = pickRefHintAnchors(host, scroller, refs, ["file"], reader(scroller));
    if (got[0] === undefined) throw new Error("no anchor to test against");
    return got[0];
  };

  test("re-resolves the token the library replaced on a repaint", () => {
    const host = makeHost([[1, ["a.ts"]]]);
    const anchor = anchorOn(host, 1);
    // What a rerender does: the row's children are rewritten, so the measured
    // element is detached and a fresh span carries the same text.
    const row = host.shadowRoot?.querySelector('[data-line="1"]') as Element;
    const fresh = document.createElement("span");
    fresh.textContent = "a.ts";
    row.replaceChildren(fresh);

    expect(anchor.token.isConnected).toBe(false);
    expect(refHintToken(host, anchor)).toBe(fresh as HTMLElement);
  });

  test("falls back to the measured token when the row is gone", () => {
    const host = makeHost([[1, ["a.ts"]]]);
    const anchor = anchorOn(host, 1);
    host.shadowRoot?.querySelector('[data-line="1"]')?.remove();
    expect(refHintToken(host, anchor)).toBe(anchor.token);
  });

  test("falls back when there is no host at all", () => {
    const host = makeHost([[1, ["a.ts"]]]);
    const anchor = anchorOn(host, 1);
    expect(refHintToken(undefined, anchor)).toBe(anchor.token);
  });
});

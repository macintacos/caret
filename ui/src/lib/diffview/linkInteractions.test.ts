// Registers happy-dom globals (MouseEvent / PointerEvent / element style) so the
// handlers can be driven with real DOM event objects and a real token element.
import "@ui/support/setup.ts";
import { beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";

import type { FileRefSpanMap } from "$lib/diffview/fileRefs.ts";
import { composeTokenHandlers, createLinkHandlers } from "$lib/diffview/linkInteractions.ts";
import type { LinkSpan, LinkSpanMap } from "$lib/diffview/links.ts";

// linkInteractions turns a per-line link span map into the token-event handlers
// the @pierre/diffs File view accepts (onTokenClick / onTokenEnter /
// onTokenLeave). The column hit-test and the open/hover effects are pure and
// injected, so the whole layer is unit-testable without a real window or a
// mounted view. What the layer does with a token COARSER than the span it carries
// — shiki's one-token prose line, where the pointer's position decides — needs
// real layout, so that half lives in links.e2e.ts.

const span = (startCol: number, endCol: number, href: string): LinkSpan => ({
  startCol,
  endCol,
  href,
  label: href,
});

// A real (happy-dom) token element attached to the document so the hover effect
// can read its root, owner document, and bounding box and mount the tooltip. An
// unattached unit token has no shadow root, so the effect mounts the tooltip on
// the document body — which is where we read it back.
function fakeTokenElement(): HTMLElement {
  const el = document.createElement("span");
  document.body.appendChild(el);
  return el;
}

/** The href text of the hover tooltip currently mounted on the body, or null. */
function tooltipText(): string | null {
  return document.body.querySelector("[data-link-tooltip]")?.textContent ?? null;
}

describe("createLinkHandlers onTokenClick", () => {
  function mapOf(line: number, spans: LinkSpan[]): LinkSpanMap {
    return new Map([[line, spans]]);
  }

  /** The href opened for a click on the token covering [charStart, charEnd), or
   * undefined when none was. */
  function openedFor(spans: LinkSpan[], charStart: number, charEnd: number): string | undefined {
    const opened: string[] = [];
    createLinkHandlers(mapOf(1, spans), { openUrl: (href) => opened.push(href) }).onTokenClick(
      {
        lineNumber: 1,
        lineCharStart: charStart,
        lineCharEnd: charEnd,
        tokenText: "x",
        tokenElement: fakeTokenElement(),
      },
      new MouseEvent("click"),
    );
    return opened[0];
  }

  // Columns are 0-based and half-open on both sides, so a token ending exactly at
  // a span's startCol (or starting exactly at its endCol) is not on the link. A
  // token that merely overlaps — the coarse prose-line case — is a candidate; the
  // pointer's position then decides, which needs real layout and so is pinned in
  // links.e2e.ts rather than here.
  test("a token overlapping a span is a candidate for it", () => {
    const spans = [span(4, 12, "https://a.test")];
    expect(openedFor(spans, 4, 12)).toBe("https://a.test");
    expect(openedFor(spans, 6, 8)).toBe("https://a.test"); // token inside the span
    expect(openedFor(spans, 2, 6)).toBe("https://a.test"); // overlap at the leading edge
  });

  test("a token touching no span opens nothing", () => {
    const spans = [span(4, 12, "https://a.test")];
    expect(openedFor(spans, 0, 4)).toBeUndefined(); // ends exactly at startCol
    expect(openedFor(spans, 12, 16)).toBeUndefined(); // starts exactly at endCol
    expect(openedFor(spans, 20, 24)).toBeUndefined();
    expect(openedFor([], 0, 10)).toBeUndefined();
  });

  test("picks the correct span when a line has several", () => {
    const spans = [span(0, 1, "https://a.test"), span(6, 8, "https://b.test")];
    expect(openedFor(spans, 0, 1)).toBe("https://a.test");
    expect(openedFor(spans, 6, 8)).toBe("https://b.test");
  });

  test("opens the href when a click lands in a link span", () => {
    expect(openedFor([span(4, 12, "https://a.test")], 4, 12)).toBe("https://a.test");
  });

  test("does nothing when the click is outside any span", () => {
    expect(openedFor([span(4, 12, "https://a.test")], 0, 3)).toBeUndefined();
  });

  test("does nothing for a line with no spans", () => {
    const opened: string[] = [];
    const handlers = createLinkHandlers(mapOf(1, [span(0, 4, "https://a.test")]), {
      openUrl: (href) => opened.push(href),
    });
    handlers.onTokenClick(
      {
        lineNumber: 2,
        lineCharStart: 0,
        lineCharEnd: 4,
        tokenText: "x",
        tokenElement: fakeTokenElement(),
      },
      new MouseEvent("click"),
    );
    expect(opened).toEqual([]);
  });
});

describe("createLinkHandlers hover effects", () => {
  // The tooltip mounts on document.body for unattached unit tokens; clear it
  // between cases so a tooltip from a prior hover can't leak into the next.
  beforeEach(() => {
    document.body.replaceChildren();
  });

  test("enter reveals a caret tooltip carrying the full URL and a pointer cursor", () => {
    const handlers = createLinkHandlers(new Map([[1, [span(4, 12, "https://a.test/full")]]]), {
      openUrl: () => {},
    });
    const el = fakeTokenElement();
    handlers.onTokenEnter(
      { lineNumber: 1, lineCharStart: 4, lineCharEnd: 12, tokenText: "the docs", tokenElement: el },
      new PointerEvent("pointerenter"),
    );
    // The hover reveal is a caret-owned tooltip element, not the native title.
    expect(tooltipText()).toBe("https://a.test/full");
    expect(el.getAttribute("title")).toBeNull();
    expect(el.style.cursor).toBe("pointer");
  });

  test("enter on a non-link token reveals no tooltip and leaves the cursor", () => {
    const handlers = createLinkHandlers(new Map([[1, [span(4, 12, "https://a.test")]]]), {
      openUrl: () => {},
    });
    const el = fakeTokenElement();
    handlers.onTokenEnter(
      { lineNumber: 1, lineCharStart: 0, lineCharEnd: 3, tokenText: "See", tokenElement: el },
      new PointerEvent("pointerenter"),
    );
    expect(tooltipText()).toBeNull();
    expect(el.style.cursor ?? "").toBe("");
  });

  test("leave removes the tooltip and clears the cursor it set", () => {
    const handlers = createLinkHandlers(new Map([[1, [span(4, 12, "https://a.test")]]]), {
      openUrl: () => {},
    });
    const el = fakeTokenElement();
    const props = {
      lineNumber: 1,
      lineCharStart: 4,
      lineCharEnd: 12,
      tokenText: "the docs",
      tokenElement: el,
    };
    handlers.onTokenEnter(props, new PointerEvent("pointerenter"));
    expect(tooltipText()).toBe("https://a.test");
    handlers.onTokenLeave(props, new PointerEvent("pointerleave"));
    expect(tooltipText()).toBeNull();
    expect(el.style.cursor ?? "").toBe("");
  });
});

// composeTokenHandlers is the single home for token-handler composition: it
// builds the one enter/leave/click object the library accepts, owns the
// useTokenTransformer flag those handlers require, and carries the link-click /
// row-click race coordination a view's row-click handler reads (wasLinkClick).
// A future per-token affordance plugs in here, not in the view — these tests pin
// that contract so the seam can't quietly move back into the component.
describe("composeTokenHandlers", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  const clickProps = (lineNumber: number, lineCharStart: number, lineCharEnd: number) => ({
    lineNumber,
    lineCharStart,
    lineCharEnd,
    tokenText: "x",
    tokenElement: fakeTokenElement(),
  });

  /** Composes handlers over one link span (columns 4-12) and clicks the token
   * at [charStart, charEnd) — the shared shape behind the two cases below. */
  function clickComposed(
    charStart: number,
    charEnd: number,
  ): { opened: string[]; wasLinkClick: boolean | undefined } {
    const opened: string[] = [];
    const composed = composeTokenHandlers(
      new Map([[1, [span(4, 12, "https://a.test")]]]),
      undefined,
      { openUrl: (href) => opened.push(href) },
    );
    const event = new MouseEvent("click");
    composed?.handlers.onTokenClick(clickProps(1, charStart, charEnd), event);
    return { opened, wasLinkClick: composed?.wasLinkClick(event) };
  }

  test("exposes one handler object with all three token handlers", () => {
    const composed = composeTokenHandlers(
      new Map([[1, [span(4, 12, "https://a.test")]]]),
      undefined,
      {
        openUrl: () => {},
      },
    );
    // A second affordance contributes enter/leave/click HERE, so the composed
    // object must surface exactly those three for the library's single slots.
    expect(typeof composed?.handlers.onTokenClick).toBe("function");
    expect(typeof composed?.handlers.onTokenEnter).toBe("function");
    expect(typeof composed?.handlers.onTokenLeave).toBe("function");
  });

  test("carries useTokenTransformer:true so the flag can't drift from the handlers", () => {
    const composed = composeTokenHandlers(
      new Map([[1, [span(4, 12, "https://a.test")]]]),
      undefined,
      {
        openUrl: () => {},
      },
    );
    expect(composed?.libOptions.useTokenTransformer).toBe(true);
  });

  test("returns undefined when there is neither a link layer nor file refs", () => {
    expect(composeTokenHandlers(undefined, undefined, { openUrl: () => {} })).toBeUndefined();
  });

  test("opens a clicked link and marks the event as a consumed link click", () => {
    // The link opened, and the same event is now flagged so the row-click
    // handler stands down — the link's line does not also open a comment.
    const { opened, wasLinkClick } = clickComposed(4, 12);
    expect(opened).toEqual(["https://a.test"]);
    expect(wasLinkClick).toBe(true);
  });

  test("a click outside any span opens nothing and is not a link click", () => {
    // No link consumed the click, so the row-click handler is free to act.
    const { opened, wasLinkClick } = clickComposed(0, 3);
    expect(opened).toEqual([]);
    expect(wasLinkClick).toBe(false);
  });

  test("wasLinkClick tracks only the most recent link-click event", () => {
    const composed = composeTokenHandlers(
      new Map([[1, [span(4, 12, "https://a.test")]]]),
      undefined,
      {
        openUrl: () => {},
      },
    );
    const first = new MouseEvent("click");
    const second = new MouseEvent("click");
    composed?.handlers.onTokenClick(clickProps(1, 4, 12), first);
    composed?.handlers.onTokenClick(clickProps(1, 4, 12), second);
    // A new link click supersedes the prior one, so a stale event no longer
    // suppresses its row click.
    expect(composed?.wasLinkClick(first)).toBe(false);
    expect(composed?.wasLinkClick(second)).toBe(true);
  });

  test("delegates hover to the link handlers — enter reveals the tooltip, leave hides it", () => {
    const composed = composeTokenHandlers(
      new Map([[1, [span(4, 12, "https://a.test/full")]]]),
      undefined,
      {
        openUrl: () => {},
      },
    );
    const el = fakeTokenElement();
    const props = {
      lineNumber: 1,
      lineCharStart: 4,
      lineCharEnd: 12,
      tokenText: "the docs",
      tokenElement: el,
    };
    composed?.handlers.onTokenEnter(props, new PointerEvent("pointerenter"));
    expect(tooltipText()).toBe("https://a.test/full");
    expect(el.style.cursor).toBe("pointer");
    composed?.handlers.onTokenLeave(props, new PointerEvent("pointerleave"));
    expect(tooltipText()).toBeNull();
    expect(el.style.cursor ?? "").toBe("");
  });

  test("SourceView wires no token handlers of its own — the seam stays single-owner", async () => {
    // The contract this whole module exists to keep: a new per-token affordance
    // is added inside composeTokenHandlers, never in the view. SourceView must
    // therefore declare no onTokenEnter/onTokenLeave/onTokenClick of its own — it
    // consumes the one composed object and hands it straight to the library. This
    // assertion fails loudly if a future change reintroduces inline wrapping.
    const source = await Bun.file(join(import.meta.dir, "SourceView.svelte")).text();
    for (const handler of ["onTokenEnter", "onTokenLeave", "onTokenClick"]) {
      expect(source).not.toContain(handler);
    }
  });
});

describe("composeTokenHandlers — file references", () => {
  const fileRefs: FileRefSpanMap = new Map([
    [1, [{ startCol: 4, endCol: 13, path: "src/a.ts", line: 3 }]],
  ]);

  beforeEach(() => {
    document.body.replaceChildren();
  });

  function props(charStart: number, charEnd: number) {
    return {
      lineNumber: 1,
      lineCharStart: charStart,
      lineCharEnd: charEnd,
      tokenText: "src/a.ts",
      tokenElement: fakeTokenElement(),
    };
  }

  /** Composes handlers over `fileRefs` and clicks the token at [charStart, charEnd)
   * — the shared shape behind the two cases below. */
  function clickFileRef(
    charStart: number,
    charEnd: number,
  ): { clicked: string[]; wasLinkClick: boolean | undefined } {
    const clicked: string[] = [];
    const composed = composeTokenHandlers(undefined, fileRefs, {
      openUrl: () => {},
      onFileRefClick: (ref) => clicked.push(ref.path),
    });
    const event = new MouseEvent("click");
    composed?.handlers.onTokenClick(props(charStart, charEnd), event);
    return { clicked, wasLinkClick: composed?.wasLinkClick(event) };
  }

  test("returns handlers when only file refs are present (no link layer)", () => {
    const composed = composeTokenHandlers(undefined, fileRefs, {
      openUrl: () => {},
      onFileRefClick: () => {},
    });
    expect(typeof composed?.handlers.onTokenClick).toBe("function");
  });

  test("a click on a file reference dispatches it and consumes the event", () => {
    // The preview opens, and the same event is flagged so the row-click handler
    // stands down — the reference's line does not also open a comment composer.
    const { clicked, wasLinkClick } = clickFileRef(4, 13);
    expect(clicked).toEqual(["src/a.ts"]);
    expect(wasLinkClick).toBe(true);
  });

  test("hovering a file reference dispatches nothing — the highlight is CSS-only", () => {
    const clicked: string[] = [];
    const composed = composeTokenHandlers(undefined, fileRefs, {
      openUrl: () => {},
      onFileRefClick: (ref) => clicked.push(ref.path),
    });
    const p = props(4, 13);
    composed?.handlers.onTokenEnter(p, new PointerEvent("pointerenter"));
    composed?.handlers.onTokenLeave(p, new PointerEvent("pointerleave"));
    expect(clicked).toEqual([]);
  });

  // A reference emitted from a prose-labelled markdown link carries its target
  // (EXC-954): the display text says "the researcher agent", so hover is the only
  // way to see which file the click opens. An inline-code reference already shows
  // its path, carries no target, and keeps EXC-687's CSS-only hover.
  test("hovering a reference that carries a target reveals it in the tooltip", () => {
    const withTarget: FileRefSpanMap = new Map([
      [1, [{ startCol: 4, endCol: 13, path: "src/a.ts", target: "src/a.ts" }]],
    ]);
    const composed = composeTokenHandlers(undefined, withTarget, {
      openUrl: () => {},
      onFileRefClick: () => {},
    });
    const p = props(4, 13);
    composed?.handlers.onTokenEnter(p, new PointerEvent("pointerenter"));
    expect(tooltipText()).toBe("src/a.ts");
    composed?.handlers.onTokenLeave(p, new PointerEvent("pointerleave"));
    expect(tooltipText()).toBeNull();
  });

  test("hovering a reference with no target reveals no tooltip", () => {
    const composed = composeTokenHandlers(undefined, fileRefs, {
      openUrl: () => {},
      onFileRefClick: () => {},
    });
    composed?.handlers.onTokenEnter(props(4, 13), new PointerEvent("pointerenter"));
    expect(tooltipText()).toBeNull();
  });

  test("a file ref with a target takes hover from the link layer, not both", () => {
    // Both layers cover the same columns. The reference wins — one tooltip, and
    // it names the file the click will open rather than a URL.
    const withTarget: FileRefSpanMap = new Map([
      [1, [{ startCol: 4, endCol: 13, path: "src/a.ts", target: "src/a.ts" }]],
    ]);
    const composed = composeTokenHandlers(
      new Map([[1, [span(4, 13, "https://a.test")]]]),
      withTarget,
      { openUrl: () => {}, onFileRefClick: () => {} },
    );
    composed?.handlers.onTokenEnter(props(4, 13), new PointerEvent("pointerenter"));
    expect(document.body.querySelectorAll("[data-link-tooltip]")).toHaveLength(1);
    expect(tooltipText()).toBe("src/a.ts");
  });

  test("a token over neither layer still falls through to the link handlers", () => {
    const composed = composeTokenHandlers(
      new Map([[1, [span(20, 30, "https://a.test/full")]]]),
      fileRefs,
      { openUrl: () => {}, onFileRefClick: () => {} },
    );
    const p = { ...props(20, 30), tokenText: "the docs" };
    composed?.handlers.onTokenEnter(p, new PointerEvent("pointerenter"));
    expect(tooltipText()).toBe("https://a.test/full");
    composed?.handlers.onTokenLeave(p, new PointerEvent("pointerleave"));
    expect(tooltipText()).toBeNull();
  });

  test("a click that misses every file reference dispatches nothing and stays unconsumed", () => {
    const { clicked, wasLinkClick } = clickFileRef(0, 3);
    expect(clicked).toEqual([]);
    expect(wasLinkClick).toBe(false);
  });

  test("with both layers present, a file-ref click dispatches the ref, not the link", () => {
    const opened: string[] = [];
    const clicked: string[] = [];
    const composed = composeTokenHandlers(
      new Map([[1, [span(20, 30, "https://a.test")]]]),
      fileRefs,
      {
        openUrl: (href) => opened.push(href),
        onFileRefClick: (ref) => clicked.push(ref.path),
      },
    );
    const event = new MouseEvent("click");
    composed?.handlers.onTokenClick(props(4, 13), event);
    expect(clicked).toEqual(["src/a.ts"]);
    expect(opened).toEqual([]);
    expect(composed?.wasLinkClick(event)).toBe(true);
  });
});

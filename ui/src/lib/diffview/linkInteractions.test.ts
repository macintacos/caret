// Registers happy-dom globals (MouseEvent / PointerEvent / element style) so the
// handlers can be driven with real DOM event objects and a real token element.
import "../../../test-setup.ts";
import { beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";

import type { FileRefSpanMap } from "$lib/diffview/fileRefs.ts";
import {
  composeTokenHandlers,
  createLinkHandlers,
  hitTestSpan,
} from "$lib/diffview/linkInteractions.ts";
import type { LinkSpan, LinkSpanMap } from "$lib/diffview/links.ts";

// linkInteractions turns a per-line link span map into the token-event handlers
// the @pierre/diffs File view accepts (onTokenClick / onTokenEnter /
// onTokenLeave). The hit-test and the open/hover effects are pure and injected,
// so the whole layer is unit-testable without a real window or a mounted view.

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

describe("hitTestSpan", () => {
  test("returns the span when the token range overlaps it", () => {
    const spans = [span(4, 12, "https://a.test")];
    expect(hitTestSpan(spans, 4, 12)?.href).toBe("https://a.test");
    // Partial overlap (token inside the span) still hits.
    expect(hitTestSpan(spans, 6, 8)?.href).toBe("https://a.test");
    // Overlap at the leading edge.
    expect(hitTestSpan(spans, 2, 6)?.href).toBe("https://a.test");
  });

  test("returns undefined when the token range is outside every span", () => {
    const spans = [span(4, 12, "https://a.test")];
    expect(hitTestSpan(spans, 0, 4)).toBeUndefined(); // ends exactly at startCol
    expect(hitTestSpan(spans, 12, 16)).toBeUndefined(); // starts exactly at endCol
    expect(hitTestSpan(spans, 20, 24)).toBeUndefined();
  });

  test("picks the correct span when a line has several", () => {
    const spans = [span(0, 1, "https://a.test"), span(6, 8, "https://b.test")];
    expect(hitTestSpan(spans, 0, 1)?.href).toBe("https://a.test");
    expect(hitTestSpan(spans, 6, 8)?.href).toBe("https://b.test");
  });

  test("an empty span list never hits", () => {
    expect(hitTestSpan([], 0, 10)).toBeUndefined();
  });
});

describe("createLinkHandlers onTokenClick", () => {
  function mapOf(line: number, spans: LinkSpan[]): LinkSpanMap {
    return new Map([[line, spans]]);
  }

  test("opens the href when a click lands in a link span", () => {
    const opened: string[] = [];
    const handlers = createLinkHandlers(mapOf(1, [span(4, 12, "https://a.test")]), {
      openUrl: (href) => opened.push(href),
    });
    handlers.onTokenClick(
      {
        lineNumber: 1,
        lineCharStart: 4,
        lineCharEnd: 12,
        tokenText: "the docs",
        tokenElement: fakeTokenElement(),
      },
      new MouseEvent("click"),
    );
    expect(opened).toEqual(["https://a.test"]);
  });

  test("does nothing when the click is outside any span", () => {
    const opened: string[] = [];
    const handlers = createLinkHandlers(mapOf(1, [span(4, 12, "https://a.test")]), {
      openUrl: (href) => opened.push(href),
    });
    handlers.onTokenClick(
      {
        lineNumber: 1,
        lineCharStart: 0,
        lineCharEnd: 3,
        tokenText: "See",
        tokenElement: fakeTokenElement(),
      },
      new MouseEvent("click"),
    );
    expect(opened).toEqual([]);
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
    const opened: string[] = [];
    const composed = composeTokenHandlers(
      new Map([[1, [span(4, 12, "https://a.test")]]]),
      undefined,
      {
        openUrl: (href) => opened.push(href),
      },
    );
    const event = new MouseEvent("click");
    composed?.handlers.onTokenClick(clickProps(1, 4, 12), event);
    // The link opened, and the same event is now flagged so the row-click
    // handler stands down — the link's line does not also open a comment.
    expect(opened).toEqual(["https://a.test"]);
    expect(composed?.wasLinkClick(event)).toBe(true);
  });

  test("a click outside any span opens nothing and is not a link click", () => {
    const opened: string[] = [];
    const composed = composeTokenHandlers(
      new Map([[1, [span(4, 12, "https://a.test")]]]),
      undefined,
      {
        openUrl: (href) => opened.push(href),
      },
    );
    const event = new MouseEvent("click");
    composed?.handlers.onTokenClick(clickProps(1, 0, 3), event);
    // No link consumed the click, so the row-click handler is free to act.
    expect(opened).toEqual([]);
    expect(composed?.wasLinkClick(event)).toBe(false);
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

  function props(charStart: number, charEnd: number) {
    return {
      lineNumber: 1,
      lineCharStart: charStart,
      lineCharEnd: charEnd,
      tokenText: "src/a.ts",
      tokenElement: fakeTokenElement(),
    };
  }

  test("returns handlers when only file refs are present (no link layer)", () => {
    const composed = composeTokenHandlers(undefined, fileRefs, {
      openUrl: () => {},
      onFileRefClick: () => {},
    });
    expect(typeof composed?.handlers.onTokenClick).toBe("function");
  });

  test("a click on a file reference dispatches it and consumes the event", () => {
    const clicked: string[] = [];
    const composed = composeTokenHandlers(undefined, fileRefs, {
      openUrl: () => {},
      onFileRefClick: (ref) => clicked.push(ref.path),
    });
    const event = new MouseEvent("click");
    composed?.handlers.onTokenClick(props(4, 13), event);
    // The preview opens, and the same event is flagged so the row-click handler
    // stands down — the reference's line does not also open a comment composer.
    expect(clicked).toEqual(["src/a.ts"]);
    expect(composed?.wasLinkClick(event)).toBe(true);
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

  test("a click that misses every file reference dispatches nothing and stays unconsumed", () => {
    const clicked: string[] = [];
    const composed = composeTokenHandlers(undefined, fileRefs, {
      openUrl: () => {},
      onFileRefClick: (ref) => clicked.push(ref.path),
    });
    const event = new MouseEvent("click");
    composed?.handlers.onTokenClick(props(0, 3), event);
    expect(clicked).toEqual([]);
    expect(composed?.wasLinkClick(event)).toBe(false);
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

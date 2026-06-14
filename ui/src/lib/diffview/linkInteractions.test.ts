// Registers happy-dom globals (MouseEvent / PointerEvent / element style) so the
// handlers can be driven with real DOM event objects and a real token element.
import "../../../test-setup.ts";
import { beforeEach, describe, expect, test } from "bun:test";
import { createLinkHandlers, hitTestSpan } from "./linkInteractions.ts";
import type { LinkSpan, LinkSpanMap } from "./links.ts";

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
      { lineNumber: 1, lineCharStart: 4, lineCharEnd: 12, tokenText: "the docs" },
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
      { lineNumber: 1, lineCharStart: 0, lineCharEnd: 3, tokenText: "See" },
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
      { lineNumber: 2, lineCharStart: 0, lineCharEnd: 4, tokenText: "x" },
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

// Registers happy-dom globals (MouseEvent / PointerEvent / element style) so the
// handlers can be driven with real DOM event objects and a real token element.
import "../../../test-setup.ts";
import { describe, expect, test } from "bun:test";
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

// A minimal stand-in for the library's TokenEventBase token element: just the
// attribute + style surface the hover effect touches.
function fakeTokenElement() {
  const attrs = new Map<string, string>();
  const style: Record<string, string> = {};
  return {
    style,
    setAttribute: (k: string, v: string) => attrs.set(k, v),
    removeAttribute: (k: string) => attrs.delete(k),
    getAttribute: (k: string) => attrs.get(k) ?? null,
  } as unknown as HTMLElement & { style: Record<string, string> };
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
  test("enter sets the full URL as title and a pointer cursor on the token", () => {
    const handlers = createLinkHandlers(new Map([[1, [span(4, 12, "https://a.test/full")]]]), {
      openUrl: () => {},
    });
    const el = fakeTokenElement();
    handlers.onTokenEnter(
      { lineNumber: 1, lineCharStart: 4, lineCharEnd: 12, tokenText: "the docs", tokenElement: el },
      new PointerEvent("pointerenter"),
    );
    expect(el.getAttribute("title")).toBe("https://a.test/full");
    expect(el.style.cursor).toBe("pointer");
  });

  test("enter on a non-link token does not touch the element", () => {
    const handlers = createLinkHandlers(new Map([[1, [span(4, 12, "https://a.test")]]]), {
      openUrl: () => {},
    });
    const el = fakeTokenElement();
    handlers.onTokenEnter(
      { lineNumber: 1, lineCharStart: 0, lineCharEnd: 3, tokenText: "See", tokenElement: el },
      new PointerEvent("pointerenter"),
    );
    expect(el.getAttribute("title")).toBeNull();
    expect(el.style.cursor ?? "").toBe("");
  });

  test("leave clears the title and cursor it set", () => {
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
    handlers.onTokenLeave(props, new PointerEvent("pointerleave"));
    expect(el.getAttribute("title")).toBeNull();
    expect(el.style.cursor ?? "").toBe("");
  });
});

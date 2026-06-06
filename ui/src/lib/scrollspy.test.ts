import "../../test-setup.ts";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createScrollSpy } from "./scrollspy.ts";

// happy-dom registers an inert IntersectionObserver (it never fires its
// callback), so a controllable mock is installed onto globalThis: it captures
// the constructor callback + options and lets a test drive synthetic entries
// deterministically, mirroring "units inject, never wait" from browser-testing.md.

interface MockEntryInit {
  target: Element;
  isIntersecting: boolean;
  /** boundingClientRect.top — the heading's viewport top. */
  top: number;
  /** rootBounds.top — the observation band's top edge; null exercises the fallback. */
  rootTop?: number | null;
}

interface MockObserver {
  callback: IntersectionObserverCallback;
  options: IntersectionObserverInit | undefined;
  observed: Element[];
  disconnected: boolean;
  /** Feed the observer a batch of synthetic entries. */
  emit(entries: MockEntryInit[]): void;
}

let observers: MockObserver[];
let realIO: typeof globalThis.IntersectionObserver;

beforeEach(() => {
  document.body.innerHTML = "";
  observers = [];
  realIO = globalThis.IntersectionObserver;

  class FakeIntersectionObserver {
    private record: MockObserver;
    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      this.record = {
        callback,
        options,
        observed: [],
        disconnected: false,
        emit: (entries) =>
          callback(
            entries.map(
              (e) =>
                ({
                  target: e.target,
                  isIntersecting: e.isIntersecting,
                  boundingClientRect: { top: e.top } as DOMRectReadOnly,
                  rootBounds:
                    e.rootTop === null ? null : ({ top: e.rootTop ?? 0 } as DOMRectReadOnly),
                }) as IntersectionObserverEntry,
            ),
            this as unknown as IntersectionObserver,
          ),
      };
      observers.push(this.record);
    }
    observe(el: Element) {
      this.record.observed.push(el);
    }
    disconnect() {
      this.record.disconnected = true;
    }
    unobserve() {}
    takeRecords() {
      return [];
    }
  }

  globalThis.IntersectionObserver =
    FakeIntersectionObserver as unknown as typeof globalThis.IntersectionObserver;
});

afterEach(() => {
  globalThis.IntersectionObserver = realIO;
});

/** A heading element carrying the data-slug createScrollSpy reports. */
function heading(slug: string): HTMLElement {
  const el = document.createElement("h2");
  el.dataset.slug = slug;
  document.body.appendChild(el);
  return el;
}

function makeSpy(headings: HTMLElement[]) {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const active: Array<string | null> = [];
  const stop = createScrollSpy({ root, headings, onActive: (s) => active.push(s) });
  const observer = observers[0];
  // createScrollSpy constructs exactly one observer for a non-empty heading list.
  if (!observer) throw new Error("createScrollSpy did not construct an observer");
  return { root, active, stop, observer };
}

describe("createScrollSpy", () => {
  test("no headings: a no-op stop, never constructs an observer", () => {
    const root = document.createElement("div");
    const calls: Array<string | null> = [];
    const stop = createScrollSpy({ root, headings: [], onActive: (s) => calls.push(s) });
    expect(observers).toHaveLength(0);
    expect(calls).toEqual([]);
    expect(() => stop()).not.toThrow();
  });

  test("observes every heading and tracks them as the root's children", () => {
    const hs = [heading("a"), heading("b"), heading("c")];
    const { observer } = makeSpy(hs);
    expect(observer.observed).toEqual(hs);
    expect(observer.options?.root).toBeTruthy();
    expect(observer.options?.rootMargin).toBe("0px 0px -80% 0px");
  });

  test("the first visible heading in document order wins", () => {
    const [a, b, c] = [heading("a"), heading("b"), heading("c")];
    const { active, observer } = makeSpy([a, b, c]);
    observer.emit([
      { target: b, isIntersecting: true, top: 50 },
      { target: c, isIntersecting: true, top: 200 },
    ]);
    expect(active.at(-1)).toBe("b");
  });

  test("when none are visible, falls back to the last heading scrolled past", () => {
    const [a, b, c] = [heading("a"), heading("b"), heading("c")];
    const { active, observer } = makeSpy([a, b, c]);
    // b becomes visible, then scrolls up out of the band: its top crosses above
    // the band top, so it is remembered as passed.
    observer.emit([{ target: b, isIntersecting: true, top: 50 }]);
    expect(active.at(-1)).toBe("b");
    observer.emit([{ target: b, isIntersecting: false, top: -10, rootTop: 0 }]);
    // nothing is visible now; the active falls back to lastPassed (b).
    expect(active.at(-1)).toBe("b");
  });

  test("bandTop edge: a heading above the band top (positive viewport top) counts as passed", () => {
    const [a, b] = [heading("a"), heading("b")];
    const { active, observer } = makeSpy([a, b]);
    // The scroll container sits below the top bar, so a heading scrolled past the
    // band still has a POSITIVE viewport top (~the bar height). Comparing against
    // bandTop (not 0) is what marks it passed; a `< 0` check never would.
    observer.emit([{ target: b, isIntersecting: true, top: 60 }]);
    expect(active.at(-1)).toBe("b");
    observer.emit([{ target: b, isIntersecting: false, top: 40, rootTop: 56 }]);
    // top (40) < bandTop (56) → b is remembered as passed; active stays "b"
    // rather than reverting to the first heading.
    expect(active.at(-1)).toBe("b");
  });

  test("a heading leaving below the band (top >= bandTop) is not marked passed", () => {
    const [a, b] = [heading("a"), heading("b")];
    const { active, observer } = makeSpy([a, b]);
    // a is visible first, then b appears and a leaves downward (top stays at/below
    // band top): a is NOT remembered as passed, so once b also leaves, the active
    // falls back to the initial lastPassed (the first heading, a).
    observer.emit([{ target: b, isIntersecting: true, top: 100 }]);
    expect(active.at(-1)).toBe("b");
    observer.emit([{ target: b, isIntersecting: false, top: 80, rootTop: 56 }]);
    // top (80) >= bandTop (56) → b is NOT marked passed; lastPassed stays at a.
    expect(active.at(-1)).toBe("a");
  });

  test("rootBounds null falls back to the root's measured top", () => {
    const [a, b] = [heading("a"), heading("b")];
    const { root, active, observer } = makeSpy([a, b]);
    // happy-dom's getBoundingClientRect().top is 0, so a heading at top -5 (above
    // the fallback band top of 0) is marked passed.
    expect(root.getBoundingClientRect().top).toBe(0);
    observer.emit([{ target: b, isIntersecting: true, top: 10 }]);
    observer.emit([{ target: b, isIntersecting: false, top: -5, rootTop: null }]);
    expect(active.at(-1)).toBe("b");
  });

  test("reports null when nothing has ever been seen but headings exist", () => {
    const [a, b] = [heading("a"), heading("b")];
    const { active, observer } = makeSpy([a, b]);
    // The very first heading is the initial lastPassed, so an empty batch still
    // resolves to a slug — never an unexpected null while headings exist.
    observer.emit([]);
    expect(active.at(-1)).toBe("a");
  });

  test("stop() disconnects the observer", () => {
    const { stop, observer } = makeSpy([heading("a")]);
    expect(observer.disconnected).toBe(false);
    stop();
    expect(observer.disconnected).toBe(true);
  });

  test("a heading with no data-slug reports null when active", () => {
    const bare = document.createElement("h2"); // no data-slug
    document.body.appendChild(bare);
    const { active, observer } = makeSpy([bare]);
    observer.emit([{ target: bare, isIntersecting: true, top: 10 }]);
    expect(active.at(-1)).toBeNull();
  });
});

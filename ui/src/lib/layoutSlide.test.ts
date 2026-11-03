import "@ui/support/setup.ts";
import { describe, expect, test } from "bun:test";

import { type Box, type SlidePart, slideLayout, startOffsets } from "$lib/layoutSlide.ts";

const box = (left: number, top = 0, width = 100, height = 50): Box => ({
  left,
  top,
  width,
  height,
});

describe("startOffsets", () => {
  test("a part starts from where it stood", () => {
    expect(startOffsets([{ from: box(300, 10), to: box(60, 4) }])).toEqual([{ x: 240, y: 6 }]);
  });

  test("a part inside a sliding part starts from its own old place, less what it rides", () => {
    const [outer, inner] = startOffsets([
      { from: box(300), to: box(60) },
      { from: box(320), to: box(150), parent: 0 },
    ]);
    expect(outer).toEqual({ x: 240, y: 0 });
    expect(inner).toEqual({ x: -70, y: 0 });
  });

  test("a part new to the layout comes in from its enter offset", () => {
    expect(startOffsets([{ to: box(0, 0, 248), enter: (b) => ({ x: -b.width, y: 0 }) }])).toEqual([
      { x: -248, y: 0 },
    ]);
  });

  test("a part that stays put, or is new with no way in, does not slide", () => {
    expect(startOffsets([{ from: box(60.2), to: box(60) }, { to: box(60) }, null])).toEqual([
      null,
      null,
      null,
    ]);
  });
});

/** An element whose box `place` decides, measured as the browser would. */
function placed(place: (el: HTMLElement) => number): HTMLElement {
  const el = document.createElement("div");
  el.getBoundingClientRect = () => {
    const left = place(el);
    return { left, top: 0, width: 100, height: 50, right: left + 100, bottom: 50 } as DOMRect;
  };
  return el;
}

/** An element whose left edge and width `place` decides. */
function sized(place: () => { left: number; width: number }): HTMLElement {
  const el = document.createElement("div");
  el.getBoundingClientRect = () => {
    const { left, width } = place();
    return { left, top: 0, width, height: 50, right: left + width, bottom: 50 } as DOMRect;
  };
  return el;
}

const at = (dur: string) => ({ duration: () => dur });

describe("slideLayout", () => {
  test("hands each part its start offset and duration, then lets it go", () => {
    let moved = false;
    const el = placed(() => (moved ? 60 : 300));
    const part: SlidePart = { before: () => el, after: () => el };
    slideLayout([part], () => (moved = true), at("var(--dur-state)"), {
      prefersReducedMotion: () => false,
    });
    expect(el.style.getPropertyValue("--slide-x")).toBe("240px");
    expect(el.style.getPropertyValue("--slide-dur")).toBe("var(--dur-state)");
    expect(el.hasAttribute("data-slide-from")).toBe(false);
  });

  test("measures where the change puts a part with any slide it is in let go", () => {
    let moved = false;
    // Mid-slide, the part draws 30px off its place unless it is held at it.
    const el = placed((self) =>
      !moved
        ? 200
        : self.hasAttribute("data-slide-from") && self.style.getPropertyValue("--slide-x") === "0px"
          ? 60
          : 90,
    );
    slideLayout(
      [{ before: () => el, after: () => el }],
      () => (moved = true),
      at("var(--dur-pane)"),
      {
        prefersReducedMotion: () => false,
      },
    );
    expect(el.style.getPropertyValue("--slide-x")).toBe("140px");
  });

  test("an entering part takes its own duration", () => {
    let mounted: HTMLElement | null = null;
    const part: SlidePart = {
      before: () => mounted,
      after: () => mounted,
      enter: { from: (b) => ({ x: b.width, y: 0 }), duration: "var(--dur-pane)" },
    };
    slideLayout([part], () => (mounted = placed(() => 500)), at("var(--dur-state)"), {
      prefersReducedMotion: () => false,
    });
    const el = mounted as HTMLElement | null;
    expect(el?.style.getPropertyValue("--slide-x")).toBe("100px");
    expect(el?.style.getPropertyValue("--slide-dur")).toBe("var(--dur-pane)");
  });

  test("measures the layout it ends in while every part is held at its place", () => {
    let moved = false;
    const el = placed(() => (moved ? 60 : 300));
    let held = false;
    slideLayout(
      [{ before: () => el, after: () => el }],
      () => (moved = true),
      {
        ...at("var(--dur-state)"),
        measured: () => (held = el.hasAttribute("data-slide-from")),
      },
      { prefersReducedMotion: () => false },
    );
    expect(held).toBe(true);
  });

  test("a part that stretches starts from its old box, scaled to its old width", () => {
    let moved = false;
    const el = sized(() => (moved ? { left: 60, width: 100 } : { left: 300, width: 200 }));
    slideLayout(
      [{ before: () => el, after: () => el, stretches: "both" }],
      () => (moved = true),
      at("var(--dur-state)"),
      { prefersReducedMotion: () => false },
    );
    expect(el.style.getPropertyValue("--slide-x")).toBe("240px");
    expect(el.style.getPropertyValue("--slide-sx")).toBe("2");
  });

  test("a part that stretches from a start edge that holds still starts at its old width", () => {
    let moved = false;
    const el = sized(() => (moved ? { left: 60, width: 100 } : { left: 60, width: 200 }));
    slideLayout(
      [{ before: () => el, after: () => el, stretches: "both" }],
      () => (moved = true),
      at("var(--dur-state)"),
      { prefersReducedMotion: () => false },
    );
    expect(el.style.getPropertyValue("--slide-x")).toBe("0px");
    expect(el.style.getPropertyValue("--slide-sx")).toBe("2");
    expect(el.hasAttribute("data-slide-from")).toBe(false);
  });

  const part = (el: HTMLElement): SlidePart => ({ before: () => el, after: () => el });

  /** A stretching part that stood at `child`, inside a part that slides from 300–500 to
   * 100–200: both end at 100–200. */
  function nested(stretches: SlidePart["stretches"], child: { left: number; width: number }) {
    let moved = false;
    const outer = sized(() => (moved ? { left: 100, width: 100 } : { left: 300, width: 200 }));
    const inner = sized(() => (moved ? { left: 100, width: 100 } : child));
    outer.append(inner);
    slideLayout(
      [part(outer), { ...part(inner), stretches }],
      () => (moved = true),
      at("var(--dur-state)"),
      { prefersReducedMotion: () => false },
    );
    return inner;
  }

  test("a part that stretches from its start edge ends with the part it sits inside", () => {
    // It stood at 250–500; the outer part starts at 300–400, its new box carried 200px.
    const inner = nested("start", { left: 250, width: 250 });
    expect(inner.style.getPropertyValue("--slide-x")).toBe("-50px");
    expect(inner.style.getPropertyValue("--slide-sx")).toBe("1.5");
  });

  test("a part that stretches from its start edge, still in its place inside its part, takes its new width", () => {
    const inner = nested("start", { left: 300, width: 200 });
    expect(inner.style.getPropertyValue("--slide-sx")).toBe("1");
    expect(inner.hasAttribute("data-slide-from")).toBe(false);
  });

  test("a part that does not stretch slides at its new width", () => {
    let moved = false;
    const el = sized(() => (moved ? { left: 60, width: 100 } : { left: 300, width: 200 }));
    slideLayout(
      [{ before: () => el, after: () => el }],
      () => (moved = true),
      at("var(--dur-state)"),
      { prefersReducedMotion: () => false },
    );
    expect(el.style.getPropertyValue("--slide-x")).toBe("240px");
    expect(el.style.getPropertyValue("--slide-sx")).toBe("1");
  });

  test("applies the change and holds nothing under reduced motion, telling the change so", () => {
    let moved = false;
    let sliding: boolean | undefined;
    const el = placed(() => (moved ? 60 : 300));
    const change = (slides: boolean) => {
      moved = true;
      sliding = slides;
    };
    slideLayout([{ before: () => el, after: () => el }], change, at("var(--dur-state)"), {
      prefersReducedMotion: () => true,
    });
    expect(moved).toBe(true);
    expect(sliding).toBe(false);
    expect(el.style.getPropertyValue("--slide-x")).toBe("");
  });
});

import "@ui/test-mount.ts";
import { describe, expect, test } from "bun:test";

import { createRawSnippet } from "svelte";

import { capture, render } from "@ui/test-mount.ts";
import FileDrawer from "@/components/FileDrawer.svelte";
import { MIN_DRAWER_PX } from "$lib/fileDrawer.ts";

const children = createRawSnippet(() => ({
  render: () => `<p class="fd-probe">preview</p>`,
}));

function lane(target: HTMLElement): HTMLElement {
  return target.querySelector<HTMLElement>("[data-file-drawer]")!;
}

function handle(target: HTMLElement): HTMLElement {
  return target.querySelector<HTMLElement>("[role='separator']")!;
}

function press(target: HTMLElement, key: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  handle(target).dispatchEvent(event);
  return event;
}

describe("FileDrawer lane", () => {
  test("renders a labelled aside carrying its size as a custom property", () => {
    const { target } = render(FileDrawer, {
      edge: "right",
      size: 420,
      onResize: () => {},
      children,
    });
    const el = lane(target);
    expect(el.tagName).toBe("ASIDE");
    expect(el.getAttribute("aria-label")).toBe("File preview");
    expect(el.style.getPropertyValue("--fd-size")).toBe("420px");
  });

  test("marks the bottom edge with its own class and leaves the right edge unmarked", () => {
    const right = render(FileDrawer, { edge: "right", size: 420, onResize: () => {}, children });
    expect(lane(right.target).classList.contains("fd-bottom")).toBe(false);
    const bottom = render(FileDrawer, { edge: "bottom", size: 300, onResize: () => {}, children });
    expect(lane(bottom.target).classList.contains("fd-bottom")).toBe(true);
  });

  test("renders the children snippet inside the lane", () => {
    const { target } = render(FileDrawer, {
      edge: "right",
      size: 420,
      onResize: () => {},
      children,
    });
    expect(lane(target).querySelector(".fd-probe")).not.toBeNull();
  });
});

describe("FileDrawer resize handle", () => {
  test("is a focusable, labelled separator running along the docked edge", () => {
    const { target } = render(FileDrawer, {
      edge: "right",
      size: 420,
      onResize: () => {},
      children,
    });
    const el = handle(target);
    expect(el.getAttribute("aria-label")).toBe("Resize file preview");
    expect(el.getAttribute("tabindex")).toBe("0");
    expect(el.getAttribute("aria-orientation")).toBe("vertical");
  });

  test("turns horizontal when the drawer docks to the bottom", () => {
    const { target } = render(FileDrawer, {
      edge: "bottom",
      size: 300,
      onResize: () => {},
      children,
    });
    expect(handle(target).getAttribute("aria-orientation")).toBe("horizontal");
  });

  test("reports the drawer size and its floor as the separator's range", () => {
    const { target } = render(FileDrawer, {
      edge: "right",
      size: 420,
      onResize: () => {},
      children,
    });
    const el = handle(target);
    expect(el.getAttribute("aria-valuenow")).toBe("420");
    expect(el.getAttribute("aria-valuemin")).toBe(String(MIN_DRAWER_PX));
    // happy-dom has no layout, so the surface measures 0 and the upper bound
    // falls back to the current size rather than a value below it.
    expect(el.getAttribute("aria-valuemax")).toBe("420");
  });
});

// Direction (which arrow grows and which shrinks) needs real layout to observe,
// so it belongs to the e2e drag spec. What a unit can pin is the wiring: which
// keys are live on which edge, and that the result goes through the clamp —
// with an unmeasurable surface every request floors to MIN_DRAWER_PX.
describe("FileDrawer keyboard resize", () => {
  test("arrow keys along the right edge's axis resize through the clamp", () => {
    for (const key of ["ArrowLeft", "ArrowRight"]) {
      const resized = capture<number>();
      const { target } = render(FileDrawer, {
        edge: "right",
        size: 420,
        onResize: resized.cb,
        children,
      });
      press(target, key);
      expect(resized.last()).toBe(MIN_DRAWER_PX);
    }
  });

  test("arrow keys along the bottom edge's axis resize through the clamp", () => {
    for (const key of ["ArrowUp", "ArrowDown"]) {
      const resized = capture<number>();
      const { target } = render(FileDrawer, {
        edge: "bottom",
        size: 300,
        onResize: resized.cb,
        children,
      });
      press(target, key);
      expect(resized.last()).toBe(MIN_DRAWER_PX);
    }
  });

  test("ignores the keys of the other edge's axis", () => {
    const resized = capture<number>();
    const { target } = render(FileDrawer, {
      edge: "right",
      size: 420,
      onResize: resized.cb,
      children,
    });
    press(target, "ArrowUp");
    press(target, "ArrowDown");
    press(target, "Enter");
    expect(resized.last()).toBeUndefined();
  });

  test("swallows a key it handles and leaves the rest to the page", () => {
    const { target } = render(FileDrawer, {
      edge: "right",
      size: 420,
      onResize: () => {},
      children,
    });
    expect(press(target, "ArrowLeft").defaultPrevented).toBe(true);
    expect(press(target, "ArrowUp").defaultPrevented).toBe(false);
  });
});

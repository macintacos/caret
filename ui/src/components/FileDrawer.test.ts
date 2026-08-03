import "@ui/test-mount.ts";
import { describe, expect, test } from "bun:test";

import { createRawSnippet } from "svelte";

import { capture, render } from "@ui/test-mount.ts";
import FileDrawer from "@/components/FileDrawer.svelte";
import { MIN_DRAWER_PX, maxDrawerSize } from "$lib/fileDrawer.ts";

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
      available: 1200,
      onResize: () => {},
      children,
    });
    const el = lane(target);
    expect(el.tagName).toBe("ASIDE");
    expect(el.getAttribute("aria-label")).toBe("File preview");
    expect(el.style.getPropertyValue("--fd-size")).toBe("420px");
  });

  test("marks the bottom edge with its own class and leaves the right edge unmarked", () => {
    const right = render(FileDrawer, {
      edge: "right",
      size: 420,
      available: 1200,
      onResize: () => {},
      children,
    });
    expect(lane(right.target).classList.contains("fd-bottom")).toBe(false);
    const bottom = render(FileDrawer, {
      edge: "bottom",
      size: 300,
      available: 900,
      onResize: () => {},
      children,
    });
    expect(lane(bottom.target).classList.contains("fd-bottom")).toBe(true);
  });

  test("marks the lane while it plays its closing wipe, and not before", () => {
    const open = render(FileDrawer, {
      edge: "right",
      size: 420,
      available: 1200,
      onResize: () => {},
      children,
    });
    expect(lane(open.target).classList.contains("fd-closing")).toBe(false);
    const closing = render(FileDrawer, {
      edge: "right",
      size: 420,
      available: 1200,
      closing: true,
      onResize: () => {},
      children,
    });
    expect(lane(closing.target).classList.contains("fd-closing")).toBe(true);
    // The excerpt stays rendered on the way out — the pane slides shut with its
    // contents, it does not empty first.
    expect(lane(closing.target).querySelector(".fd-probe")).not.toBeNull();
  });

  test("renders the children snippet inside the lane", () => {
    const { target } = render(FileDrawer, {
      edge: "right",
      size: 420,
      available: 1200,
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
      available: 1200,
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
      available: 900,
      onResize: () => {},
      children,
    });
    expect(handle(target).getAttribute("aria-orientation")).toBe("horizontal");
  });

  test("reports the drawer size and its floor as the separator's range", () => {
    const { target } = render(FileDrawer, {
      edge: "right",
      size: 420,
      available: 1200,
      onResize: () => {},
      children,
    });
    const el = handle(target);
    expect(el.getAttribute("aria-valuenow")).toBe("420");
    expect(el.getAttribute("aria-valuemin")).toBe(String(MIN_DRAWER_PX));
    // The bound reported is the bound enforced — both come from maxDrawerSize.
    expect(el.getAttribute("aria-valuemax")).toBe(String(maxDrawerSize(1200)));
    // A bare number announces as "420"; the unit belongs in valuetext.
    expect(el.getAttribute("aria-valuetext")).toBe("420 pixels");
  });
});

// The lane's available axis is a prop, so the whole keyboard interaction — which
// keys are live on which edge, which direction each moves the lane, and that the
// result goes through the clamp — is pure and needs no browser.
describe("FileDrawer keyboard resize", () => {
  function pressOn(
    props: { edge: "right" | "bottom"; size: number; available: number },
    key: string,
  ): number | undefined {
    const resized = capture<number>();
    const { target } = render(FileDrawer, { ...props, onResize: resized.cb, children });
    press(target, key);
    return resized.last();
  }

  test("on the right edge, the key pointing away from the dock grows the lane", () => {
    const props = { edge: "right", size: 420, available: 1200 } as const;
    expect(pressOn(props, "ArrowLeft")).toBe(444);
    expect(pressOn(props, "ArrowRight")).toBe(396);
  });

  test("on the bottom edge, the key pointing away from the dock grows the lane", () => {
    const props = { edge: "bottom", size: 300, available: 900 } as const;
    expect(pressOn(props, "ArrowUp")).toBe(324);
    expect(pressOn(props, "ArrowDown")).toBe(276);
  });

  test("a step is clamped rather than shrinking the lane past its floor", () => {
    expect(pressOn({ edge: "right", size: MIN_DRAWER_PX, available: 1200 }, "ArrowRight")).toBe(
      MIN_DRAWER_PX,
    );
  });

  test("a step is clamped rather than squeezing the plan past its minimum", () => {
    const max = maxDrawerSize(1200);
    expect(pressOn({ edge: "right", size: max, available: 1200 }, "ArrowLeft")).toBe(max);
  });

  test("ignores the keys of the other edge's axis", () => {
    const resized = capture<number>();
    const { target } = render(FileDrawer, {
      edge: "right",
      size: 420,
      available: 1200,
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
      available: 1200,
      onResize: () => {},
      children,
    });
    expect(press(target, "ArrowLeft").defaultPrevented).toBe(true);
    expect(press(target, "ArrowUp").defaultPrevented).toBe(false);
  });
});

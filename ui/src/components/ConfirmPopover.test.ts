import "../../test-mount.ts";

import { describe, expect, test } from "bun:test";
import { render } from "../../test-mount.ts";
import ConfirmPopover from "./ConfirmPopover.svelte";

const baseProps = {
  question: "Discard this comment?",
  confirmLabel: "Discard",
  onConfirm: () => {},
  onCancel: () => {},
};

const popover = (target: HTMLElement) => target.querySelector(".confirm-popover") as HTMLElement;
const confirmBtn = (target: HTMLElement) => target.querySelector(".confirm") as HTMLElement;
const cancelBtn = (target: HTMLElement) => target.querySelector(".cancel") as HTMLElement;

describe("ConfirmPopover render", () => {
  test("shows the question and both button labels", () => {
    const { target } = render(ConfirmPopover, {
      ...baseProps,
      cancelLabel: "Keep editing",
    });
    expect(target.textContent).toContain("Discard this comment?");
    expect(confirmBtn(target).textContent?.trim()).toBe("Discard");
    expect(cancelBtn(target).textContent?.trim()).toBe("Keep editing");
  });

  test("defaults the cancel label to Cancel", () => {
    const { target } = render(ConfirmPopover, baseProps);
    expect(cancelBtn(target).textContent?.trim()).toBe("Cancel");
  });

  test("is an alertdialog labelled by the question", () => {
    const { target } = render(ConfirmPopover, baseProps);
    // alertdialog: it announces an irreversible consequence to assistive tech.
    expect(popover(target).getAttribute("role")).toBe("alertdialog");
    expect(popover(target).getAttribute("aria-label")).toBe("Discard this comment?");
  });
});

describe("ConfirmPopover wiring", () => {
  test("clicking confirm fires onConfirm only", () => {
    let confirmed = false;
    let cancelled = false;
    const { target } = render(ConfirmPopover, {
      ...baseProps,
      onConfirm: () => {
        confirmed = true;
      },
      onCancel: () => {
        cancelled = true;
      },
    });
    confirmBtn(target).click();
    expect(confirmed).toBe(true);
    expect(cancelled).toBe(false);
  });

  test("clicking cancel fires onCancel only", () => {
    let confirmed = false;
    let cancelled = false;
    const { target } = render(ConfirmPopover, {
      ...baseProps,
      onConfirm: () => {
        confirmed = true;
      },
      onCancel: () => {
        cancelled = true;
      },
    });
    cancelBtn(target).click();
    expect(cancelled).toBe(true);
    expect(confirmed).toBe(false);
  });
});

// When an `anchor` is passed, the bubble portals to document.body and positions
// itself with fixed coordinates against that element, so it escapes an ancestor's
// overflow (a scrollable modal body) and stays inside the viewport (EXC-762). With
// no anchor it stays in-flow under its trigger — the composer/card behaviour.
describe("ConfirmPopover anchored (portal + viewport-aware)", () => {
  test("stays in the render target when no anchor is given", () => {
    const { target } = render(ConfirmPopover, baseProps);
    expect(popover(target)).not.toBeNull();
  });

  test("portals to document.body and fixes its position when anchored", () => {
    const anchor = document.createElement("button");
    const { target, flush } = render(ConfirmPopover, { ...baseProps, anchor });
    flush();
    // Moved out of the mount target, up to document.body, so no ancestor overflow
    // can clip it.
    expect(popover(target)).toBeNull();
    const bubble = document.body.querySelector(".confirm-popover") as HTMLElement;
    expect(bubble).not.toBeNull();
    expect(bubble.parentElement).toBe(document.body);
    expect(bubble.style.position).toBe("fixed");
  });
});

describe("ConfirmPopover keyboard", () => {
  test("Escape fires onCancel", () => {
    let cancelled = false;
    const { target } = render(ConfirmPopover, {
      ...baseProps,
      onCancel: () => {
        cancelled = true;
      },
    });
    popover(target).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(cancelled).toBe(true);
  });
});

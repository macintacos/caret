import "../../test-mount.ts";

import { describe, expect, test } from "bun:test";
import { render } from "../../test-mount.ts";
import ApproveConfirmDialog from "./ApproveConfirmDialog.svelte";

const baseProps = {
  count: 2,
  onApproveAnyway: () => {},
  onRequestChanges: () => {},
  onCancel: () => {},
};

function dialog(target: HTMLElement) {
  return target.querySelector(".dialog") as HTMLElement;
}

describe("ApproveConfirmDialog render", () => {
  test("names the pending count, pluralized", () => {
    const { target } = render(ApproveConfirmDialog, { ...baseProps, count: 2 });
    expect(target.querySelector(".body")!.textContent).toContain("2 pending comments");
  });

  test("singularizes the count for one pending comment", () => {
    const { target } = render(ApproveConfirmDialog, { ...baseProps, count: 1 });
    expect(target.querySelector(".body")!.textContent).toContain("1 pending comment");
    expect(target.querySelector(".body")!.textContent).not.toContain("1 pending comments");
  });
});

describe("ApproveConfirmDialog wiring", () => {
  test("clicking 'Approve anyway' fires onApproveAnyway", () => {
    let called = false;
    const { target } = render(ApproveConfirmDialog, {
      ...baseProps,
      onApproveAnyway: () => {
        called = true;
      },
    });
    (target.querySelector(".approve-anyway") as HTMLElement).click();
    expect(called).toBe(true);
  });

  test("clicking the request-changes route fires onRequestChanges", () => {
    let routed = false;
    const { target } = render(ApproveConfirmDialog, {
      ...baseProps,
      onRequestChanges: () => {
        routed = true;
      },
    });
    (target.querySelector(".to-request") as HTMLElement).click();
    expect(routed).toBe(true);
  });

  test("clicking Cancel fires onCancel", () => {
    let cancelled = false;
    const { target } = render(ApproveConfirmDialog, {
      ...baseProps,
      onCancel: () => {
        cancelled = true;
      },
    });
    (target.querySelector(".ghost") as HTMLElement).click();
    expect(cancelled).toBe(true);
  });

  test("clicking the scrim backdrop cancels", () => {
    let cancelled = false;
    const { target } = render(ApproveConfirmDialog, {
      ...baseProps,
      onCancel: () => {
        cancelled = true;
      },
    });
    (target.querySelector(".scrim") as HTMLElement).click();
    expect(cancelled).toBe(true);
  });
});

describe("ApproveConfirmDialog keyboard", () => {
  test("Escape cancels", () => {
    let cancelled = false;
    const { target } = render(ApproveConfirmDialog, {
      ...baseProps,
      onCancel: () => {
        cancelled = true;
      },
    });
    dialog(target).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(cancelled).toBe(true);
  });

  test("Enter confirms the primary (approve anyway)", () => {
    let approved = false;
    const { target } = render(ApproveConfirmDialog, {
      ...baseProps,
      onApproveAnyway: () => {
        approved = true;
      },
    });
    dialog(target).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(approved).toBe(true);
  });
});

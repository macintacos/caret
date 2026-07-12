import "../../test-mount.ts";

import { describe, expect, test } from "bun:test";
import { render } from "../../test-mount.ts";
import UnsentCommentsDialog from "./UnsentCommentsDialog.svelte";

const approveProps = {
  count: 2,
  action: "Approve",
  consequence: "Approving accepts the plan and leaves them behind.",
  icon: "check" as const,
  onConfirm: () => {},
  onRequestChanges: () => {},
  onCancel: () => {},
};

const rejectProps = {
  count: 2,
  action: "Reject",
  consequence: "Rejecting sends only a brief note and leaves them behind.",
  onConfirm: () => {},
  onRequestChanges: () => {},
  onCancel: () => {},
};

function dialog(target: HTMLElement) {
  return target.querySelector(".dialog") as HTMLElement;
}

describe("UnsentCommentsDialog render", () => {
  test("names the pending count, pluralized", () => {
    const { target } = render(UnsentCommentsDialog, { ...approveProps, count: 2 });
    expect(target.querySelector(".body")!.textContent).toContain("2 pending comments");
  });

  test("singularizes the count for one pending comment", () => {
    const { target } = render(UnsentCommentsDialog, { ...approveProps, count: 1 });
    expect(target.querySelector(".body")!.textContent).toContain("1 pending comment");
    expect(target.querySelector(".body")!.textContent).not.toContain("1 pending comments");
  });

  test("the Approve variant reads with the approve vocabulary and accessible names", () => {
    const { target } = render(UnsentCommentsDialog, approveProps);
    expect(dialog(target).getAttribute("aria-label")).toBe("Approve with pending comments");
    expect(target.querySelector("h2")!.textContent).toContain("Approve without sending");
    expect(target.querySelector(".confirm")!.textContent).toContain("Approve anyway");
    expect(target.querySelector(".body")!.textContent).toContain(
      "Approving accepts the plan and leaves them behind.",
    );
  });

  test("the Reject variant swaps in the reject vocabulary and accessible names", () => {
    const { target } = render(UnsentCommentsDialog, rejectProps);
    expect(dialog(target).getAttribute("aria-label")).toBe("Reject with pending comments");
    expect(target.querySelector("h2")!.textContent).toContain("Reject without sending");
    expect(target.querySelector(".confirm")!.textContent).toContain("Reject anyway");
    expect(target.querySelector(".body")!.textContent).toContain(
      "Rejecting sends only a brief note and leaves them behind.",
    );
  });
});

describe("UnsentCommentsDialog wiring", () => {
  test("clicking the confirm button fires onConfirm", () => {
    let called = false;
    const { target } = render(UnsentCommentsDialog, {
      ...approveProps,
      onConfirm: () => {
        called = true;
      },
    });
    (target.querySelector(".confirm") as HTMLElement).click();
    expect(called).toBe(true);
  });

  test("clicking the request-changes route fires onRequestChanges", () => {
    let routed = false;
    const { target } = render(UnsentCommentsDialog, {
      ...approveProps,
      onRequestChanges: () => {
        routed = true;
      },
    });
    (target.querySelector(".to-request") as HTMLElement).click();
    expect(routed).toBe(true);
  });

  test("clicking Cancel fires onCancel", () => {
    let cancelled = false;
    const { target } = render(UnsentCommentsDialog, {
      ...approveProps,
      onCancel: () => {
        cancelled = true;
      },
    });
    (target.querySelector(".ghost") as HTMLElement).click();
    expect(cancelled).toBe(true);
  });

  test("clicking the scrim backdrop cancels", () => {
    let cancelled = false;
    const { target } = render(UnsentCommentsDialog, {
      ...approveProps,
      onCancel: () => {
        cancelled = true;
      },
    });
    (target.querySelector(".scrim") as HTMLElement).click();
    expect(cancelled).toBe(true);
  });
});

describe("UnsentCommentsDialog keyboard", () => {
  test("Escape cancels", () => {
    let cancelled = false;
    const { target } = render(UnsentCommentsDialog, {
      ...approveProps,
      onCancel: () => {
        cancelled = true;
      },
    });
    dialog(target).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(cancelled).toBe(true);
  });

  test("Enter confirms the primary action", () => {
    let confirmed = false;
    const { target } = render(UnsentCommentsDialog, {
      ...approveProps,
      onConfirm: () => {
        confirmed = true;
      },
    });
    dialog(target).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(confirmed).toBe(true);
  });
});

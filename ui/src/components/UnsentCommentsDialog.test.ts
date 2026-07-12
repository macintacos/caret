import "../../test-mount.ts";

import { describe, expect, test } from "bun:test";
import { render } from "../../test-mount.ts";
import UnsentCommentsDialog from "./UnsentCommentsDialog.svelte";

const twoItems = [
  { label: "General", text: "reconsider the rollout" },
  { label: "Line 7", text: "explain the cold cost" },
];

const approveProps = {
  items: twoItems,
  action: "Approve",
  consequence: "Approving accepts the plan and starts the agent's work.",
  icon: "check" as const,
  onConfirm: () => {},
  onRequestChanges: () => {},
  onCancel: () => {},
};

const rejectProps = {
  items: twoItems,
  action: "Reject",
  consequence: "The agent will be told the plan was rejected and to wait.",
  onConfirm: () => {},
  onRequestChanges: () => {},
  onCancel: () => {},
};

function dialog(target: HTMLElement) {
  return target.querySelector(".dialog") as HTMLElement;
}

describe("UnsentCommentsDialog render", () => {
  test("names the pending count, pluralized", () => {
    const { target } = render(UnsentCommentsDialog, approveProps);
    expect(target.querySelector(".body")!.textContent).toContain("2 pending comments");
  });

  test("singularizes the count for one pending comment", () => {
    const { target } = render(UnsentCommentsDialog, {
      ...approveProps,
      items: [{ label: "Line 3", text: "tighten" }],
    });
    expect(target.querySelector(".body")!.textContent).toContain("1 pending comment");
    expect(target.querySelector(".body")!.textContent).not.toContain("1 pending comments");
  });

  test("previews each pending comment's label and text", () => {
    const { target } = render(UnsentCommentsDialog, approveProps);
    const rows = target.querySelectorAll(".comments .comment");
    expect(rows.length).toBe(2);
    const preview = target.querySelector(".comments")!.textContent!;
    expect(preview).toContain("General");
    expect(preview).toContain("reconsider the rollout");
    expect(preview).toContain("Line 7");
    expect(preview).toContain("explain the cold cost");
  });

  test("the Approve variant reads with the approve vocabulary and accessible names", () => {
    const { target } = render(UnsentCommentsDialog, approveProps);
    expect(dialog(target).getAttribute("aria-label")).toBe("Approve with pending comments");
    expect(target.querySelector("h2")!.textContent).toContain("Approve this plan?");
    expect(target.querySelector(".confirm")!.textContent).toContain("Approve anyway");
    expect(target.querySelector(".body")!.textContent).toContain(
      "Approving accepts the plan and starts the agent's work.",
    );
  });

  test("the Reject variant swaps in the reject vocabulary and accessible names", () => {
    const { target } = render(UnsentCommentsDialog, rejectProps);
    expect(dialog(target).getAttribute("aria-label")).toBe("Reject with pending comments");
    expect(target.querySelector("h2")!.textContent).toContain("Reject this plan?");
    expect(target.querySelector(".confirm")!.textContent).toContain("Reject anyway");
    expect(target.querySelector(".body")!.textContent).toContain(
      "The agent will be told the plan was rejected and to wait.",
    );
  });

  test("with no pending comments it is a plain confirm — no warning, no preview, no divert, no 'anyway'", () => {
    const { target } = render(UnsentCommentsDialog, { ...rejectProps, items: [] });
    // A bare confirmation: distinct label, no comments warning, no preview list, no
    // Request-changes divert, and the confirm button drops the "anyway" qualifier.
    expect(dialog(target).getAttribute("aria-label")).toBe("Reject this plan");
    expect(target.querySelector(".body")!.textContent).not.toContain("pending comment");
    expect(target.querySelector(".comments")).toBeNull();
    expect(target.querySelector(".to-request")).toBeNull();
    expect(target.querySelector(".confirm")!.textContent).toContain("Reject");
    expect(target.querySelector(".confirm")!.textContent).not.toContain("anyway");
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

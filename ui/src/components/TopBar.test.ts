import "../../test-mount.ts";
import { describe, expect, test } from "bun:test";
import type { ApproveVariant, ClientReview } from "@core/types";
import { capture, render } from "../../test-mount.ts";
import TopBar from "./TopBar.svelte";

const variants: ApproveVariant[] = [
  { id: "default", label: "Approve", description: "Approve edits manually" },
  { id: "acceptEdits", label: "Approve & accept edits", description: "Auto-accept edits" },
  { id: "auto", label: "Approve & auto mode", description: "Full auto mode" },
];

const review = (id: string, title: string): ClientReview =>
  ({ id, title, cwd: "/home/u/proj/app", version: 1 }) as ClientReview;

const baseProps = {
  reviews: [review("r1", "Plan A")],
  active: review("r1", "Plan A"),
  busy: false,
  approveMode: "default" as const,
  variants,
  pendingCount: 0,
  onSelect: () => {},
  onApprove: () => {},
  onRequestChanges: () => {},
  onReject: () => {},
  onOpenSettings: () => {},
};

describe("TopBar render", () => {
  test("renders the brand and, with an active review, the action buttons", () => {
    const { target } = render(TopBar, baseProps);
    expect(target.querySelector(".brand")!.textContent).toContain("caret");
    expect(target.querySelector(".request")).not.toBeNull();
    expect(target.querySelector(".approve")).not.toBeNull();
  });

  test("with no active review, hides the actions but keeps the bell slot", () => {
    const { target } = render(TopBar, { ...baseProps, active: null });
    expect(target.querySelector(".actions")).toBeNull();
    expect(target.querySelector(".bell-slot")).not.toBeNull();
  });

  test("renders a settings gear that opens settings on click", () => {
    let opened = false;
    const { target } = render(TopBar, {
      ...baseProps,
      onOpenSettings: () => {
        opened = true;
      },
    });
    const gear = target.querySelector(".settings") as HTMLButtonElement;
    expect(gear).not.toBeNull();
    expect(gear.getAttribute("aria-label")).toBe("Settings");
    gear.click();
    expect(opened).toBe(true);
  });

  test("the settings gear stays visible with no active review", () => {
    // Settings is persistent chrome, like the bell — reachable before any plan lands.
    const { target } = render(TopBar, { ...baseProps, active: null });
    expect(target.querySelector(".settings")).not.toBeNull();
  });

  test("the primary approve button shows the remembered variant's label", () => {
    const { target } = render(TopBar, { ...baseProps, approveMode: "auto" });
    expect(target.querySelector(".approve")!.textContent).toContain("Approve & auto mode");
  });

  test("busy disables the buttons and dims the actions", () => {
    const { target } = render(TopBar, { ...baseProps, busy: true });
    expect(target.querySelector(".actions")!.classList.contains("busy")).toBe(true);
    expect((target.querySelector(".approve") as HTMLButtonElement).disabled).toBe(true);
    expect((target.querySelector(".request") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("TopBar approve split-button", () => {
  test("primary click approves with the remembered mode", () => {
    const approved = capture<string>();
    const { target } = render(TopBar, {
      ...baseProps,
      approveMode: "acceptEdits",
      onApprove: approved.cb,
    });
    (target.querySelector(".approve") as HTMLElement).click();
    expect(approved.last()).toBe("acceptEdits");
  });

  test("the toggle opens and closes the variants menu", () => {
    const { target, flush } = render(TopBar, baseProps);
    const toggle = target.querySelector(".split-toggle") as HTMLElement;
    expect(target.querySelector(".menu")).toBeNull();
    toggle.click();
    flush();
    const menu = target.querySelector(".menu")!;
    expect(menu).not.toBeNull();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(menu.querySelectorAll('[role="menuitem"]')).toHaveLength(3);
    toggle.click();
    flush();
    expect(target.querySelector(".menu")).toBeNull();
  });

  test("choosing a menu variant approves with that id and closes the menu", () => {
    const approved = capture<string>();
    const { target, flush } = render(TopBar, {
      ...baseProps,
      onApprove: approved.cb,
    });
    (target.querySelector(".split-toggle") as HTMLElement).click();
    flush();
    const items = target.querySelectorAll('[role="menuitem"]');
    (items[2] as HTMLElement).click();
    flush();
    expect(approved.last()).toBe("auto");
    expect(target.querySelector(".menu")).toBeNull();
  });

  test("renders each variant's label and description in the menu", () => {
    const { target, flush } = render(TopBar, baseProps);
    (target.querySelector(".split-toggle") as HTMLElement).click();
    flush();
    const labels = [...target.querySelectorAll(".v-label")].map((n) => n.textContent);
    expect(labels).toEqual(["Approve", "Approve & accept edits", "Approve & auto mode"]);
    expect(target.querySelector(".v-note")!.textContent).toBe("Approve edits manually");
  });

  test("the click-away scrim closes an open menu", () => {
    const { target, flush } = render(TopBar, baseProps);
    (target.querySelector(".split-toggle") as HTMLElement).click();
    flush();
    (target.querySelector(".scrim-invisible") as HTMLElement).click();
    flush();
    expect(target.querySelector(".menu")).toBeNull();
  });

  test("Escape closes an open menu", () => {
    const { target, flush } = render(TopBar, baseProps);
    (target.querySelector(".split-toggle") as HTMLElement).click();
    flush();
    expect(target.querySelector(".menu")).not.toBeNull();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    flush();
    expect(target.querySelector(".menu")).toBeNull();
  });
});

describe("TopBar dev badge", () => {
  test("hides the local-build badge by default", () => {
    const { target } = render(TopBar, baseProps);
    expect(target.querySelector(".dev-badge")).toBeNull();
  });

  test("shows the local-build badge when isDev is set", () => {
    const { target } = render(TopBar, { ...baseProps, isDev: true });
    expect(target.querySelector(".dev-badge")).not.toBeNull();
  });

  test("shows the local-build badge even with no active review", () => {
    const { target } = render(TopBar, { ...baseProps, active: null, isDev: true });
    expect(target.querySelector(".dev-badge")).not.toBeNull();
  });
});

describe("TopBar request changes", () => {
  test("the request button fires onRequestChanges", () => {
    let requested = false;
    const { target } = render(TopBar, {
      ...baseProps,
      onRequestChanges: () => (requested = true),
    });
    (target.querySelector(".request") as HTMLElement).click();
    expect(requested).toBe(true);
  });

  test("hides the pending-comment count when none are pending", () => {
    const { target } = render(TopBar, { ...baseProps, pendingCount: 0 });
    expect(target.querySelector(".request .count")).toBeNull();
  });

  test("shows the pending-comment count on the request button when comments are pending", () => {
    const { target } = render(TopBar, { ...baseProps, pendingCount: 3 });
    const count = target.querySelector(".request .count");
    expect(count).not.toBeNull();
    expect(count!.textContent).toContain("3");
  });

  test("the count carries the metric atom for tabular figures", () => {
    const { target } = render(TopBar, { ...baseProps, pendingCount: 2 });
    expect(target.querySelector(".request .count")!.classList.contains("metric")).toBe(true);
  });

  test("the count is hidden when no review is active", () => {
    const { target } = render(TopBar, { ...baseProps, active: null, pendingCount: 4 });
    expect(target.querySelector(".count")).toBeNull();
  });
});

describe("TopBar reject", () => {
  test("renders a Reject button when a review is active", () => {
    const { target } = render(TopBar, baseProps);
    const reject = target.querySelector(".reject");
    expect(reject).not.toBeNull();
    expect(reject!.textContent).toContain("Reject");
  });

  test("the reject button fires onReject", () => {
    let rejected = false;
    const { target } = render(TopBar, {
      ...baseProps,
      onReject: () => (rejected = true),
    });
    (target.querySelector(".reject") as HTMLElement).click();
    expect(rejected).toBe(true);
  });

  test("busy disables the reject button", () => {
    const { target } = render(TopBar, { ...baseProps, busy: true });
    expect((target.querySelector(".reject") as HTMLButtonElement).disabled).toBe(true);
  });

  test("hides the reject button when no review is active", () => {
    const { target } = render(TopBar, { ...baseProps, active: null });
    expect(target.querySelector(".reject")).toBeNull();
  });
});

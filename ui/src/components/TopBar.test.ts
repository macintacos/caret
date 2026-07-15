import "../../test-mount.ts";
import { describe, expect, test } from "bun:test";
import type { ApproveVariant, ClientReview } from "@core/lib/types";
import { capture, render } from "../../test-mount.ts";
import TopBar from "./TopBar.svelte";

// EXC-760: the TopBar is rebuilt on shadcn primitives (Button / Badge /
// DropdownMenu / Tooltip / Separator). This suite covers the synchronous
// surface — which buttons render, their labels, the pending-count Badge, and
// callback wiring. The approve split-button's DropdownMenu is bits-ui overlay
// interaction (open on click, pick a variant, Escape, outside-click), so it
// lives in test/e2e/approve-options.e2e.ts per doc/agents/browser-testing.md.

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
    expect(target.querySelector(".split-primary")).not.toBeNull();
    // The split toggle is a distinct control from the primary approve.
    const toggle = target.querySelector(".split-toggle") as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute("aria-label")).toBe("Approve options");
  });

  test("with no active review, hides actions but keeps the bell slot", () => {
    const { target } = render(TopBar, { ...baseProps, active: null });
    expect(target.querySelector(".actions")).toBeNull();
    expect(target.querySelector(".bell-slot")).not.toBeNull();
  });

  test("renders a settings gear that opens settings on click", () => {
    let opened = false;
    const { target } = render(TopBar, { ...baseProps, onOpenSettings: () => (opened = true) });
    const gear = target.querySelector(".settings") as HTMLButtonElement;
    expect(gear).not.toBeNull();
    expect(gear.getAttribute("aria-label")).toBe("Settings");
    gear.click();
    expect(opened).toBe(true);
  });

  test("keeps the settings gear reachable with no active review", () => {
    const { target } = render(TopBar, { ...baseProps, active: null });
    expect(target.querySelector(".settings")).not.toBeNull();
  });

  test("the primary approve button reflects the remembered mode's label", () => {
    const { target } = render(TopBar, { ...baseProps, approveMode: "auto" });
    expect(target.querySelector(".split-primary")!.textContent).toContain("Approve & auto mode");
  });

  test("busy disables the buttons and marks the actions row", () => {
    const { target } = render(TopBar, { ...baseProps, busy: true });
    expect(target.querySelector(".actions")!.classList.contains("busy")).toBe(true);
    expect((target.querySelector(".split-primary") as HTMLButtonElement).disabled).toBe(true);
    expect((target.querySelector(".request") as HTMLButtonElement).disabled).toBe(true);
    expect((target.querySelector(".split-toggle") as HTMLButtonElement).disabled).toBe(true);
  });

  test("the primary approve button approves in the remembered mode", () => {
    const approved = capture<string>();
    const { target } = render(TopBar, {
      ...baseProps,
      approveMode: "acceptEdits",
      onApprove: approved.cb,
    });
    (target.querySelector(".split-primary") as HTMLElement).click();
    expect(approved.last()).toBe("acceptEdits");
  });
});

describe("TopBar single-variant approve (EXC-791)", () => {
  // OpenCode declares a single approve variant, so its approve is binary — a
  // plain button rather than a split-button with a variant dropdown.
  const oneVariant: ApproveVariant[] = [{ id: "default", label: "Approve" }];

  test("renders a plain approve button (no split toggle) for a single variant", () => {
    const { target } = render(TopBar, { ...baseProps, variants: oneVariant });
    const approve = target.querySelector(".approve");
    expect(approve).not.toBeNull();
    expect(approve!.textContent).toContain("Approve");
    // No split-button parts: nothing to choose between.
    expect(target.querySelector(".split-toggle")).toBeNull();
    expect(target.querySelector(".split-primary")).toBeNull();
  });

  test("the plain approve button approves in the remembered mode", () => {
    const approved = capture<string>();
    const { target } = render(TopBar, {
      ...baseProps,
      variants: oneVariant,
      approveMode: "default",
      onApprove: approved.cb,
    });
    (target.querySelector(".approve") as HTMLElement).click();
    expect(approved.last()).toBe("default");
  });

  test("busy disables the plain approve button", () => {
    const { target } = render(TopBar, { ...baseProps, variants: oneVariant, busy: true });
    expect((target.querySelector(".approve") as HTMLButtonElement).disabled).toBe(true);
  });

  test("keeps the split-button when multiple variants are offered", () => {
    const { target } = render(TopBar, baseProps);
    expect(target.querySelector(".split-toggle")).not.toBeNull();
    expect(target.querySelector(".approve")).toBeNull();
  });

  test("publishes the active adapter source as a data attribute on the topbar", () => {
    const { target } = render(TopBar, { ...baseProps, source: "opencode" });
    expect(target.querySelector(".topbar")!.getAttribute("data-source")).toBe("opencode");
  });

  test("omits the source attribute when none is provided", () => {
    const { target } = render(TopBar, baseProps);
    expect(target.querySelector(".topbar")!.hasAttribute("data-source")).toBe(false);
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
});

describe("TopBar reject", () => {
  test("renders a reject button", () => {
    const { target } = render(TopBar, baseProps);
    expect(target.querySelector(".reject")).not.toBeNull();
  });

  test("the reject button fires onReject", () => {
    let rejected = false;
    const { target } = render(TopBar, { ...baseProps, onReject: () => (rejected = true) });
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

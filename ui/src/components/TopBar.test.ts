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
  onSelect: () => {},
  onApprove: () => {},
  onRequestChanges: () => {},
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
});

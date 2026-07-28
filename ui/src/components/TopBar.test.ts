import "@ui/test-mount.ts";
import { describe, expect, test } from "bun:test";

import type { ApproveVariant, ClientReview } from "@core/lib/types";
import { capture, render } from "@ui/test-mount.ts";
import TopBar from "@/components/TopBar.svelte";
import { ariaKeyshortcutsFor } from "$lib/shortcuts/index.ts";

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
  showShortcutHints: true,
};

describe("TopBar render", () => {
  // EXC-807: the working-directory path moved out of the header into the compare
  // row, so the topbar no longer renders it.
  test("does not render the working-directory path", () => {
    const { target } = render(TopBar, baseProps);
    expect(target.querySelector(".context")).toBeNull();
    expect(target.textContent).not.toContain("/home/u/proj/app");
  });

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

  test("shows inline key-cap hints by default, hides them when shortcut hints are off", () => {
    const on = render(TopBar, baseProps);
    expect(on.target.querySelectorAll("[data-slot='kbd']").length).toBeGreaterThan(0);
    const off = render(TopBar, { ...baseProps, showShortcutHints: false });
    expect(off.target.querySelectorAll("[data-slot='kbd']").length).toBe(0);
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

  // EXC-913: Reject is the third verdict to carry a key, so it advertises the
  // shortcut for a11y and shows a single Shift+R cap — the global shift icon (not a
  // ⇧ glyph) plus R — when hints are on.
  test("advertises Shift+R and shows the shift-icon + R cap only when hints are enabled", () => {
    const off = render(TopBar, { ...baseProps, showShortcutHints: false });
    const offBtn = off.target.querySelector(".reject") as HTMLElement;
    // Derived from the same reservation the dispatcher fires on rather than a fixed
    // string, so a rebind is a one-file edit (EXC-876). The literal is pinned once,
    // in keymap.test.ts.
    expect(offBtn.getAttribute("aria-keyshortcuts")).toBe(ariaKeyshortcutsFor("actions.reject"));
    // Boolean rather than toBeNull(): a FAILING toBeNull() against a happy-dom node
    // hangs the bun runner, and this assertion fails with a node when it regresses.
    expect(offBtn.querySelector("[data-slot='kbd']") === null).toBe(true);

    const on = render(TopBar, baseProps);
    const cap = (on.target.querySelector(".reject") as HTMLElement).querySelector(
      "[data-slot='kbd']",
    );
    expect(cap).not.toBeNull();
    // The shift half is the shared icon (Icon renders a labelled .icon wrapper),
    // never the ⇧ character; the letter stays plain text.
    expect((cap as HTMLElement).querySelector(".icon")?.getAttribute("aria-label")).toBe("Shift");
    expect((cap as HTMLElement).textContent).toContain("R");
    expect((cap as HTMLElement).textContent).not.toContain("⇧");
  });
});

describe("TopBar overflow menu (EXC-810)", () => {
  // Below --w-narrow the secondary actions collapse into a "More actions"
  // overflow DropdownMenu. The trigger stays in the DOM at every width (CSS
  // toggles its visibility) and carries the pending count so it stays visible
  // when Request changes moves into the menu. The trigger renders synchronously
  // (only DropdownMenu's portalled Content is deferred); the menu's items and
  // the width-driven visibility swap are real-browser behavior, covered in
  // test/e2e/topbar-overflow.e2e.ts per doc/agents/browser-testing.md.

  test("renders the overflow trigger with an accessible name when a review is active", () => {
    const { target } = render(TopBar, baseProps);
    const trigger = target.querySelector(".overflow-trigger") as HTMLButtonElement;
    expect(trigger).not.toBeNull();
    expect(trigger.getAttribute("aria-label")).toBe("More actions");
  });

  test("hides the overflow trigger when no review is active", () => {
    const { target } = render(TopBar, { ...baseProps, active: null });
    expect(target.querySelector(".overflow-trigger")).toBeNull();
  });

  test("surfaces the pending-comment count on the overflow trigger", () => {
    const { target } = render(TopBar, { ...baseProps, pendingCount: 4 });
    const count = target.querySelector(".overflow-trigger .count");
    expect(count).not.toBeNull();
    expect(count!.textContent).toContain("4");
  });

  test("hides the overflow-trigger count when none are pending", () => {
    const { target } = render(TopBar, { ...baseProps, pendingCount: 0 });
    expect(target.querySelector(".overflow-trigger .count")).toBeNull();
  });

  test("folds the pending count into the overflow trigger's accessible name", () => {
    // The trigger's own aria-label replaces its subtree for naming, so the
    // count must ride the label — not just the (aria-hidden) visual badge — or a
    // screen reader loses it when the row collapses.
    const { target } = render(TopBar, { ...baseProps, pendingCount: 3 });
    const trigger = target.querySelector(".overflow-trigger") as HTMLButtonElement;
    expect(trigger.getAttribute("aria-label")).toContain("3");
  });

  test("wraps the inline split-button approve in a hideable slot", () => {
    // The slot is what CSS hides ≤ --w-tight so Approve moves into the overflow
    // menu; the split control lives inside it.
    const { target } = render(TopBar, baseProps);
    expect(target.querySelector(".approve-slot .split-primary")).not.toBeNull();
  });

  test("wraps the inline plain approve in a hideable slot", () => {
    const oneVariant: ApproveVariant[] = [{ id: "default", label: "Approve" }];
    const { target } = render(TopBar, { ...baseProps, variants: oneVariant });
    expect(target.querySelector(".approve-slot .approve")).not.toBeNull();
  });
});

import "../../test-mount.ts";
import { describe, expect, test } from "bun:test";
import { render } from "../../test-mount.ts";
import type { CommentIndexEntry } from "../lib/feedback.ts";
import CommentNavigator from "./CommentNavigator.svelte";

// The comment navigator's synchronous surface: the list structure, the row
// contract (jump + active marker), the empty state, and dismissal. Search
// filtering is driven by the bound input's live state, so it is exercised with
// real keystrokes in comment-navigator.e2e.ts rather than here.

const comments: CommentIndexEntry[] = [
  { id: "a", line: 3, label: "Line 3", text: "Cache the cold path" },
  { id: "b", line: 6, label: "Lines 5–6", text: "Tighten verification" },
];

const base = {
  open: true,
  comments,
  activeId: null,
  onReveal: () => {},
  onClose: () => {},
};

describe("CommentNavigator", () => {
  test("renders nothing when closed", () => {
    const { target } = render(CommentNavigator, { ...base, open: false });
    expect(target.querySelector(".comment-navigator")).toBeNull();
  });

  test("lists one navigable row per comment, with its range label and text", () => {
    const { target } = render(CommentNavigator, base);
    const items = target.querySelectorAll(".nav-item");
    expect(items.length).toBe(2);
    expect(items[0]!.textContent).toContain("Line 3");
    expect(items[0]!.textContent).toContain("Cache the cold path");
  });

  test("clicking a row reveals that comment", () => {
    let revealed: CommentIndexEntry | undefined;
    const { target } = render(CommentNavigator, { ...base, onReveal: (e) => (revealed = e) });
    target.querySelectorAll<HTMLButtonElement>(".nav-item")[1]!.click();
    expect(revealed?.id).toBe("b");
  });

  test("marks the active comment as current", () => {
    const { target } = render(CommentNavigator, { ...base, activeId: "a" });
    const active = target.querySelector(".nav-item.active");
    expect(active).not.toBeNull();
    expect(active!.getAttribute("aria-current")).toBe("true");
    expect(active!.textContent).toContain("Line 3");
  });

  test("clicking close dismisses the navigator", () => {
    let closed = 0;
    const { target } = render(CommentNavigator, { ...base, onClose: () => (closed += 1) });
    target.querySelector<HTMLButtonElement>(".nav-close")!.click();
    expect(closed).toBe(1);
  });

  test("shows an empty message when there are no comments", () => {
    const { target } = render(CommentNavigator, { ...base, comments: [] });
    expect(target.querySelector(".nav-list")).toBeNull();
    expect(target.querySelector(".nav-empty")!.textContent).toContain("No inline comments");
  });
});

import "../../test-mount.ts";
import { describe, expect, test } from "bun:test";

import CommentNavigator from "@/components/CommentNavigator.svelte";
import type { CommentIndexEntry } from "$lib/feedback.ts";

import { render } from "../../test-mount.ts";

// The comment navigator's synchronous surface: the list structure, the row
// contract (jump + active marker), the empty state, and dismissal. Search
// filtering is driven by the bound input's live state, so it is exercised with
// real keystrokes in comment-navigator.e2e.ts rather than here.

const comments: CommentIndexEntry[] = [
  { id: "a", line: 3, label: "Line 3", text: "Cache the cold path", draft: false },
  { id: "b", line: 6, label: "Lines 5–6", text: "Tighten verification", draft: false },
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

  test("marks a draft (unsent scratch) row distinctly but keeps it clickable", () => {
    const withDraft: CommentIndexEntry[] = [
      { id: "a", line: 3, label: "Line 3", text: "committed", draft: false },
      { id: "s:1", line: 9, label: "Line 9", text: "half-typed draft", draft: true },
    ];
    let revealed: CommentIndexEntry | undefined;
    const { target } = render(CommentNavigator, {
      ...base,
      comments: withDraft,
      onReveal: (e) => (revealed = e),
    });
    const items = target.querySelectorAll<HTMLButtonElement>(".nav-item");
    // Only the scratch row is a draft, and it carries the tag.
    expect(items[0]!.classList.contains("draft")).toBe(false);
    expect(items[1]!.classList.contains("draft")).toBe(true);
    expect(items[1]!.querySelector(".nav-draft-tag")!.textContent).toContain("draft");
    // It reveals the same way as a committed comment.
    items[1]!.click();
    expect(revealed?.id).toBe("s:1");
  });
});

import "@ui/support/mount.ts";
import { describe, expect, test } from "bun:test";

import { render } from "@ui/support/mount.ts";
import CommentNavigator from "@/components/CommentNavigator.svelte";
import type { CommentIndexEntry } from "$lib/feedback.ts";

// The comment navigator's synchronous surface: the list structure, the row
// contract (jump + active marker), the empty state, and dismissal. Search
// filtering is driven by the bound input's live state, so it is exercised with
// real keystrokes in comment-navigator.e2e.ts rather than here.

const comments: CommentIndexEntry[] = [
  { id: "a", line: 3, label: "Line 3", text: "Cache the cold path", draft: false, linkable: true },
  {
    id: "b",
    line: 6,
    label: "Lines 5–6",
    text: "Tighten verification",
    draft: false,
    linkable: true,
  },
];

const base = {
  open: true,
  comments,
  activeId: null,
  onReveal: () => {},
  onClose: () => {},
  showShortcutHints: false,
};

describe("CommentNavigator", () => {
  test("renders nothing when closed", () => {
    const { target } = render(CommentNavigator, { ...base, open: false });
    expect(target.querySelector(".comment-navigator")).toBeNull();
  });

  test("lists one navigable row per comment, with its range label and text", () => {
    const { target } = render(CommentNavigator, base);
    const items = target.querySelectorAll("[data-nav-row]");
    expect(items.length).toBe(2);
    expect(items[0]!.textContent).toContain("Line 3");
    expect(items[0]!.textContent).toContain("Cache the cold path");
  });

  test("clicking a row reveals that comment", () => {
    let revealed: CommentIndexEntry | undefined;
    const { target } = render(CommentNavigator, { ...base, onReveal: (e) => (revealed = e) });
    target.querySelectorAll<HTMLButtonElement>("[data-nav-row]")[1]!.click();
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

  test("renders the shortcut-key legend as Kbd caps only when hints are enabled", () => {
    const off = render(CommentNavigator, base); // showShortcutHints: false
    expect(off.target.querySelector(".nav-hints")).toBeNull();

    const on = render(CommentNavigator, { ...base, showShortcutHints: true });
    const hints = on.target.querySelector(".nav-hints");
    expect(hints).not.toBeNull();
    // The keys render as shadcn Kbd caps (data-slot=kbd), not plain text.
    expect(hints!.querySelector("[data-slot='kbd']")).not.toBeNull();
  });

  test("shows an empty message when there are no comments", () => {
    const { target } = render(CommentNavigator, { ...base, comments: [] });
    expect(target.querySelector(".nav-list")).toBeNull();
    expect(target.querySelector(".nav-empty")!.textContent).toContain("No inline comments");
  });

  test("marks a draft (unsent scratch) row distinctly but keeps it clickable", () => {
    const withDraft: CommentIndexEntry[] = [
      { id: "a", line: 3, label: "Line 3", text: "committed", draft: false, linkable: true },
      {
        id: "s:1",
        line: 9,
        label: "Line 9",
        text: "half-typed draft",
        draft: true,
        linkable: true,
      },
    ];
    let revealed: CommentIndexEntry | undefined;
    const { target } = render(CommentNavigator, {
      ...base,
      comments: withDraft,
      onReveal: (e) => (revealed = e),
    });
    const items = target.querySelectorAll<HTMLButtonElement>("[data-nav-row]");
    expect(items[0]!.classList.contains("draft")).toBe(false);
    expect(items[1]!.classList.contains("draft")).toBe(true);
    expect(items[1]!.querySelector(".nav-draft-tag")!.textContent).toContain("draft");
    // It reveals the same way as a committed comment.
    items[1]!.click();
    expect(revealed?.id).toBe("s:1");
  });
});

// The versioned mode the compare view drives (EXC-872, EXC-1041): the same panel
// listing comments from several plan versions, each badged with its source. A
// comment left on one of the two rendered versions reveals; one from a version
// in the range but off screen lists non-interactively.
describe("CommentNavigator in compare mode", () => {
  const versioned: CommentIndexEntry[] = [
    // v1 and v3 are the compared pair; v2 is in the range but rendered nowhere.
    {
      id: "v1:a",
      version: 1,
      line: 3,
      label: "Line 3",
      text: "v1 note",
      draft: false,
      linkable: true,
      side: "before",
    },
    {
      id: "v2:b",
      version: 2,
      line: 6,
      label: "Lines 5–6",
      text: "v2 note",
      draft: false,
      linkable: false,
    },
    {
      id: "v3:c",
      version: 3,
      line: 9,
      label: "Line 9",
      text: "v3 note",
      draft: false,
      linkable: true,
      side: "after",
    },
  ];
  const compare = { ...base, comments: versioned, compare: true };

  test("badges each row with the version its comment was left on", () => {
    const { target } = render(CommentNavigator, compare);
    const tags = [...target.querySelectorAll(".nav-version-tag")].map((t) => t.textContent);
    expect(tags).toEqual(["v1", "v2", "v3"]);
  });

  test("renders a linkable row as a reveal button and an unlinkable one as a list item", () => {
    const { target } = render(CommentNavigator, compare);
    const items = [...target.querySelectorAll("[data-nav-row]")];
    expect(items.map((el) => el.tagName)).toEqual(["BUTTON", "LI", "BUTTON"]);
  });

  test("clicking a linkable row reveals that comment, side and all", () => {
    let revealed: CommentIndexEntry | undefined;
    const { target } = render(CommentNavigator, { ...compare, onReveal: (e) => (revealed = e) });
    target.querySelectorAll<HTMLButtonElement>("button.nav-item")[1]!.click();
    expect(revealed).toMatchObject({ id: "v3:c", line: 9, side: "after" });
  });

  test("marks an unlinkable row as absent from the diff", () => {
    const { target } = render(CommentNavigator, compare);
    const items = [...target.querySelectorAll("[data-nav-row]")];
    expect(items[1]!.querySelector(".nav-unlinked-tag")!.textContent).toContain("not in diff");
    expect(items[0]!.querySelector(".nav-unlinked-tag")).toBeNull();
    expect(items[2]!.querySelector(".nav-unlinked-tag")).toBeNull();
  });

  test("labels a general row General, with no line reference and no reveal", () => {
    const general: CommentIndexEntry[] = [
      {
        id: "v1:general",
        version: 1,
        label: "",
        text: "rethink the rollout",
        draft: false,
        general: true,
        linkable: false,
      },
    ];
    const { target } = render(CommentNavigator, { ...compare, comments: general });
    const row = target.querySelector("[data-nav-row]")!;
    expect(row.tagName).toBe("LI");
    expect(row.querySelector(".nav-item-ref")!.textContent).toBe("General");
    expect(row.textContent).toContain("rethink the rollout");
    // v1 IS one of the rendered sides — the row is inert because it anchors
    // nowhere, not because its version is missing from the diff. (Asserted on
    // the tag's text: bun stalls pretty-printing a happy-dom node on failure.)
    expect(row.querySelector(".nav-unlinked-tag")?.textContent ?? null).toBeNull();
  });

  test("still exposes [data-nav-row] rows, so j/k roving focus keeps working", () => {
    const { target } = render(CommentNavigator, compare);
    const items = target.querySelectorAll("[data-nav-row]");
    expect(items.length).toBe(3);
    expect(items[1]!.getAttribute("tabindex")).toBe("-1");
  });

  test("shows the compare empty state when the range has no comments", () => {
    const { target } = render(CommentNavigator, { ...compare, comments: [] });
    expect(target.querySelector(".nav-empty")!.textContent).toContain("No comments on these");
  });

  test("titles the panel with the compared range", () => {
    const { target } = render(CommentNavigator, { ...compare, title: "Comments in v1–v3" });
    expect(target.querySelector(".nav-title")!.textContent).toBe("Comments in v1–v3");
    expect(target.querySelector(".comment-navigator")!.getAttribute("aria-label")).toBe(
      "Comments in v1–v3",
    );
  });

  test("keeps the reveal key cap in the legend — compare rows reveal now", () => {
    const { target } = render(CommentNavigator, { ...compare, showShortcutHints: true });
    const hints = target.querySelector(".nav-hints")!.textContent;
    expect(hints).toContain("reveal");
    expect(hints).toContain("move");
    expect(hints).toContain("search");
    expect(hints).toContain("close");
  });
});

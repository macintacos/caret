import "../../test-mount.ts";
import { EditorView } from "@codemirror/view";
import { describe, expect, test } from "bun:test";
import type { LineAnnotation } from "@core/lib/types";
import { capture, render } from "../../test-mount.ts";
import SourceAnnotationCard from "./SourceAnnotationCard.svelte";

// SourceAnnotationCard is the collapsible inline card for the source-view
// surface. Component units cover its collapsed/expanded render, the saved comment
// rendered as markdown, the focus/edit/delete callback wiring, and the rule that
// the collapse state is UI-only (it never reaches a callback). Positioning,
// scroll-sync, and the gutter marker are exercised by DiffPlanView units + e2e.

const annotation: LineAnnotation = { id: "a1", startLine: 3, endLine: 5, comment: "needs work" };

function click(root: ParentNode, selector: string): void {
  (root.querySelector(selector) as HTMLElement).click();
}

// The Discard confirmation portals to document.body (anchor mode, viewport-aware —
// the same path the Request Changes dialog uses), so it is reached from the
// document, not the mount target.
function clickDoc(selector: string): void {
  (document.querySelector(selector) as HTMLElement).click();
}

// Set the CodeMirror editor's text the way a keystroke would (real typing is
// e2e). findFromDOM returns the live view; dispatching a change fires its update
// listener, so the host's onInput — and thus the edit draft — updates exactly as
// in the browser.
function setEditorText(root: ParentNode, text: string): void {
  const view = EditorView.findFromDOM(root.querySelector(".cm-editor") as HTMLElement);
  view?.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
}

function chord(root: ParentNode, key: string, mods: Partial<KeyboardEventInit> = {}): void {
  (root.querySelector(".cm-content") as HTMLElement).dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...mods }),
  );
}

function base(over: Record<string, unknown> = {}) {
  return {
    annotation,
    focused: false,
    onFocus: () => {},
    onEdit: () => {},
    onDelete: () => {},
    ...over,
  };
}

describe("SourceAnnotationCard collapse", () => {
  test("renders collapsed (a chip) when not focused", () => {
    const { target } = render(SourceAnnotationCard, base({ focused: false }));
    expect(target.querySelector(".chip")).not.toBeNull();
    // Collapsed: no expanded actions, and the one-line preview stands in for the
    // body (which stays mounted at row height 0 for the grid reveal).
    expect(target.querySelector(".card.expanded")).toBeNull();
    expect(target.querySelector(".actions")).toBeNull();
    expect(target.querySelector(".preview")).not.toBeNull();
  });

  test("renders expanded when focused", () => {
    const { target } = render(SourceAnnotationCard, base({ focused: true }));
    expect(target.querySelector(".card.expanded")).not.toBeNull();
    expect(target.querySelector(".comment")?.textContent?.trim()).toBe("needs work");
    // Expanded drops the preview and reveals the Edit / Discard actions.
    expect(target.querySelector(".preview")).toBeNull();
    expect(target.querySelector(".actions")).not.toBeNull();
  });

  test("clicking the collapsed chip expands the card without persisting", () => {
    let edited = false;
    const focused = capture<string>();
    const { target, flush } = render(
      SourceAnnotationCard,
      base({ focused: false, onFocus: focused.cb, onEdit: () => (edited = true) }),
    );
    click(target, ".chip");
    flush();
    expect(focused.last()).toBe("a1");
    expect(edited).toBe(false);
    expect(target.querySelector(".card.expanded")).not.toBeNull();
  });

  test("an expanded card can collapse back to a chip via its toggle (UI-only)", () => {
    let edited = false;
    const { target, flush } = render(
      SourceAnnotationCard,
      base({ focused: true, onEdit: () => (edited = true) }),
    );
    // The whole header line is the toggle now (no separate collapse control):
    // clicking the trigger collapses the card back to its chip.
    click(target, ".chip");
    flush();
    expect(target.querySelector(".card.expanded")).toBeNull();
    expect(target.querySelector(".chip")).not.toBeNull();
    expect(edited).toBe(false);
  });

  test("clicking the comment body (not a button) collapses the expanded card", () => {
    const { target, flush } = render(SourceAnnotationCard, base({ focused: true }));
    expect(target.querySelector(".card.expanded")).not.toBeNull();
    // The whole surface is the toggle: clicking anywhere that isn't an action —
    // here, the rendered comment itself — collapses the card back to a chip.
    click(target, ".comment");
    flush();
    expect(target.querySelector(".card.expanded")).toBeNull();
  });

  test("clicking an action button does not toggle the card", () => {
    // Edit sits in the actions cluster, so its click opens the editor rather
    // than collapsing the card out from under the reviewer.
    const { target, flush } = render(SourceAnnotationCard, base({ focused: true }));
    click(target, ".edit");
    flush();
    expect(target.querySelector(".card.expanded")).not.toBeNull();
    expect(target.querySelector(".cm-content")).not.toBeNull();
  });
});

describe("SourceAnnotationCard rendered comment", () => {
  test("renders the saved comment as formatted markdown", () => {
    const md: LineAnnotation = {
      id: "m",
      startLine: 1,
      endLine: 1,
      comment: "use `please` and **stop**",
    };
    const { target } = render(SourceAnnotationCard, base({ annotation: md, focused: true }));
    const comment = target.querySelector(".comment");
    expect(comment?.querySelector("code")?.textContent).toBe("please");
    expect(comment?.querySelector("strong")?.textContent).toBe("stop");
  });

  test("does not execute embedded HTML (sanitized)", () => {
    const evil: LineAnnotation = {
      id: "x",
      startLine: 1,
      endLine: 1,
      comment: "hi <script>alert(1)</script>",
    };
    const { target } = render(SourceAnnotationCard, base({ annotation: evil, focused: true }));
    expect(target.querySelector(".comment script")).toBeNull();
  });
});

describe("SourceAnnotationCard label", () => {
  test("a single line shows 'Line N'", () => {
    const single: LineAnnotation = { id: "s", startLine: 7, endLine: 7, comment: "x" };
    const { target } = render(SourceAnnotationCard, base({ annotation: single }));
    expect(target.querySelector(".ref")?.textContent).toBe("Line 7");
  });

  test("a range shows 'Lines N–M'", () => {
    const { target } = render(SourceAnnotationCard, base());
    expect(target.querySelector(".ref")?.textContent).toBe("Lines 3–5");
  });
});

describe("SourceAnnotationCard state indicator", () => {
  function stated(state: LineAnnotation["state"], over: Record<string, unknown> = {}) {
    return base({ annotation: { ...annotation, state }, ...over });
  }

  test("an annotation with no state shows the pending Draft affordance", () => {
    const { target } = render(SourceAnnotationCard, stated(undefined));
    expect(target.querySelector(".card")?.getAttribute("data-state")).toBe("pending");
    const chip = target.querySelector(".chip .state");
    expect(chip?.classList.contains("state-draft")).toBe(true);
    expect(chip?.textContent?.trim()).toBe("Draft");
  });

  test("a pending comment reads as a Draft", () => {
    const { target } = render(SourceAnnotationCard, stated("pending"));
    const chip = target.querySelector(".chip .state");
    expect(chip?.classList.contains("state-draft")).toBe(true);
    expect(chip?.textContent?.trim()).toBe("Draft");
  });

  test("a rejected comment reads as a still-active Requested", () => {
    const { target } = render(SourceAnnotationCard, stated("rejected"));
    expect(target.querySelector(".card")?.getAttribute("data-state")).toBe("rejected");
    const chip = target.querySelector(".chip .state");
    expect(chip?.classList.contains("state-draft")).toBe(true);
    expect(chip?.textContent?.trim()).toBe("Requested");
  });

  test("an approved comment reads as an Accepted terminal", () => {
    const { target } = render(SourceAnnotationCard, stated("approved"));
    expect(target.querySelector(".card")?.getAttribute("data-state")).toBe("approved");
    const chip = target.querySelector(".chip .state");
    expect(chip?.classList.contains("state-accepted")).toBe(true);
    expect(chip?.textContent?.trim()).toBe("Accepted");
  });

  test("an expired comment reads as a quiet Expired terminal", () => {
    const { target } = render(SourceAnnotationCard, stated("expired"));
    expect(target.querySelector(".card")?.getAttribute("data-state")).toBe("expired");
    const chip = target.querySelector(".chip .state");
    expect(chip?.classList.contains("state-expired")).toBe(true);
    expect(chip?.textContent?.trim()).toBe("Expired");
  });

  test("the same state affordance shows in the expanded header", () => {
    const { target } = render(SourceAnnotationCard, stated("approved", { focused: true }));
    const headState = target.querySelector(".head .state");
    expect(headState?.classList.contains("state-accepted")).toBe(true);
    expect(headState?.textContent?.trim()).toBe("Accepted");
  });
});

describe("SourceAnnotationCard focus + position", () => {
  test("the focused card carries the focused class", () => {
    const { target } = render(SourceAnnotationCard, base({ focused: true }));
    expect(target.querySelector(".card")?.classList.contains("focused")).toBe(true);
  });

  test("renders inline (no absolute positioning hook)", () => {
    const { target } = render(SourceAnnotationCard, base());
    const style = target.querySelector(".card")?.getAttribute("style");
    expect(style == null || !/top:|position\s*:/.test(style)).toBe(true);
  });

  test("carries the data-annotation-card hook for focus scroll", () => {
    const { target } = render(SourceAnnotationCard, base());
    expect(target.querySelector('[data-annotation-card="a1"]')).not.toBeNull();
  });
});

describe("SourceAnnotationCard edit/delete", () => {
  test("delete confirms first, then fires onDelete without focusing", () => {
    const deleted = capture<string>();
    let focused = false;
    const { target, flush } = render(
      SourceAnnotationCard,
      base({ focused: true, onFocus: () => (focused = true), onDelete: deleted.cb }),
    );
    click(target, ".danger");
    flush();
    // The confirm pops out of the Discard button; nothing is deleted yet.
    expect(document.querySelector(".confirm-popover")).not.toBeNull();
    expect(deleted.last()).toBeUndefined();
    // Confirming deletes, and the original click never focused the card.
    clickDoc(".confirm-popover .confirm");
    flush();
    expect(deleted.last()).toBe("a1");
    expect(focused).toBe(false);
  });

  test("canceling the delete keeps the comment", () => {
    const deleted = capture<string>();
    const { target, flush } = render(
      SourceAnnotationCard,
      base({ focused: true, onDelete: deleted.cb }),
    );
    click(target, ".danger");
    flush();
    clickDoc(".confirm-popover .cancel");
    flush();
    expect(deleted.last()).toBeUndefined();
    expect(document.querySelector(".confirm-popover")).toBeNull();
  });

  test("edit opens the editor seeded with the current comment", () => {
    const { target, flush } = render(SourceAnnotationCard, base({ focused: true }));
    click(target, ".edit");
    flush();
    expect(target.querySelector("textarea")).toBeNull();
    expect(target.querySelector(".cm-content")?.textContent).toContain("needs work");
  });

  test("saves a changed, non-empty comment on Cmd/Ctrl+Enter", () => {
    const edited = capture<{ id: string; comment: string }>();
    const { target, flush } = render(
      SourceAnnotationCard,
      base({ focused: true, onEdit: (id: string, comment: string) => edited.cb({ id, comment }) }),
    );
    click(target, ".edit");
    flush();
    setEditorText(target, "revised");
    chord(target, "Enter", { metaKey: true });
    flush();
    expect(edited.last()).toEqual({ id: "a1", comment: "revised" });
  });

  test("the save button commits a changed comment", () => {
    const edited = capture<{ id: string; comment: string }>();
    const { target, flush } = render(
      SourceAnnotationCard,
      base({ focused: true, onEdit: (id: string, comment: string) => edited.cb({ id, comment }) }),
    );
    click(target, ".edit");
    flush();
    setEditorText(target, "via button");
    click(target, ".save");
    flush();
    expect(edited.last()).toEqual({ id: "a1", comment: "via button" });
  });

  test("the cancel button discards the edit without saving", () => {
    let called = false;
    const { target, flush } = render(
      SourceAnnotationCard,
      base({ focused: true, onEdit: () => (called = true) }),
    );
    click(target, ".edit");
    flush();
    setEditorText(target, "discard me");
    click(target, ".cancel");
    flush();
    expect(called).toBe(false);
    expect(target.querySelector(".cm-content")).toBeNull();
  });

  test("does NOT save an unchanged comment", () => {
    let called = false;
    const { target, flush } = render(
      SourceAnnotationCard,
      base({ focused: true, onEdit: () => (called = true) }),
    );
    click(target, ".edit");
    flush();
    chord(target, "Enter", { metaKey: true });
    flush();
    expect(called).toBe(false);
  });

  test("Escape cancels the edit without saving", () => {
    let called = false;
    const { target, flush } = render(
      SourceAnnotationCard,
      base({ focused: true, onEdit: () => (called = true) }),
    );
    click(target, ".edit");
    flush();
    setEditorText(target, "discarded");
    chord(target, "Escape");
    flush();
    expect(called).toBe(false);
    expect(target.querySelector(".cm-content")).toBeNull();
  });
});

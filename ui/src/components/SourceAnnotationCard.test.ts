import "@ui/support/mount.ts";
import { describe, expect, test } from "bun:test";

import { EditorView } from "@codemirror/view";

import type { LineAnnotation } from "@core/lib/types";
import { capture, flushUntil, render } from "@ui/support/mount.ts";
import SourceAnnotationCard from "@/components/SourceAnnotationCard.svelte";

// SourceAnnotationCard is the collapsible inline card for the source-view
// surface. Component units cover its collapsed/expanded render, the saved comment
// rendered as markdown, the focus/edit/delete callback wiring, and the rule that
// the collapse state is UI-only (it never reaches a callback). Positioning,
// scroll-sync, and the gutter marker are exercised by DiffPlanView units + e2e.

const annotation: LineAnnotation = { id: "a1", startLine: 3, endLine: 5, comment: "needs work" };

function click(root: ParentNode, selector: string): void {
  (root.querySelector(selector) as HTMLElement).click();
}

// The Discard confirmation is a `popover` (EXC-1110), so bits-ui portals it to
// document.body and mounts it deferred — reached from the document rather than the
// mount target, and polled for rather than read straight after the click.
const confirmPopover = () => document.body.querySelector(".confirm-popover");

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

// The second-stage Escape lands on the composer card itself (target === the card),
// which is how onCardKeydown distinguishes it from an Escape bubbling up from the
// still-focused editor.
function escapeCard(root: ParentNode): void {
  (root.querySelector("[role='dialog']") as HTMLElement).dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
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

/** Click Discard, wait for the confirm popover, confirm it, and assert the id
 * it deletes — the shared confirm-discard path both the collapsed and the
 * expanded card exercise. */
async function confirmDelete(
  target: ParentNode,
  flush: () => void,
  deleted: { last: () => string | undefined },
): Promise<void> {
  click(target, ".danger");
  await flushUntil(flush, () => confirmPopover() !== null);
  expect(confirmPopover()).not.toBeNull();
  expect(deleted.last()).toBeUndefined();
  clickDoc(".confirm-popover .confirm");
  await flushUntil(flush, () => confirmPopover() === null);
  expect(deleted.last()).toBe("a1");
}

/** Render an expanded card and click Edit into it — the common opening every
 * edit/save/cancel test below shares. */
function openEditor(onEdit: (id: string, comment: string) => void = () => {}): {
  target: HTMLElement;
  flush: () => void;
} {
  const { target, flush } = render(SourceAnnotationCard, base({ focused: true, onEdit }));
  click(target, ".edit");
  flush();
  return { target, flush };
}

/** Open the editor, tracking only whether `onEdit` ever fired — for the tests
 * that assert a save was refused. */
function openEditorTracking(): { target: HTMLElement; flush: () => void; called: () => boolean } {
  let called = false;
  const { target, flush } = openEditor(() => {
    called = true;
  });
  return { target, flush, called: () => called };
}

/** Open the editor, type `text`, and capture the `{ id, comment }` an eventual
 * save fires with — for the tests that assert a save landed. */
function openEditorWithCapture(text: string): {
  target: HTMLElement;
  flush: () => void;
  edited: ReturnType<typeof capture<{ id: string; comment: string }>>;
} {
  const edited = capture<{ id: string; comment: string }>();
  const { target, flush } = openEditor((id, comment) => edited.cb({ id, comment }));
  setEditorText(target, text);
  return { target, flush, edited };
}

/** Assert the chip/header state indicator's class and label together — the
 * two-line check every state-indicator case repeats. */
function expectChipState(el: Element | null, cls: string, label: string): void {
  expect(el?.classList.contains(cls)).toBe(true);
  expect(el?.textContent?.trim()).toBe(label);
}

describe("SourceAnnotationCard collapse", () => {
  test("renders collapsed (a chip) when not focused", () => {
    const { target } = render(SourceAnnotationCard, base({ focused: false }));
    expect(target.querySelector(".chip")).not.toBeNull();
    // The body stays mounted at row height 0 for the grid reveal, so the one-line
    // preview is what stands in for it.
    expect(target.querySelector(".card.expanded")).toBeNull();
    expect(target.querySelector(".preview")).not.toBeNull();
    expect(target.querySelector(".actions")).not.toBeNull();
  });

  test("a collapsed card exposes Edit and Discard without expanding", () => {
    const { target } = render(SourceAnnotationCard, base({ focused: false }));
    expect(target.querySelector(".card.expanded")).toBeNull();
    expect(target.querySelector(".actions .edit")).not.toBeNull();
    expect(target.querySelector(".actions .danger")).not.toBeNull();
  });

  test("Edit from a collapsed card opens the editor and expands it", () => {
    const { target, flush } = render(SourceAnnotationCard, base({ focused: false }));
    click(target, ".edit");
    flush();
    expect(target.querySelector(".cm-content")).not.toBeNull();
    expect(target.querySelector(".card.expanded")).not.toBeNull();
  });

  test("Discard from a collapsed card confirms, then deletes via the shared path", async () => {
    const deleted = capture<string>();
    const { target, flush } = render(
      SourceAnnotationCard,
      base({ focused: false, onDelete: deleted.cb }),
    );
    flush();
    await confirmDelete(target, flush, deleted);
    expect(target.querySelector(".card.expanded")).toBeNull();
  });

  test("renders expanded when focused", () => {
    const { target } = render(SourceAnnotationCard, base({ focused: true }));
    expect(target.querySelector(".card.expanded")).not.toBeNull();
    expect(target.querySelector(".comment")?.textContent?.trim()).toBe("needs work");
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
    // The whole header line is the toggle; there is no separate collapse control.
    click(target, ".chip");
    flush();
    expect(target.querySelector(".card.expanded")).toBeNull();
    expect(target.querySelector(".chip")).not.toBeNull();
    expect(edited).toBe(false);
  });

  test("clicking the comment body (not a button) collapses the expanded card", () => {
    const { target, flush } = render(SourceAnnotationCard, base({ focused: true }));
    expect(target.querySelector(".card.expanded")).not.toBeNull();
    click(target, ".comment");
    flush();
    expect(target.querySelector(".card.expanded")).toBeNull();
  });

  test("clicking an action button does not toggle the card", () => {
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
    expectChipState(target.querySelector(".chip .state"), "state-draft", "Draft");
  });

  test("a pending comment reads as a Draft", () => {
    const { target } = render(SourceAnnotationCard, stated("pending"));
    expectChipState(target.querySelector(".chip .state"), "state-draft", "Draft");
  });

  test("a rejected comment reads as a still-active Requested", () => {
    const { target } = render(SourceAnnotationCard, stated("rejected"));
    expect(target.querySelector(".card")?.getAttribute("data-state")).toBe("rejected");
    expectChipState(target.querySelector(".chip .state"), "state-draft", "Requested");
  });

  test("an approved comment reads as an Accepted terminal", () => {
    const { target } = render(SourceAnnotationCard, stated("approved"));
    expect(target.querySelector(".card")?.getAttribute("data-state")).toBe("approved");
    expectChipState(target.querySelector(".chip .state"), "state-accepted", "Accepted");
  });

  test("an expired comment reads as a quiet Expired terminal", () => {
    const { target } = render(SourceAnnotationCard, stated("expired"));
    expect(target.querySelector(".card")?.getAttribute("data-state")).toBe("expired");
    expectChipState(target.querySelector(".chip .state"), "state-expired", "Expired");
  });

  test("the same state affordance shows in the expanded header", () => {
    const { target } = render(SourceAnnotationCard, stated("approved", { focused: true }));
    expectChipState(target.querySelector(".head .state"), "state-accepted", "Accepted");
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
  test("delete confirms first, then fires onDelete without focusing", async () => {
    const deleted = capture<string>();
    let focused = false;
    const { target, flush } = render(
      SourceAnnotationCard,
      base({ focused: true, onFocus: () => (focused = true), onDelete: deleted.cb }),
    );
    flush();
    await confirmDelete(target, flush, deleted);
    expect(focused).toBe(false);
  });

  test("canceling the delete keeps the comment", async () => {
    const deleted = capture<string>();
    const { target, flush } = render(
      SourceAnnotationCard,
      base({ focused: true, onDelete: deleted.cb }),
    );
    flush();
    click(target, ".danger");
    await flushUntil(flush, () => confirmPopover() !== null);
    clickDoc(".confirm-popover .cancel");
    await flushUntil(flush, () => confirmPopover() === null);
    expect(deleted.last()).toBeUndefined();
    expect(confirmPopover()).toBeNull();
  });

  test("Discard renders as a trash icon with an accessible label", () => {
    const { target } = render(SourceAnnotationCard, base({ focused: true }));
    const discard = target.querySelector(".actions .danger");
    expect(discard?.getAttribute("aria-label")).toBe("Discard comment");
    expect(discard?.querySelector("svg")).not.toBeNull();
    expect(discard?.textContent?.trim()).toBe("");
  });

  test("edit opens the editor seeded with the current comment", () => {
    const { target } = openEditor();
    expect(target.querySelector("textarea")).toBeNull();
    expect(target.querySelector(".cm-content")?.textContent).toContain("needs work");
  });

  test("saves a changed, non-empty comment on Cmd/Ctrl+Enter", () => {
    const { target, flush, edited } = openEditorWithCapture("revised");
    chord(target, "Enter", { metaKey: true });
    flush();
    expect(edited.last()).toEqual({ id: "a1", comment: "revised" });
  });

  test("the save button commits a changed comment", () => {
    const { target, flush, edited } = openEditorWithCapture("via button");
    click(target, ".save");
    flush();
    expect(edited.last()).toEqual({ id: "a1", comment: "via button" });
  });

  test("the cancel button discards the edit without saving", () => {
    const { target, flush, called } = openEditorTracking();
    setEditorText(target, "discard me");
    click(target, ".cancel");
    flush();
    expect(called()).toBe(false);
    expect(target.querySelector(".cm-content")).toBeNull();
  });

  test("does NOT save an unchanged comment", () => {
    const { target, flush, called } = openEditorTracking();
    chord(target, "Enter", { metaKey: true });
    flush();
    expect(called()).toBe(false);
  });

  test("Escape blurs the field first, keeping the editor open and unsaved", () => {
    const { target, flush, called } = openEditorTracking();
    setEditorText(target, "changed");
    chord(target, "Escape");
    flush();
    expect(called()).toBe(false);
    expect(target.querySelector(".cm-content")).not.toBeNull();
  });

  test("a second Escape (on the card) saves the edit and closes", () => {
    const { target, flush, edited } = openEditorWithCapture("saved via escape");
    chord(target, "Escape"); // blur into the card
    flush();
    escapeCard(target); // dismiss: for an edit that commits the current text
    flush();
    expect(edited.last()).toEqual({ id: "a1", comment: "saved via escape" });
    expect(target.querySelector(".cm-content")).toBeNull();
  });
});

import "@ui/test-mount.ts";
import { describe, expect, test } from "bun:test";

import { render } from "@ui/test-mount.ts";
import SourceComposer from "@/components/SourceComposer.svelte";

// SourceComposer is the inline comment editor for the source-view gutter flow.
// It wraps MarkdownEditor (the CodeMirror boundary) with the range label and the
// Keep for later / Discard / Comment buttons, and wires submit/discard/keep — via
// the buttons and via the chords the editor reports — plus draft surfacing through
// onInput. Real typing and caret behaviour live in e2e (CodeMirror needs a real
// browser); these units drive the seeded value and the reported chords to cover
// the wiring.

function mount(over: Record<string, unknown> = {}) {
  const submitted: string[] = [];
  const keptWith: string[] = [];
  let discardCalls = 0;
  const { target, flush } = render(SourceComposer, {
    startLine: 3,
    endLine: 3,
    onSubmit: (c: string) => submitted.push(c),
    onKeep: (c: string) => keptWith.push(c),
    onDiscard: () => {
      discardCalls++;
    },
    ...over,
  });
  flush();
  const buttons = Array.from(target.querySelectorAll("button"));
  return {
    target,
    flush,
    content: target.querySelector(".cm-content") as HTMLElement,
    submitBtn: buttons.find((b) => b.textContent?.includes("Comment")) ?? null,
    // The Discard trigger in the row (its own `.ghost` class), distinct from the
    // confirm popover's own "Discard" button that appears once it's clicked.
    discardBtn: target.querySelector(".ghost") as HTMLButtonElement | null,
    keepBtn: buttons.find((b) => b.textContent?.includes("Keep for later")) ?? null,
    submitted,
    keptWith,
    discardCount: () => discardCalls,
  };
}

const confirmPopover = (target: HTMLElement) => target.querySelector(".confirm-popover");
const clickIn = (target: HTMLElement, sel: string) =>
  (target.querySelector(sel) as HTMLElement).click();

function key(content: HTMLElement, k: string, mods: Partial<KeyboardEventInit> = {}) {
  content.dispatchEvent(
    new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...mods }),
  );
}

// The second-stage Escape lands on the composer card itself (target === the card),
// how onCardKeydown tells it apart from an Escape bubbling from the focused editor.
function escapeCard(target: HTMLElement) {
  (target.querySelector("[role='dialog']") as HTMLElement).dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );
}

describe("SourceComposer label", () => {
  test("renders the range label", () => {
    const { target } = mount({ startLine: 5, endLine: 5 });
    expect(target.querySelector(".label")?.textContent).toBe("Line 5");
  });
});

describe("SourceComposer initial value", () => {
  test("an initial value seeds the editor", () => {
    const { content } = mount({ initial: "resume me" });
    expect(content.textContent).toContain("resume me");
  });

  test("reports the seed via onInput on mount", () => {
    const seen: string[] = [];
    mount({ initial: "seed", onInput: (t: string) => seen.push(t) });
    expect(seen[0]).toBe("seed");
  });
});

describe("SourceComposer submit/discard/keep", () => {
  test("the Comment button submits the current text", () => {
    const { submitBtn, submitted } = mount({ initial: "resume me" });
    submitBtn!.click();
    expect(submitted).toEqual(["resume me"]);
  });

  test("the Keep for later button hands back the current text to stash", () => {
    const { keepBtn, keptWith } = mount({ initial: "draft text" });
    keepBtn!.click();
    expect(keptWith).toEqual(["draft text"]);
  });

  test("the Discard button confirms before dropping a non-empty draft", () => {
    const { target, discardBtn, flush, discardCount, keptWith } = mount({ initial: "draft text" });
    discardBtn!.click();
    flush();
    // The confirm pops out; nothing is dropped yet.
    expect(confirmPopover(target)).not.toBeNull();
    expect(discardCount()).toBe(0);
    // Confirming drops the draft, keeping nothing.
    clickIn(target, ".confirm-popover .confirm");
    flush();
    expect(discardCount()).toBe(1);
    expect(keptWith).toHaveLength(0);
  });

  test("canceling the discard keeps the draft and closes the confirm", () => {
    const { target, discardBtn, flush, discardCount } = mount({ initial: "draft text" });
    discardBtn!.click();
    flush();
    clickIn(target, ".confirm-popover .cancel");
    flush();
    expect(discardCount()).toBe(0);
    expect(confirmPopover(target)).toBeNull();
  });

  test("an empty composer discards immediately without confirming", () => {
    const { target, discardBtn, flush, discardCount } = mount();
    discardBtn!.click();
    flush();
    expect(discardCount()).toBe(1);
    expect(confirmPopover(target)).toBeNull();
  });

  test("Keep for later is disabled with an empty box and enabled once there is text", () => {
    expect(mount().keepBtn?.disabled).toBe(true);
    expect(mount({ initial: "something" }).keepBtn?.disabled).toBe(false);
  });
});

describe("SourceComposer keyboard chords", () => {
  test("Cmd/Ctrl+Enter submits", () => {
    const { content, submitted } = mount({ initial: "via chord" });
    key(content, "Enter", { metaKey: true });
    expect(submitted).toEqual(["via chord"]);
  });

  test("the first Escape blurs the field without dismissing the draft", () => {
    const { target, content, flush, discardCount, keptWith } = mount({ initial: "abandon me" });
    key(content, "Escape");
    flush();
    // Only a blur: no confirm, nothing kept or discarded yet.
    expect(confirmPopover(target)).toBeNull();
    expect(discardCount()).toBe(0);
    expect(keptWith).toHaveLength(0);
  });

  test("a second Escape (on the card) keeps a non-empty draft for later", () => {
    const { target, content, flush, discardCount, keptWith } = mount({ initial: "abandon me" });
    key(content, "Escape"); // blur into the card
    flush();
    escapeCard(target); // dismiss like clicking away — a new draft is kept, not dropped
    flush();
    expect(keptWith).toEqual(["abandon me"]);
    expect(discardCount()).toBe(0);
  });

  test("a second Escape on an empty composer keeps nothing and drops no draft", () => {
    const { target, content, flush, discardCount, keptWith } = mount();
    key(content, "Escape");
    flush();
    escapeCard(target);
    flush();
    // Empty box: keep() hands back "" (the host stores no scratch), and nothing is
    // force-discarded.
    expect(keptWith).toEqual([""]);
    expect(discardCount()).toBe(0);
  });

  test("a bare Enter does not submit", () => {
    const { content, submitted } = mount({ initial: "no submit" });
    key(content, "Enter");
    expect(submitted).toHaveLength(0);
  });
});

describe("SourceComposer focus", () => {
  test("autofocuses the editor with preventScroll so opening never scrolls the view", () => {
    const proto = HTMLElement.prototype;
    const orig = proto.focus;
    const optsSeen: Array<FocusOptions | undefined> = [];
    proto.focus = function (opts?: FocusOptions) {
      optsSeen.push(opts);
      return orig.call(this, opts);
    };
    try {
      mount();
      expect(optsSeen.length).toBeGreaterThan(0);
      expect(optsSeen.some((o) => o?.preventScroll === true)).toBe(true);
    } finally {
      proto.focus = orig;
    }
  });
});

import "@ui/test-mount.ts";
import { describe, expect, test } from "bun:test";

import { withFocusSpy } from "@ui/test-helpers.ts";
import { flushUntil, render } from "@ui/test-mount.ts";
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

// The discard confirmation is a `popover` (EXC-1110), so bits-ui portals it to
// document.body and mounts it deferred — reached from the document, and polled for
// rather than read straight after the click.
const confirmPopover = () => document.body.querySelector(".confirm-popover");
const clickDoc = (sel: string) => (document.querySelector(sel) as HTMLElement).click();

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

  test("the Discard button confirms before dropping a non-empty draft", async () => {
    const { discardBtn, flush, discardCount, keptWith } = mount({ initial: "draft text" });
    discardBtn!.click();
    await flushUntil(flush, () => confirmPopover() !== null);
    // The confirm pops out; nothing is dropped yet.
    expect(confirmPopover()).not.toBeNull();
    expect(discardCount()).toBe(0);
    // Confirming drops the draft, keeping nothing.
    clickDoc(".confirm-popover .confirm");
    await flushUntil(flush, () => confirmPopover() === null);
    expect(discardCount()).toBe(1);
    expect(keptWith).toHaveLength(0);
  });

  test("canceling the discard keeps the draft and closes the confirm", async () => {
    const { discardBtn, flush, discardCount } = mount({ initial: "draft text" });
    discardBtn!.click();
    await flushUntil(flush, () => confirmPopover() !== null);
    clickDoc(".confirm-popover .cancel");
    await flushUntil(flush, () => confirmPopover() === null);
    expect(discardCount()).toBe(0);
    expect(confirmPopover()).toBeNull();
  });

  test("an empty composer discards immediately without confirming", async () => {
    const { discardBtn, flush, discardCount } = mount();
    discardBtn!.click();
    // Polled rather than read once, so a confirmation that merely arrives late would
    // still red this rather than slipping through as "never appeared" — but with a
    // short budget, since every run pays this one in full to prove a negative.
    await flushUntil(flush, () => confirmPopover() !== null, 4);
    expect(discardCount()).toBe(1);
    expect(confirmPopover()).toBeNull();
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
    const { content, flush, discardCount, keptWith } = mount({ initial: "abandon me" });
    key(content, "Escape");
    flush();
    // Only a blur: no confirm, nothing kept or discarded yet.
    expect(confirmPopover()).toBeNull();
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
    const optsSeen = withFocusSpy(() => mount());
    expect(optsSeen.length).toBeGreaterThan(0);
    expect(optsSeen.some((o) => o?.preventScroll === true)).toBe(true);
  });
});

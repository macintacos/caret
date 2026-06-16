import "../../test-mount.ts";
import { describe, expect, test } from "bun:test";
import { render } from "../../test-mount.ts";
import SourceComposer from "./SourceComposer.svelte";

// SourceComposer is the inline comment editor for the source-view gutter flow.
// It wraps MarkdownEditor (the CodeMirror boundary) with the range label and the
// Cancel/Comment buttons, and wires submit/cancel — via the buttons and via the
// chords the editor reports — plus draft surfacing through onInput. Real typing
// and caret behaviour live in e2e (CodeMirror needs a real browser); these units
// drive the seeded value and the reported chords to cover the wiring.

function mount(over: Record<string, unknown> = {}) {
  const submitted: string[] = [];
  const cancelledWith: string[] = [];
  const { target, flush } = render(SourceComposer, {
    startLine: 3,
    endLine: 3,
    onSubmit: (c: string) => submitted.push(c),
    onCancel: (c: string) => cancelledWith.push(c),
    ...over,
  });
  flush();
  const buttons = Array.from(target.querySelectorAll("button"));
  return {
    target,
    content: target.querySelector(".cm-content") as HTMLElement,
    submitBtn: buttons.find((b) => b.textContent?.includes("Comment")) ?? null,
    cancelBtn: buttons.find((b) => b.textContent?.includes("Cancel")) ?? null,
    submitted,
    cancelledWith,
    cancelled: () => cancelledWith.length,
  };
}

function key(content: HTMLElement, k: string, mods: Partial<KeyboardEventInit> = {}) {
  content.dispatchEvent(
    new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...mods }),
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

describe("SourceComposer submit/cancel", () => {
  test("the Comment button submits the current text", () => {
    const { submitBtn, submitted } = mount({ initial: "resume me" });
    submitBtn!.click();
    expect(submitted).toEqual(["resume me"]);
  });

  test("the Cancel button hands back the current text", () => {
    const { cancelBtn, cancelledWith } = mount({ initial: "draft text" });
    cancelBtn!.click();
    expect(cancelledWith).toEqual(["draft text"]);
  });
});

describe("SourceComposer keyboard chords", () => {
  test("Cmd/Ctrl+Enter submits", () => {
    const { content, submitted } = mount({ initial: "via chord" });
    key(content, "Enter", { metaKey: true });
    expect(submitted).toEqual(["via chord"]);
  });

  test("Escape cancels", () => {
    const { content, cancelled } = mount();
    key(content, "Escape");
    expect(cancelled()).toBe(1);
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

import "../../test-mount.ts";
import { describe, expect, test } from "bun:test";
import { render } from "../../test-mount.ts";
import SourceComposer from "./SourceComposer.svelte";

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
    content: target.querySelector(".cm-content") as HTMLElement,
    submitBtn: buttons.find((b) => b.textContent?.includes("Comment")) ?? null,
    discardBtn: buttons.find((b) => b.textContent?.trim() === "Discard") ?? null,
    keepBtn: buttons.find((b) => b.textContent?.includes("Keep for later")) ?? null,
    submitted,
    keptWith,
    discardCount: () => discardCalls,
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

  test("the Discard button drops the draft, keeping nothing", () => {
    const { discardBtn, discardCount, keptWith } = mount({ initial: "draft text" });
    discardBtn!.click();
    expect(discardCount()).toBe(1);
    expect(keptWith).toHaveLength(0);
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

  test("Escape discards the draft", () => {
    const { content, discardCount } = mount({ initial: "abandon me" });
    key(content, "Escape");
    expect(discardCount()).toBe(1);
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

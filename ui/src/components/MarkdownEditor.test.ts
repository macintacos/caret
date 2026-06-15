import "../../test-mount.ts";
import { describe, expect, test } from "bun:test";
import { render } from "../../test-mount.ts";
import MarkdownEditor from "./MarkdownEditor.svelte";

// MarkdownEditor is the swappable CodeMirror boundary. These units cover the
// engine-agnostic contract that SourceComposer and the annotation-card edit
// field depend on: it mounts an editing surface, seeds and reports the value,
// styles code, and routes the submit/cancel chords. Real typing, caret
// behaviour, and pixel layout are e2e (CodeMirror needs a real browser for
// those); happy-dom is enough to construct the view and exercise the contract.

function dispatchKey(target: HTMLElement, key: string, mods: Partial<KeyboardEventInit> = {}) {
  const content = target.querySelector(".cm-content") as HTMLElement;
  content.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...mods }),
  );
}

describe("MarkdownEditor mount", () => {
  test("renders a contenteditable editor surface", () => {
    const { target, flush } = render(MarkdownEditor, { onInput: () => {} });
    flush();
    const content = target.querySelector(".cm-content");
    expect(content).not.toBeNull();
    expect(content?.getAttribute("contenteditable")).toBe("true");
  });

  test("seeds the initial value into the editor", () => {
    const { target, flush } = render(MarkdownEditor, { value: "hello world", onInput: () => {} });
    flush();
    expect(target.querySelector(".cm-content")?.textContent).toContain("hello world");
  });

  test("reports the seed via onInput on mount", () => {
    const seen: string[] = [];
    const { flush } = render(MarkdownEditor, {
      value: "seed",
      onInput: (t: string) => seen.push(t),
    });
    flush();
    expect(seen[0]).toBe("seed");
  });
});

describe("MarkdownEditor code styling", () => {
  test("marks inline code with the monospace pill decoration", () => {
    const { target, flush } = render(MarkdownEditor, { value: "a `code` b", onInput: () => {} });
    flush();
    const code = target.querySelector(".cm-md-code");
    expect(code).not.toBeNull();
    expect(code?.textContent).toContain("`code`");
  });

  test("renders a fenced block as a full-width code block (line decorations)", () => {
    const { target, flush } = render(MarkdownEditor, {
      value: "```\nconst x = 1\n```",
      onInput: () => {},
    });
    flush();
    const lines = Array.from(target.querySelectorAll(".cm-md-codeblock"));
    // ``` open, the content line, and ``` close all carry the block class.
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines.map((l) => l.textContent).join(" ")).toContain("const x = 1");
    expect(target.querySelector(".cm-md-codeblock-open")).not.toBeNull();
    expect(target.querySelector(".cm-md-codeblock-close")).not.toBeNull();
  });

  function contentLine(target: HTMLElement) {
    return Array.from(target.querySelectorAll(".cm-md-codeblock")).find((l) =>
      l.textContent?.includes("const x = 1"),
    );
  }

  test("highlights fenced code for a known language", () => {
    const { target, flush } = render(MarkdownEditor, {
      value: "```javascript\nconst x = 1\n```",
      onInput: () => {},
    });
    flush();
    // The language parser tokenizes the body into spans — `const` becomes a
    // highlighted keyword span (a no-language fence leaves it as plain text).
    expect(contentLine(target)?.querySelector("span")).not.toBeNull();
  });

  test("leaves a fence with no language as plain (untokenized) text", () => {
    const { target, flush } = render(MarkdownEditor, {
      value: "```\nconst x = 1\n```",
      onInput: () => {},
    });
    flush();
    expect(contentLine(target)?.querySelector("span")).toBeNull();
  });
});

describe("MarkdownEditor chords", () => {
  test("Cmd+Enter fires onSubmitChord", () => {
    let submits = 0;
    const { target, flush } = render(MarkdownEditor, {
      onSubmitChord: () => submits++,
      onInput: () => {},
    });
    flush();
    dispatchKey(target, "Enter", { metaKey: true });
    expect(submits).toBe(1);
  });

  test("Ctrl+Enter fires onSubmitChord", () => {
    let submits = 0;
    const { target, flush } = render(MarkdownEditor, {
      onSubmitChord: () => submits++,
      onInput: () => {},
    });
    flush();
    dispatchKey(target, "Enter", { ctrlKey: true });
    expect(submits).toBe(1);
  });

  test("Escape fires onCancelChord", () => {
    let cancels = 0;
    const { target, flush } = render(MarkdownEditor, {
      onCancelChord: () => cancels++,
      onInput: () => {},
    });
    flush();
    dispatchKey(target, "Escape");
    expect(cancels).toBe(1);
  });

  test("a bare Enter does not fire onSubmitChord", () => {
    let submits = 0;
    const { target, flush } = render(MarkdownEditor, {
      onSubmitChord: () => submits++,
      onInput: () => {},
    });
    flush();
    dispatchKey(target, "Enter");
    expect(submits).toBe(0);
  });
});

describe("MarkdownEditor focus", () => {
  test("autofocus focuses the editor with preventScroll", () => {
    const proto = HTMLElement.prototype;
    const orig = proto.focus;
    const optsSeen: Array<FocusOptions | undefined> = [];
    proto.focus = function (opts?: FocusOptions) {
      optsSeen.push(opts);
      return orig.call(this, opts);
    };
    try {
      const { flush } = render(MarkdownEditor, { autofocus: true, onInput: () => {} });
      flush();
      expect(optsSeen.some((o) => o?.preventScroll === true)).toBe(true);
    } finally {
      proto.focus = orig;
    }
  });
});

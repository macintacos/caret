import "../../test-mount.ts";
import { describe, expect, test } from "bun:test";

import CodeCopyButton from "@/components/CodeCopyButton.svelte";

import { render } from "../../test-mount.ts";

// CodeCopyButton is the per-code-block copy affordance. These units cover the
// contract DiffPlanView depends on: it positions itself, writes the block's code
// to the injected clipboard on click, and confirms with a checkmark (reverting is a
// timer, and the animation is CSS — both are e2e). happy-dom is enough for the
// state/label swap; the injected `copy` keeps it off a real clipboard.

// Lets a click's async handler settle (the awaited copy + the reactive update).
const settle = () => Promise.resolve().then(() => Promise.resolve());

describe("CodeCopyButton", () => {
  test("positions itself at the given content coordinates", () => {
    const { target, flush } = render(CodeCopyButton, {
      text: "x",
      top: 12,
      left: 34,
      copy: async () => {},
    });
    flush();
    const button = target.querySelector("button.code-copy") as HTMLButtonElement;
    expect(button.style.top).toBe("12px");
    expect(button.style.left).toBe("34px");
    expect(button.getAttribute("aria-label")).toBe("Copy code");
  });

  test("writes the block's code to the clipboard and confirms with a checkmark", async () => {
    let written: string | undefined;
    const copy = (t: string) => {
      written = t;
      return Promise.resolve();
    };
    const { target, flush } = render(CodeCopyButton, {
      text: "const x = 1;\nreturn x;",
      top: 0,
      left: 0,
      copy,
    });
    flush();
    const button = target.querySelector("button.code-copy") as HTMLButtonElement;
    button.click();
    await settle();
    flush();

    expect(written).toBe("const x = 1;\nreturn x;");
    expect(button.getAttribute("aria-label")).toBe("Copied");
    expect(target.querySelector(".glyph.done")).not.toBeNull();
  });

  test("stays as the copy glyph when the clipboard write rejects", async () => {
    const copy = () => Promise.reject(new Error("denied"));
    const { target, flush } = render(CodeCopyButton, { text: "x", top: 0, left: 0, copy });
    flush();
    const button = target.querySelector("button.code-copy") as HTMLButtonElement;
    button.click();
    await settle();
    flush();

    expect(button.getAttribute("aria-label")).toBe("Copy code");
    expect(target.querySelector(".glyph.done")).toBeNull();
  });
});

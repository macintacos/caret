import "@ui/support/mount.ts";
import { describe, expect, test } from "bun:test";

import { render } from "@ui/support/mount.ts";
import CodeChromeTray from "@/components/CodeChromeTray.svelte";

// happy-dom is enough for the state/label swaps; the wrap's actual effect on layout is e2e
// (test/e2e/code-chrome.e2e.ts, test/e2e/advanced.e2e.ts), and the injected `copy` keeps
// this off a real clipboard.

// Lets a click's async handler settle (the awaited copy + the reactive update).
const settle = () => Promise.resolve().then(() => Promise.resolve());

const BASE_PROPS = {
  text: "x",
  copyName: "code from line 42",
  wrapName: "from line 42",
  wrappable: false,
  reflowed: false,
  onToggleReflow: () => {},
  copy: async () => {},
};

describe("CodeChromeTray", () => {
  test("writes the block's code to the clipboard and confirms with a checkmark", async () => {
    let written: string | undefined;
    const copy = (t: string) => {
      written = t;
      return Promise.resolve();
    };
    const { target, flush } = render(CodeChromeTray, {
      ...BASE_PROPS,
      text: "const x = 1;\nreturn x;",
      copy,
    });
    flush();
    const button = target.querySelector("button.code-copy") as HTMLButtonElement;
    expect(button.getAttribute("aria-label")).toBe("Copy code from line 42");
    button.click();
    await settle();
    flush();

    expect(written).toBe("const x = 1;\nreturn x;");
    expect(button.getAttribute("aria-label")).toBe("Copied code from line 42");
    expect(target.querySelector(".glyph.done")).not.toBeNull();
  });

  test("stays as the copy glyph when the clipboard write rejects", async () => {
    const copy = () => Promise.reject(new Error("denied"));
    const { target, flush } = render(CodeChromeTray, { ...BASE_PROPS, copy });
    flush();
    const button = target.querySelector("button.code-copy") as HTMLButtonElement;
    button.click();
    await settle();
    flush();

    expect(button.getAttribute("aria-label")).toBe("Copy code from line 42");
    expect(target.querySelector(".glyph.done")).toBeNull();
  });

  test("offers the wrap toggle only for a block wide enough to need it", () => {
    const fits = render(CodeChromeTray, BASE_PROPS);
    fits.flush();
    expect(fits.target.querySelector("button.code-wrap")).toBeNull();

    const overflows = render(CodeChromeTray, { ...BASE_PROPS, wrappable: true });
    overflows.flush();
    expect(overflows.target.querySelector("button.code-wrap")).not.toBeNull();
  });

  test("announces whether the block is currently wrapped", () => {
    const off = render(CodeChromeTray, { ...BASE_PROPS, wrappable: true });
    off.flush();
    const unwrapped = off.target.querySelector("button.code-wrap") as HTMLButtonElement;
    expect(unwrapped.getAttribute("aria-pressed")).toBe("false");
    expect(unwrapped.getAttribute("aria-label")).toBe("Wrap long lines from line 42");

    const on = render(CodeChromeTray, { ...BASE_PROPS, wrappable: true, reflowed: true });
    on.flush();
    const wrapped = on.target.querySelector("button.code-wrap") as HTMLButtonElement;
    expect(wrapped.getAttribute("aria-pressed")).toBe("true");
    expect(wrapped.getAttribute("aria-label")).toBe("Wrap long lines from line 42");
  });

  test("leaves the copy button out of the toggle contract", () => {
    const { target, flush } = render(CodeChromeTray, { ...BASE_PROPS, wrappable: true });
    flush();
    const copyButton = target.querySelector("button.code-copy") as HTMLButtonElement;
    expect(copyButton.getAttribute("aria-pressed")).toBeNull();
  });

  test("reports the wrap toggle to its host", () => {
    let toggles = 0;
    const { target, flush } = render(CodeChromeTray, {
      ...BASE_PROPS,
      wrappable: true,
      onToggleReflow: () => {
        toggles += 1;
      },
    });
    flush();
    (target.querySelector("button.code-wrap") as HTMLButtonElement).click();
    expect(toggles).toBe(1);
  });
});

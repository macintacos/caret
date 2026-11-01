import "@ui/support/mount.ts";
import { describe, expect, test } from "bun:test";

import { render } from "@ui/support/mount.ts";
import CodeBlockChrome from "@/components/CodeBlockChrome.svelte";

// The placement over a plan code block. The copy and wrap controls themselves are
// CodeChromeTray's, covered in CodeChromeTray.test.ts.

const BASE_PROPS = {
  text: "x",
  top: 0,
  left: 0,
  wrappable: false,
  reflowed: false,
  start: 42,
  hovered: false,
  onToggleReflow: () => {},
  copy: async () => {},
};

describe("CodeBlockChrome", () => {
  test("positions itself at the given content coordinates", () => {
    const { target, flush } = render(CodeBlockChrome, { ...BASE_PROPS, top: 12, left: 34 });
    flush();
    const box = target.querySelector(".code-chrome") as HTMLElement;
    expect(box.style.top).toBe("12px");
    expect(box.style.left).toBe("34px");
  });

  test("names its controls after the block's opening line", () => {
    const { target, flush } = render(CodeBlockChrome, { ...BASE_PROPS, wrappable: true });
    flush();
    expect(target.querySelector("button.code-copy")?.getAttribute("aria-label")).toBe(
      "Copy code from line 42",
    );
    expect(target.querySelector("button.code-wrap")?.getAttribute("aria-label")).toBe(
      "Wrap long lines from line 42",
    );
  });

  test("brightens while the pointer is over its block", () => {
    const resting = render(CodeBlockChrome, BASE_PROPS);
    resting.flush();
    expect(
      (resting.target.querySelector(".code-chrome") as HTMLElement).dataset.lit,
    ).toBeUndefined();

    const lit = render(CodeBlockChrome, { ...BASE_PROPS, hovered: true });
    lit.flush();
    expect((lit.target.querySelector(".code-chrome") as HTMLElement).dataset.lit).toBe("");
  });
});

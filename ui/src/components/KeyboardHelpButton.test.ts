import "../../test-mount.ts";

import { describe, expect, test } from "bun:test";

import KeyboardHelpButton from "@/components/KeyboardHelpButton.svelte";

import { render } from "../../test-mount.ts";

describe("KeyboardHelpButton", () => {
  test("renders a labelled button with the vendored keyboard glyph and the ? cap", () => {
    const { target } = render(KeyboardHelpButton, { onOpen: () => {} });
    const button = target.querySelector("button");
    expect(button?.getAttribute("aria-label")).toBe("Keyboard shortcuts");
    // The vendored keyboard icon inlines an <svg>; the ? key cap rides a <kbd>.
    expect(target.querySelector("svg") !== null).toBe(true);
    expect(button?.textContent).toContain("?");
  });

  test("clicking it fires onOpen", () => {
    let opened = false;
    const { target } = render(KeyboardHelpButton, {
      onOpen: () => {
        opened = true;
      },
    });
    target.querySelector("button")?.click();
    expect(opened).toBe(true);
  });
});

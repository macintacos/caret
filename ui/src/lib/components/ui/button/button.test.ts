import "@ui/support/mount.ts";

import { describe, expect, test } from "bun:test";

import { Button, type ButtonSize, type ButtonVariant } from "$lib/components/ui/button/index.js";

import { render } from "@ui/support/mount.ts";

// The recipe in button.svelte carries caret's own edits: the marker classes the
// tactile kit in styles/atoms.css keys on. A `shadcn add --overwrite` reverts them
// with no visible error, so these pin them.
function classesOf(variant: ButtonVariant, size?: ButtonSize): string[] {
  const { target } = render(Button, { variant, size, children: undefined });
  return [...(target.querySelector("button[data-slot='button']")?.classList ?? [])];
}

describe("Button", () => {
  test("the default variant is the amber rubber cap", () => {
    expect(classesOf("default")).toEqual(expect.arrayContaining(["cap", "cap-accent"]));
  });

  test("the ghost variant takes the pressed dimple", () => {
    expect(classesOf("ghost")).toContain("cap-ghost");
  });

  test("the icon size marks its cap square, so a submit tray can size it", () => {
    expect(classesOf("default", "icon")).toContain("cap-square");
  });

  test("a press sinks the cap in place rather than shifting it", () => {
    expect(classesOf("default").filter((c) => c.includes("translate"))).toEqual([]);
  });
});

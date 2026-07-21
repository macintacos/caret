import "../../test-mount.ts";
import { describe, expect, test } from "bun:test";

import CwdChip from "@/components/CwdChip.svelte";

import { capture, render } from "../../test-mount.ts";

const CWD = "/Users/dev/GitLocal/Play/caret";

describe("CwdChip", () => {
  test("renders the abbreviated path", () => {
    const { target } = render(CwdChip, { cwd: CWD, onCopy: () => {} });
    const btn = target.querySelector("button.cwd-chip");
    expect(btn?.textContent?.trim()).toBe("…/Play/caret");
  });

  test("clicking copies the full absolute path via onCopy", () => {
    const copied = capture<string>();
    const { target } = render(CwdChip, { cwd: CWD, onCopy: copied.cb });
    target.querySelector<HTMLButtonElement>("button.cwd-chip")?.click();
    expect(copied.last()).toBe(CWD);
  });

  test("wears the float-chip + mono atoms and names the full path, with no tooltip", () => {
    const { target } = render(CwdChip, { cwd: CWD, onCopy: () => {} });
    const btn = target.querySelector("button.cwd-chip");
    expect(btn?.classList.contains("float-chip")).toBe(true);
    expect(btn?.classList.contains("mono")).toBe(true);
    expect(btn?.getAttribute("aria-label")).toContain(CWD);
    // No hover popup — the whole point of EXC-850 (no native title, no tooltip).
    expect(btn?.hasAttribute("title")).toBe(false);
  });
});

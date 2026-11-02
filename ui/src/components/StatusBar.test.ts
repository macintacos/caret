import "@ui/support/mount.ts";

import { describe, expect, test } from "bun:test";

import { capture, render } from "@ui/support/mount.ts";
import StatusBar from "@/components/StatusBar.svelte";

const base = {
  version: "0.6.0",
  commit: "abc123def456",
  isDev: false,
  active: true,
  pendingCount: 2,
  coveredLines: 5,
  reviewVersion: 3,
  connected: true,
  commentsOpen: false,
  onToggleComments: () => {},
  onOpenHelp: () => {},
  showShortcutHints: true,
  cwd: "/tmp/p",
  onCopyCwd: () => {},
};

const cwdButton = (root: ParentNode) => root.querySelector<HTMLButtonElement>("button.cwd");

const keyboardButton = (root: ParentNode) =>
  root.querySelector<HTMLButtonElement>("button[aria-label='Keyboard shortcuts']");

describe("StatusBar", () => {
  test("lays out the version, review-status, and keyboard segments", () => {
    const { target } = render(StatusBar, base);
    expect(target.querySelector(".status-bar") !== null).toBe(true);
    expect(target.querySelector(".version-badge") !== null).toBe(true);
    expect(target.querySelector(".status-strip") !== null).toBe(true);
    expect(keyboardButton(target) !== null).toBe(true);
  });

  test("the keyboard segment opens the help modal", () => {
    let opened = false;
    const { target } = render(StatusBar, {
      ...base,
      onOpenHelp: () => {
        opened = true;
      },
    });
    keyboardButton(target)?.click();
    expect(opened).toBe(true);
  });

  test("hides the keyboard button when shortcut hints are off", () => {
    const { target } = render(StatusBar, { ...base, showShortcutHints: false });
    // Boolean-ise the absence check — a bare toBeNull() on a stray node hangs bun.
    expect(keyboardButton(target) === null).toBe(true);
  });

  test("with no active review the status segment drops but version + keyboard stay", () => {
    const { target } = render(StatusBar, { ...base, active: false });
    // Boolean-ise the absence check — a bare toBeNull() on a stray node hangs bun.
    expect(target.querySelector(".status-strip") === null).toBe(true);
    expect(target.querySelector(".version-badge") !== null).toBe(true);
    expect(keyboardButton(target) !== null).toBe(true);
  });

  // The working-directory path (EXC-807) shows abbreviated and copies the whole path on a
  // click, with no hover tooltip (EXC-850).
  test("clicking the working-directory path copies the full absolute path", () => {
    const copied = capture<string>();
    const deep = "/Users/dev/GitLocal/Play/caret";
    const { target } = render(StatusBar, { ...base, cwd: deep, onCopyCwd: copied.cb });
    expect(cwdButton(target)?.textContent?.trim()).toBe("…/Play/caret");
    cwdButton(target)?.click();
    expect(copied.last()).toBe(deep);
  });

  test("with no review there is no working-directory path", () => {
    const { target } = render(StatusBar, { ...base, active: false, cwd: undefined });
    // Boolean-ise the absence check — a bare toBeNull() on a stray node hangs bun.
    expect(cwdButton(target) === null).toBe(true);
  });
});

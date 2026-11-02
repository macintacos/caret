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
  onCopyCwd: async () => {},
};

const cwdButton = (root: ParentNode) => root.querySelector<HTMLButtonElement>("button.cwd");

/** The path the working-directory pill shows. */
const cwdPath = (root: ParentNode) => root.querySelector("button.cwd .path")?.textContent;

// Lets a click's async handler settle (the awaited copy + the reactive update).
const settle = () => Promise.resolve().then(() => Promise.resolve());

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

  test("shows a working directory inside home from ~", () => {
    const { target, flush } = render(StatusBar, {
      ...base,
      cwd: "/Users/dev/wt/caret",
      home: "/Users/dev",
    });
    flush();
    expect(cwdPath(target)).toBe("~/wt/caret");
  });

  test("shows a working directory outside home as its absolute path", () => {
    const { target, flush } = render(StatusBar, {
      ...base,
      cwd: "/opt/work/proj",
      home: "/Users/dev",
    });
    flush();
    expect(cwdPath(target)).toBe("/opt/work/proj");
  });

  test("clicking the working-directory path copies the full absolute path", () => {
    const copied = capture<string>();
    const deep = "/Users/dev/GitLocal/Play/caret";
    const { target } = render(StatusBar, {
      ...base,
      cwd: deep,
      home: "/Users/dev",
      onCopyCwd: async (cwd: string) => copied.cb(cwd),
    });
    cwdButton(target)?.click();
    expect(copied.last()).toBe(deep);
  });

  test("a copy that lands confirms on the path itself and announces it", async () => {
    const { target, flush } = render(StatusBar, base);
    cwdButton(target)?.click();
    await settle();
    flush();
    expect(cwdButton(target)?.hasAttribute("data-copied")).toBe(true);
    expect(target.querySelector("[role='status']")?.textContent?.trim()).toBe(
      "Copied path to clipboard",
    );
  });

  test("a copy the clipboard refuses leaves the path as it was", async () => {
    const { target, flush } = render(StatusBar, {
      ...base,
      onCopyCwd: () => Promise.reject(new Error("denied")),
    });
    cwdButton(target)?.click();
    await settle();
    flush();
    expect(cwdButton(target)?.hasAttribute("data-copied")).toBe(false);
    expect(target.querySelector("[role='status']")?.textContent?.trim()).toBe("");
  });

  test("with no review there is no working-directory path", () => {
    const { target } = render(StatusBar, { ...base, active: false, cwd: undefined });
    // Boolean-ise the absence check — a bare toBeNull() on a stray node hangs bun.
    expect(cwdButton(target) === null).toBe(true);
  });
});

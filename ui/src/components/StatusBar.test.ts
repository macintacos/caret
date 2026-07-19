import "../../test-mount.ts";

import { describe, expect, test } from "bun:test";

import StatusBar from "@/components/StatusBar.svelte";

import { render } from "../../test-mount.ts";

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
};

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

  test("with no active review the status segment drops but version + keyboard stay", () => {
    const { target } = render(StatusBar, { ...base, active: false });
    // Boolean-ise the absence check — a bare toBeNull() on a stray node hangs bun.
    expect(target.querySelector(".status-strip") === null).toBe(true);
    expect(target.querySelector(".version-badge") !== null).toBe(true);
    expect(keyboardButton(target) !== null).toBe(true);
  });
});

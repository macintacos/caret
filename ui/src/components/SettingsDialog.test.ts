import "../../test-mount.ts";

import { describe, expect, test } from "bun:test";

import SettingsDialog from "@/components/SettingsDialog.svelte";
import { THEMES } from "$lib/theme.ts";

import { capture, flushUntil, render } from "../../test-mount.ts";

const baseProps = {
  current: "caret-dark" as const,
  onSelect: () => {},
  onClose: () => {},
  showShortcutHints: true,
  onToggleShortcutHints: () => {},
};

// bits-ui Dialog portals its content to document.body on a deferred tick, so
// structure/ARIA is asserted against the body after an effect+timer flush (the
// shadcn-foundation verdict). The ThemePicker's dropdown — opening it, the option
// list, live-preview navigation — is real-browser interaction, covered by
// test/e2e/theme.e2e.ts, not here.
const content = () => document.body.querySelector("[data-slot='dialog-content']");
const mounted = () => content() !== null;

describe("SettingsDialog render", () => {
  test("mounts a dialog titled Settings", async () => {
    const { flush } = render(SettingsDialog, baseProps);
    await flushUntil(flush, mounted);
    expect(content()?.getAttribute("role")).toBe("dialog");
    expect(document.body.querySelector("[data-slot='dialog-title']")?.textContent).toContain(
      "Settings",
    );
  });

  test("the theme trigger shows the applied theme's label", async () => {
    const { flush } = render(SettingsDialog, { ...baseProps, current: "caret-light" });
    await flushUntil(flush, mounted);
    // The ThemePicker's closed trigger is a labelled button carrying the applied
    // theme's label (the open menu + options are portalled interaction, e2e-only).
    const trigger = document.body.querySelector("button[aria-label='Theme']");
    expect(trigger?.textContent).toContain(THEMES["caret-light"].label);
  });
});

describe("SettingsDialog shortcut hints", () => {
  const switchEl = () => document.body.querySelector("[data-slot='switch']");

  test("renders a switch reflecting showShortcutHints (on)", async () => {
    const { flush } = render(SettingsDialog, { ...baseProps, showShortcutHints: true });
    await flushUntil(flush, mounted);
    expect(switchEl()?.getAttribute("data-state")).toBe("checked");
  });

  test("renders the switch off when showShortcutHints is false", async () => {
    const { flush } = render(SettingsDialog, { ...baseProps, showShortcutHints: false });
    await flushUntil(flush, mounted);
    expect(switchEl()?.getAttribute("data-state")).toBe("unchecked");
  });

  test("toggling the switch fires onToggleShortcutHints with the new value", async () => {
    const changed = capture<boolean>();
    const { flush } = render(SettingsDialog, {
      ...baseProps,
      showShortcutHints: true,
      onToggleShortcutHints: changed.cb,
    });
    await flushUntil(flush, mounted);
    (switchEl() as HTMLButtonElement).click();
    flush();
    expect(changed.last()).toBe(false);
  });
});

describe("SettingsDialog wiring", () => {
  test("clicking Done fires onClose", async () => {
    let closed = false;
    const { flush } = render(SettingsDialog, {
      ...baseProps,
      onClose: () => {
        closed = true;
      },
    });
    await flushUntil(flush, mounted);
    const done = [...document.body.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Done",
    );
    done?.click();
    expect(closed).toBe(true);
  });
});

import "../../test-mount.ts";

import { afterEach, describe, expect, test } from "bun:test";

import SettingsDialog from "@/components/SettingsDialog.svelte";
import { writeDiffStyle } from "$lib/diffStylePref.ts";
import { SETTINGS_REGISTRY, type StagedField } from "$lib/settingsRegistry.ts";

import { flushUntil, render } from "../../test-mount.ts";

afterEach(() => localStorage.clear());

function props(over: Record<string, unknown> = {}) {
  return {
    entries: SETTINGS_REGISTRY,
    onChange: () => {},
    onClose: () => {},
    ...over,
  };
}

// bits-ui Dialog portals its content to document.body on a deferred tick, so
// structure/ARIA is asserted against the body after an effect+timer flush (the
// shadcn-foundation verdict). Real interaction — Esc dismiss, focus, the theme
// dropdown's open/nav/pick, live apply — is real-browser behavior, covered by
// test/e2e/settings.e2e.ts. DOM-node presence is asserted as a boolean (a failing
// `.toBeNull()` on a live happy-dom node hangs bun serializing the circular node).
const content = () => document.body.querySelector("[data-slot='dialog-content']");
const mounted = () => content() !== null;
const has = (sel: string) => document.body.querySelector(sel) !== null;

describe("SettingsDialog shell", () => {
  test("mounts a dialog whose accessible name is Settings", async () => {
    const { flush } = render(SettingsDialog, props());
    await flushUntil(flush, mounted);
    expect(content()?.getAttribute("role")).toBe("dialog");
    expect(document.body.querySelector("[data-slot='dialog-title']")?.textContent).toContain(
      "Settings",
    );
  });

  test("renders a nav row for the populated Appearance category only", async () => {
    const { flush } = render(SettingsDialog, props());
    await flushUntil(flush, mounted);
    expect(has("[data-category='Appearance']")).toBe(true);
    // Diff view folded into Appearance as a section, so it is no longer its own
    // nav row; General has no entries either.
    expect(has("[data-category='Diff view']")).toBe(false);
    expect(has("[data-category='General']")).toBe(false);
  });

  test("the Appearance pane renders theme, shortcut hints, and the Diff view fields", async () => {
    const { flush } = render(SettingsDialog, props());
    await flushUntil(flush, mounted);
    expect(has("button[aria-label='Theme']")).toBe(true);
    expect(has("[data-slot='switch']")).toBe(true);
    // The Diff view section's fields now live in the same (Appearance) pane.
    expect(has("button[aria-label='Layout']")).toBe(true);
    expect(has("button[aria-label='Change markers']")).toBe(true);
  });

  test("groups the diff prefs under a 'Diff view' section header", async () => {
    const { flush } = render(SettingsDialog, props());
    await flushUntil(flush, mounted);
    const heads = [...document.body.querySelectorAll(".section-head")].map((h) =>
      h.textContent?.trim(),
    );
    expect(heads).toContain("Diff view");
  });

  test("no save chip — edits apply immediately", async () => {
    const { flush } = render(SettingsDialog, props());
    await flushUntil(flush, mounted);
    expect(has(".save-chip")).toBe(false);
  });
});

describe("SettingsDialog immediate apply", () => {
  test("toggling the shortcut-hints switch calls onChange with the field and its new value", async () => {
    const calls: Array<{ key: string; value: unknown }> = [];
    const { flush } = render(
      SettingsDialog,
      props({ onChange: (f: StagedField, v: unknown) => calls.push({ key: f.key, value: v }) }),
    );
    await flushUntil(flush, mounted);
    // Default (fresh) is on, so the first click turns it off.
    (document.body.querySelector("[data-slot='switch']") as HTMLButtonElement).click();
    flush();
    expect(calls).toEqual([{ key: "shortcutHints", value: false }]);
  });

  test("a select control shows the current persisted value's label", async () => {
    writeDiffStyle("unified");
    const { flush } = render(SettingsDialog, props());
    await flushUntil(flush, mounted);
    const label = document.body.querySelector("button[aria-label='Layout'] .trigger-label");
    expect(label?.textContent?.trim()).toBe("Unified");
  });
});

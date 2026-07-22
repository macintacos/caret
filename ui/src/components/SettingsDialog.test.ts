import "../../test-mount.ts";

import { afterEach, describe, expect, test } from "bun:test";

import SettingsDialog from "@/components/SettingsDialog.svelte";
import { createSettingsDraft, type SettingsDraftStore } from "@/state/settingsDraft.ts";
import { isStagedField, SETTINGS_REGISTRY } from "$lib/settingsRegistry.ts";

import { flushUntil, render } from "../../test-mount.ts";

afterEach(() => localStorage.clear());

const fields = SETTINGS_REGISTRY.filter(isStagedField);

/** A draft over a plain store (the state-factory pattern) seeded with `staged`. In
 * the real app App.svelte owns a `$state` store so mutations re-render; here the
 * plain store means we assert the RENDER of a seeded dirty state, and assert staging
 * against the draft object directly (not a re-render). */
function makeDraft(staged: Record<string, unknown> = {}) {
  const store: SettingsDraftStore = { staged: { ...staged } };
  return { store, draft: createSettingsDraft(store, fields) };
}

function props(over: Record<string, unknown> = {}) {
  return {
    draft: makeDraft().draft,
    entries: SETTINGS_REGISTRY,
    showShortcutHints: true,
    onSave: () => {},
    onClose: () => {},
    ...over,
  };
}

// bits-ui Dialog portals its content to document.body on a deferred tick, so
// structure/ARIA is asserted against the body after an effect+timer flush (the
// shadcn-foundation verdict). Real interaction — ⌘↩ save, Esc dismiss, focus, the
// theme dropdown's open/nav/pick — is real-browser behavior, covered by
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

  test("renders a sidebar nav row for each populated category, not empty ones", async () => {
    const { flush } = render(SettingsDialog, props());
    await flushUntil(flush, mounted);
    expect(has("[data-category='Appearance']")).toBe(true);
    expect(has("[data-category='Diff view']")).toBe(true);
    // General has no entries after the taxonomy move, so it never renders.
    expect(has("[data-category='General']")).toBe(false);
  });

  test("the default (Appearance) pane renders the theme select and the shortcut-hints switch", async () => {
    const { flush } = render(SettingsDialog, props());
    await flushUntil(flush, mounted);
    expect(has("button[aria-label='Theme']")).toBe(true);
    expect(has("[data-slot='switch']")).toBe(true);
    // Diff view fields are not in the default pane.
    expect(has("button[aria-label='Layout']")).toBe(false);
  });

  test("navigating to Diff view swaps the pane to its fields", async () => {
    const { flush } = render(SettingsDialog, props());
    await flushUntil(flush, mounted);
    (document.body.querySelector("[data-category='Diff view']") as HTMLButtonElement).click();
    flush();
    expect(has("button[aria-label='Layout']")).toBe(true);
    expect(has("button[aria-label='Change markers']")).toBe(true);
    // The theme control from Appearance is gone.
    expect(has("button[aria-label='Theme']")).toBe(false);
  });
});

describe("SettingsDialog dirty state + chip", () => {
  test("no save chip when the draft is clean", async () => {
    const { flush } = render(SettingsDialog, props());
    await flushUntil(flush, mounted);
    expect(has(".save-chip")).toBe(false);
  });

  test("a staged field raises the chip with the count and marks the field + its category", async () => {
    const { flush } = render(
      SettingsDialog,
      props({ draft: makeDraft({ theme: "caret-light" }).draft }),
    );
    await flushUntil(flush, mounted);
    expect(has(".save-chip")).toBe(true);
    expect(document.body.querySelector(".save-chip")?.textContent).toContain("1 unsaved change");
    expect(has("[data-field='theme'] .dirty-dot")).toBe(true);
    expect(has("[data-category='Appearance'] .dirty-dot")).toBe(true);
    expect(has("[data-category='Diff view'] .dirty-dot")).toBe(false);
  });

  test("the Save button shows the key caps only when shortcut hints are on", async () => {
    const on = render(
      SettingsDialog,
      props({ draft: makeDraft({ theme: "caret-light" }).draft, showShortcutHints: true }),
    );
    await flushUntil(on.flush, mounted);
    expect(has(".save-chip [data-slot='kbd']")).toBe(true);

    // Re-rendering purges the first mount's portal, so the second is asserted alone.
    const off = render(
      SettingsDialog,
      props({ draft: makeDraft({ theme: "caret-light" }).draft, showShortcutHints: false }),
    );
    await flushUntil(off.flush, mounted);
    expect(has(".save-chip [data-slot='kbd']")).toBe(false);
  });
});

describe("SettingsDialog wiring", () => {
  test("toggling the shortcut-hints switch stages it in the draft", async () => {
    const { store, draft } = makeDraft();
    const { flush } = render(SettingsDialog, props({ draft }));
    await flushUntil(flush, mounted);
    (document.body.querySelector("[data-slot='switch']") as HTMLButtonElement).click();
    flush();
    expect(draft.isDirty()).toBe(true);
    expect("shortcutHints" in store.staged).toBe(true);
  });

  test("the chip's Discard clears the draft", async () => {
    const { draft } = makeDraft({ theme: "caret-light" });
    const { flush } = render(SettingsDialog, props({ draft }));
    await flushUntil(flush, mounted);
    const discard = [...document.body.querySelectorAll(".save-chip button")].find(
      (b) => b.textContent?.trim() === "Discard",
    ) as HTMLButtonElement;
    discard.click();
    flush();
    expect(draft.isDirty()).toBe(false);
  });

  test("the chip's Save calls onSave", async () => {
    let saved = false;
    const { flush } = render(
      SettingsDialog,
      props({
        draft: makeDraft({ theme: "caret-light" }).draft,
        onSave: () => {
          saved = true;
        },
      }),
    );
    await flushUntil(flush, mounted);
    const save = [...document.body.querySelectorAll(".save-chip button")].find((b) =>
      b.textContent?.trim().startsWith("Save"),
    ) as HTMLButtonElement;
    save.click();
    flush();
    expect(saved).toBe(true);
  });
});

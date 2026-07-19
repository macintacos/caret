import "../../test-mount.ts";

import { describe, expect, test } from "bun:test";

import ShortcutsHelp from "@/components/ShortcutsHelp.svelte";
import type { ShortcutEntry } from "$lib/shortcuts/registry.ts";

import { flushUntil, render } from "../../test-mount.ts";

// bits-ui Dialog portals its content to document.body on a deferred tick, so the
// grouped list is asserted against the body after an effect+timer flush (the
// shadcn-foundation verdict). Focus/Escape/`?`-toggle are real-browser behavior,
// covered by test/e2e/shortcuts-help.e2e.ts, not here.
const content = () => document.body.querySelector("[data-slot='dialog-content']");
const mounted = () => content() !== null;
const bodyText = () => document.body.textContent ?? "";

function makeEntries(onRun: () => void): ShortcutEntry[] {
  return [
    { id: "motion.down", keys: [{ key: "j" }], group: "motion", label: "Line down" },
    {
      id: "editor.cancel",
      keys: [{ key: "Escape", cap: "Esc" }],
      group: "editor",
      label: "Cancel editing",
    },
    { id: "actions.approve", keys: [{ key: "a" }], group: "actions", label: "Approve", run: onRun },
  ];
}

describe("ShortcutsHelp render", () => {
  test("mounts a dialog titled Shortcuts", async () => {
    const { flush } = render(ShortcutsHelp, { entries: makeEntries(() => {}), onClose: () => {} });
    await flushUntil(flush, mounted);
    expect(content()?.getAttribute("role")).toBe("dialog");
    expect(document.body.querySelector("[data-slot='dialog-title']")?.textContent).toContain(
      "Shortcuts",
    );
  });

  test("renders a group heading, an entry label, and its key cap", async () => {
    const { flush } = render(ShortcutsHelp, { entries: makeEntries(() => {}), onClose: () => {} });
    await flushUntil(flush, mounted);
    expect(bodyText()).toContain("Motion"); // group label
    expect(bodyText()).toContain("Cancel editing"); // entry label
    expect(bodyText()).toContain("Esc"); // key cap for editor.cancel
  });
});

describe("ShortcutsHelp wiring", () => {
  test("clicking a runnable row runs the shortcut and closes", async () => {
    let ran = false;
    let closed = false;
    const { flush } = render(ShortcutsHelp, {
      entries: makeEntries(() => {
        ran = true;
      }),
      onClose: () => {
        closed = true;
      },
    });
    await flushUntil(flush, mounted);
    const approve = [...document.body.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Approve"),
    );
    approve?.click();
    expect(ran).toBe(true);
    expect(closed).toBe(true);
  });

  test("typing in search narrows the visible rows", async () => {
    const { flush } = render(ShortcutsHelp, { entries: makeEntries(() => {}), onClose: () => {} });
    await flushUntil(flush, mounted);
    const search = document.body.querySelector<HTMLInputElement>("[data-slot='input']");
    expect(search).not.toBeNull();
    search!.value = "approve";
    search!.dispatchEvent(new Event("input", { bubbles: true }));
    await flushUntil(flush, () => !bodyText().includes("Line down"));
    expect(bodyText()).toContain("Approve");
    expect(bodyText()).not.toContain("Line down");
  });
});

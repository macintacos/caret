import "@ui/support/mount.ts";

import { describe, expect, test } from "bun:test";

import { flushUntil, render } from "@ui/support/mount.ts";
import ShortcutsHelp from "@/components/ShortcutsHelp.svelte";
import type { ShortcutEntry } from "$lib/shortcuts/registry.ts";

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

/** Open ShortcutsHelp with inert entries and wait for it to mount — the common
 * opening of the tests below that don't need their own onRun/onClose. */
async function openHelp(): Promise<() => void> {
  const { flush } = render(ShortcutsHelp, {
    open: true,
    entries: makeEntries(() => {}),
    onClose: () => {},
  });
  await flushUntil(flush, mounted);
  return flush;
}

describe("ShortcutsHelp render", () => {
  // The host keeps the component mounted through the exit (EXC-891), so a closed
  // `open` must render nothing rather than a surface the {#if} used to hide.
  test("renders no dialog while closed", async () => {
    const { flush } = render(ShortcutsHelp, {
      open: false,
      entries: makeEntries(() => {}),
      onClose: () => {},
    });
    await flushUntil(flush, mounted, 5);
    expect(mounted()).toBe(false);
  });

  test("mounts a dialog titled Shortcuts", async () => {
    await openHelp();
    expect(content()?.getAttribute("role")).toBe("dialog");
    expect(document.body.querySelector("[data-slot='dialog-title']")?.textContent).toContain(
      "Shortcuts",
    );
  });

  // The `/` hint cap rides an input-group addon slot (EXC-1113), so the group's own
  // layout reserves its track beside the control.
  test("the search field composes input-group with the / cap in a trailing addon", async () => {
    await openHelp();
    const group = document.body.querySelector("[data-slot='input-group']");
    expect(group !== null).toBe(true);
    expect(group?.querySelector("[data-slot='input-group-control']") !== null).toBe(true);
    const addon = group?.querySelector("[data-slot='input-group-addon']");
    expect(addon?.getAttribute("data-align")).toBe("inline-end");
    expect(addon?.textContent?.trim()).toBe("/");
  });

  test("renders a group heading, an entry label, and its key cap", async () => {
    await openHelp();
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
      open: true,
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
    const flush = await openHelp();
    const search = document.body.querySelector<HTMLInputElement>(
      "[data-slot='input-group-control']",
    );
    expect(search).not.toBeNull();
    search!.value = "approve";
    search!.dispatchEvent(new Event("input", { bubbles: true }));
    await flushUntil(flush, () => !bodyText().includes("Line down"));
    expect(bodyText()).toContain("Approve");
    expect(bodyText()).not.toContain("Line down");
  });
});

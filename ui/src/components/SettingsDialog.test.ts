import "@ui/test-mount.ts";

import { afterEach, describe, expect, test } from "bun:test";

import { flushUntil, render } from "@ui/test-mount.ts";
import SettingsDialog from "@/components/SettingsDialog.svelte";
import { writeDiffStyle } from "$lib/diffStylePref.ts";
import {
  SETTINGS_REGISTRY,
  type StagedField,
  settingControlId,
  settingLabelId,
  stagedField,
  THEME_FIELD,
} from "$lib/settingsRegistry.ts";

afterEach(() => localStorage.clear());

function props(over: Record<string, unknown> = {}) {
  return {
    open: true,
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
  // Settings wires its own Dialog.Root rather than composing Modal, so its `open`
  // plumbing (EXC-891) is pinned separately from the shared shell's: the host keeps
  // the component mounted through the exit, so a closed `open` renders nothing.
  test("renders no dialog while closed", async () => {
    const { flush } = render(SettingsDialog, props({ open: false }));
    await flushUntil(flush, mounted, 5);
    expect(mounted()).toBe(false);
  });

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

  test("the Appearance pane renders the theme block, shortcut hints, and the Diff view fields", async () => {
    const { flush } = render(SettingsDialog, props());
    await flushUntil(flush, mounted);
    // The theme controls render as the composite block, not three generic rows.
    expect(has("[data-theme-section]")).toBe(true);
    expect(has("button#setting-themeLight")).toBe(true);
    expect(has("button#setting-themeDark")).toBe(true);
    expect(has("[data-slot='switch']")).toBe(true);
    // The Diff view section's fields now live in the same (Appearance) pane.
    expect(has("button#setting-diffStyle")).toBe(true);
    expect(has("button#setting-diffIndicators")).toBe(true);
  });

  // The pane's own "Appearance" header is the theme block's header, so the block
  // adds none of its own — unlike the Diff view group below it.
  test("the theme block carries no section header of its own", async () => {
    const { flush } = render(SettingsDialog, props());
    await flushUntil(flush, mounted);
    const heads = [...document.body.querySelectorAll(".section-head")].map((h) =>
      h.textContent?.trim(),
    );
    expect(heads).not.toContain("Theme");
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

describe("SettingsDialog label association (EXC-1112)", () => {
  // The point of the field/label adoption: the visible row text IS the label element,
  // so the accessible name and the rendered string are one string rather than two that
  // can drift. Asserted over every rendered row rather than a hand-picked few — the
  // invariant is that no row ships unwired, so a field added to the registry later is
  // covered the day it lands. What the wiring then BUYS (the label click reaching the
  // control, and the name a browser computes from it) is engine behaviour, and lives in
  // test/e2e/settings.e2e.ts.
  test("every row's visible text is a <label> wired to its control", async () => {
    const { flush } = render(SettingsDialog, props());
    await flushUntil(flush, mounted);
    const rows = [...document.body.querySelectorAll("[data-field]")];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const key = row.getAttribute("data-field") ?? "";
      const label = row.querySelector("label[data-slot='field-label']");
      expect(label?.id).toBe(settingLabelId(key));
      const target = label?.getAttribute("for") ?? null;
      if (target === null) {
        // `for` binds only to a labelable element, which neither a segmented control's
        // <div role="group"> nor a slider's <span> root is (UNLABELABLE_CONTROLS in
        // settingsRegistry.ts) — both name their control through aria-labelledby instead.
        // Only the segmented case reaches here: the shell renders one category at a time
        // and this mounts on the default (Appearance), so the Sound pane's slider is
        // covered in test/e2e/settings.e2e.ts, where a browser computes the name for real.
        expect(has(`[data-slot='toggle-group'][aria-labelledby='${settingLabelId(key)}']`)).toBe(
          true,
        );
      } else {
        expect(target).toBe(settingControlId(key));
        expect(has(`#${settingControlId(key)}`)).toBe(true);
      }
    }
  });

  // The parallel aria-label string is gone from every control the visible label
  // now names — that redundancy is what the ticket exists to remove.
  test("no control carries a redundant aria-label", async () => {
    const { flush } = render(SettingsDialog, props());
    await flushUntil(flush, mounted);
    expect(has("[data-slot='switch'][aria-label]")).toBe(false);
    expect(has("#setting-diffStyle[aria-label]")).toBe(false);
    expect(has("[data-slot='toggle-group'][aria-label]")).toBe(false);
  });

  // A labelled section is a real fieldset/legend group, not a bare heading over
  // a div — the grouping semantics `field` exists to supply.
  test("a labelled section groups its rows in a fieldset with a legend", async () => {
    const { flush } = render(SettingsDialog, props());
    await flushUntil(flush, mounted);
    const head = document.body.querySelector(".section-head");
    expect(head?.tagName).toBe("LEGEND");
    expect(head?.closest("fieldset")?.getAttribute("data-slot")).toBe("field-set");
  });

  // …and an UNLABELLED section is not one. A fieldset with no legend is a group with
  // no accessible name, which an accessibility change has no business adding.
  test("no fieldset ships without a legend", async () => {
    const { flush } = render(SettingsDialog, props());
    await flushUntil(flush, mounted);
    const sets = [...document.body.querySelectorAll("[data-slot='field-set']")];
    expect(sets.length).toBeGreaterThan(0);
    for (const set of sets) {
      expect(set.querySelector(":scope > legend") !== null).toBe(true);
    }
  });
});

describe("SettingsDialog Notifications pane (EXC-847)", () => {
  test("renders a Notifications nav row (a search-only category earns a nav row)", async () => {
    const { flush } = render(SettingsDialog, props());
    await flushUntil(flush, mounted);
    expect(has("[data-category='Notifications']")).toBe(true);
  });

  test("selecting Notifications swaps in the live pane", async () => {
    const { flush } = render(SettingsDialog, props());
    await flushUntil(flush, mounted);
    // Appearance is selected first, so the field pane shows, not the live pane.
    expect(has("[data-notifications-pane]")).toBe(false);
    (document.body.querySelector("[data-category='Notifications']") as HTMLButtonElement).click();
    flush();
    expect(has("[data-notifications-pane]")).toBe(true);
  });
});

describe("SettingsDialog Advanced pane (EXC-848)", () => {
  test("renders an Advanced nav row (its search-only entries earn a nav row)", async () => {
    const { flush } = render(SettingsDialog, props());
    await flushUntil(flush, mounted);
    expect(has("[data-category='Advanced']")).toBe(true);
  });

  test("selecting Advanced swaps in the read-only diagnostics pane", async () => {
    const { flush } = render(SettingsDialog, props());
    await flushUntil(flush, mounted);
    // Appearance is selected first, so the diagnostics pane isn't mounted yet.
    expect(has("[data-advanced-pane]")).toBe(false);
    (document.body.querySelector("[data-category='Advanced']") as HTMLButtonElement).click();
    flush();
    expect(has("[data-advanced-pane]")).toBe(true);
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
    const label = document.body.querySelector("button#setting-diffStyle .trigger-label");
    expect(label?.textContent?.trim()).toBe("Unified");
  });
});

// EXC-1206. A daemon-backed field's write is a round trip, so the shell AWAITS
// onChange before re-reading the field — otherwise it would re-seed the control from
// a value the daemon hasn't stored yet. Driven through a probe field with a
// test-owned backing value: the registry's own fields all write synchronously, so
// nothing in it can tell an awaited apply from a non-awaited one.
describe("SettingsDialog async apply (EXC-1206)", () => {
  let stored: string;

  /** A segmented field whose persisted value is `stored`, so the test decides when
   * a write "lands" and whether it lands at all. Segmented rather than a select,
   * whose menu never opens under happy-dom (see this file's header). */
  const probe = () =>
    stagedField<string>({
      key: "probe",
      category: "Appearance",
      label: "Probe",
      description: "A field whose write the test drives.",
      control: {
        kind: "segmented",
        options: [
          { value: "a", label: "Ay" },
          { value: "b", label: "Bee" },
        ],
      },
      read: () => stored,
      // Unused: the dialog calls onChange, and App owns the write.
      write: () => {},
    });

  const pressed = () =>
    document.body
      .querySelector("[data-setting-option][data-state='on']")
      ?.getAttribute("data-setting-option");

  const pickB = () =>
    (document.body.querySelector("[data-setting-option='b']") as HTMLButtonElement).click();

  /** Drain the promise chain a click starts, then repaint. Microtasks only — the
   * control is already mounted, so `apply`'s await and the re-seed are the only things
   * left to settle, and `flushUntil`'s real-timer turns would instead give bits-ui's
   * leaked dismissible-layer timers a chance to fire against a destroyed component
   * (hundreds of svelte `derived_inert` warnings, one per turn). */
  async function settle(flush: () => void): Promise<void> {
    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
      flush();
    }
  }

  test("re-reads the field only after an async onChange settles", async () => {
    stored = "a";
    // Mirrors a daemon-backed write: the new value is not readable until the round
    // trip resolves. Without the await, apply re-seeds from the PRE-write read and
    // the control is stuck on the old segment with nothing left to re-seed it.
    const { flush } = render(
      SettingsDialog,
      props({
        entries: [probe()],
        onChange: async (_f: StagedField, v: unknown) => {
          await Promise.resolve();
          stored = v as string;
        },
      }),
    );
    await flushUntil(flush, mounted);
    expect(pressed()).toBe("a");
    pickB();
    await settle(flush);
    expect(pressed()).toBe("b");
  });

  test("a write that didn't land snaps the control back", async () => {
    stored = "a";
    // App catches a failed write and returns (it raises its own error toast), so
    // onChange resolves with `stored` untouched — and the re-read is what puts the
    // control back on the value that is actually persisted.
    const { flush } = render(
      SettingsDialog,
      props({ entries: [probe()], onChange: () => Promise.resolve() }),
    );
    await flushUntil(flush, mounted);
    pickB();
    // Give it every chance to move: the assertion is that it never does.
    await settle(flush);
    expect(pressed()).toBe("a");
  });

  // The snap-back has to hold for a TOGGLE too — `updates.check`, the first
  // daemon-backed setting (EXC-1207), is one. bits-ui's Switch keeps its own copy of
  // `checked`, so a one-way prop lets a click flip the control while the shell still
  // holds the old value: re-seeding `values` to the SAME value then pushes nothing
  // back and the control lies about what is persisted.
  test("a toggle whose write didn't land snaps back too", async () => {
    const on = true;
    const toggle = stagedField<boolean>({
      key: "probeToggle",
      category: "Appearance",
      label: "Probe toggle",
      description: "A toggle whose write the test drives.",
      control: { kind: "toggle" },
      read: () => on,
      write: () => {},
    });
    const state = () =>
      document.body.querySelector("#setting-probeToggle")?.getAttribute("data-state");

    const { flush } = render(
      SettingsDialog,
      props({ entries: [toggle], onChange: () => Promise.resolve() }),
    );
    await flushUntil(flush, mounted);
    expect(state()).toBe("checked");
    (document.body.querySelector("#setting-probeToggle") as HTMLButtonElement).click();
    await settle(flush);
    expect(state()).toBe("checked");
  });

  test("a toggle whose write landed shows the new value", async () => {
    let on = true;
    const toggle = stagedField<boolean>({
      key: "probeToggle",
      category: "Appearance",
      label: "Probe toggle",
      description: "A toggle whose write the test drives.",
      control: { kind: "toggle" },
      read: () => on,
      write: () => {},
    });
    const state = () =>
      document.body.querySelector("#setting-probeToggle")?.getAttribute("data-state");

    const { flush } = render(
      SettingsDialog,
      props({
        entries: [toggle],
        onChange: async (_f: StagedField, v: unknown) => {
          await Promise.resolve();
          on = v as boolean;
        },
      }),
    );
    await flushUntil(flush, mounted);
    (document.body.querySelector("#setting-probeToggle") as HTMLButtonElement).click();
    await settle(flush);
    expect(state()).toBe("unchecked");
  });
});

describe("SettingsDialog search (EXC-845)", () => {
  // Drive the search field by setting its value + firing an input event (the
  // bind:value path) — DOM reactivity, not the real `/` focus / Esc keyboard, which
  // stays in test/e2e/settings.e2e.ts.
  function typeQuery(flush: () => void, q: string): void {
    const input = document.body.querySelector<HTMLInputElement>(
      "[data-slot='input-group-control'][aria-label='Search settings']",
    );
    if (!input) throw new Error("settings search input not found");
    input.value = q;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    flush();
  }

  // The `/` hint cap rides an input-group addon slot (EXC-1113), so the group's own
  // layout reserves its track beside the control.
  test("the search field composes input-group with the / cap in a trailing addon", async () => {
    const { flush } = render(SettingsDialog, props());
    await flushUntil(flush, mounted);
    const group = document.body.querySelector("[data-slot='input-group']");
    expect(group !== null).toBe(true);
    expect(
      group?.querySelector("[data-slot='input-group-control'][aria-label='Search settings']") !==
        null,
    ).toBe(true);
    const addon = group?.querySelector("[data-slot='input-group-addon']");
    expect(addon?.getAttribute("data-align")).toBe("inline-end");
    expect(addon?.textContent?.trim()).toBe("/");
  });

  test("filters nav rows and fields to the matches only", async () => {
    const { flush } = render(SettingsDialog, props());
    await flushUntil(flush, mounted);
    typeQuery(flush, "theme");
    // Only the theme block remains; the other Appearance fields drop.
    expect(has(`[data-field='${THEME_FIELD.light}']`)).toBe(true);
    expect(has("[data-field='shortcutHints']")).toBe(false);
    expect(has("[data-field='diffStyle']")).toBe(false);
    // Appearance is the only category with a match; the search-only categories drop.
    expect(has("[data-category='Appearance']")).toBe(true);
    expect(has("[data-category='Notifications']")).toBe(false);
    expect(has("[data-category='Advanced']")).toBe(false);
  });

  test("clearing the query restores the full nav and fields", async () => {
    const { flush } = render(SettingsDialog, props());
    await flushUntil(flush, mounted);
    typeQuery(flush, "theme");
    expect(has("[data-category='Advanced']")).toBe(false);
    typeQuery(flush, "");
    expect(has("[data-field='shortcutHints']")).toBe(true);
    expect(has("[data-category='Notifications']")).toBe(true);
    expect(has("[data-category='Advanced']")).toBe(true);
  });

  test("a description-only match keeps a search-only category's nav row", async () => {
    const { flush } = render(SettingsDialog, props());
    await flushUntil(flush, mounted);
    // "daemon" matches only the Advanced 'Daemon status' search-only entry.
    typeQuery(flush, "daemon");
    expect(has("[data-category='Advanced']")).toBe(true);
    expect(has("[data-category='Appearance']")).toBe(false);
  });

  test("a query that matches nothing renders the empty state", async () => {
    const { flush } = render(SettingsDialog, props());
    await flushUntil(flush, mounted);
    typeQuery(flush, "zzz-no-such-setting");
    expect(has(".pane-empty")).toBe(true);
    expect(has("[data-category='Appearance']")).toBe(false);
    expect(has(`[data-field='${THEME_FIELD.light}']`)).toBe(false);
  });
});

import "@ui/support/setup.ts";
import { describe, expect, test } from "bun:test";

import { shortcuts } from "$lib/shortcuts/index.ts";
import {
  ariaKeyshortcutsFor,
  bind,
  CANONICAL_KEYMAP,
  EDITOR_SHORTCUTS,
} from "$lib/shortcuts/keymap.ts";
import {
  createShortcutRegistry,
  keyCaps,
  type ShortcutScope,
  specSignature,
} from "$lib/shortcuts/registry.ts";
import { isEntryActive } from "$lib/shortcuts/scope.ts";

describe("CANONICAL_KEYMAP", () => {
  test("every entry id is unique", () => {
    const ids = CANONICAL_KEYMAP.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("no two dispatchable shortcuts collide within a scope (globals count in every scope)", () => {
    // Editor chords are display-only (CodeMirror owns them on focus) and deliberately
    // reuse Esc with commenting.clear, so they're excluded. Everything else is checked PER
    // SCOPE: two entries collide only when some scope has both active — same scope, or one
    // is global — which is exactly when the dispatcher could fire both. `/` is reserved in
    // review (actions.search) AND settings (settings.search), but never both in one scope,
    // so that cross-scope reuse is safe rather than a collision. The scope set is derived
    // from the table — the base review surface (null) plus every distinct modal scope any
    // entry declares — so a new modal scope is covered without editing this test.
    const dispatchable = CANONICAL_KEYMAP.filter((e) => e.group !== "editor");
    const modalScopes = [
      ...new Set(
        dispatchable
          .map((e) => e.scope)
          .filter((s): s is ShortcutScope => s != null && s !== "global"),
      ),
    ];
    for (const scope of [null, ...modalScopes]) {
      const sigs = dispatchable
        .filter((e) => isEntryActive(e, scope))
        .map((e) => specSignature(e.keys));
      expect(new Set(sigs).size).toBe(sigs.length);
    }
  });

  test("reserves the settings shortcuts in the table, scoped to settings (EXC-876)", () => {
    // The Settings modal's own affordances are reserved in the single source so the
    // collision check sees them. Display-only (no run): the modal owns / and Esc through
    // its own handlers; these entries exist for the scoped `?` help and the collision check.
    const search = CANONICAL_KEYMAP.find((e) => e.id === "settings.search");
    const close = CANONICAL_KEYMAP.find((e) => e.id === "settings.close");
    if (!search || !close) throw new Error("settings shortcuts missing from CANONICAL_KEYMAP");
    expect(search.scope).toBe("settings");
    expect(close.scope).toBe("settings");
    expect(specSignature(search.keys)).toBe("/");
    expect(specSignature(close.keys)).toBe("Escape");
    expect(search.run).toBeUndefined();
    expect(close.run).toBeUndefined();
  });

  test("reserves the parent keymap's bindings", () => {
    const sigs = new Set(CANONICAL_KEYMAP.map((e) => specSignature(e.keys)));
    for (const sig of ["j", "k", "g g", "] ]", "a", "r", "?", "ctrl+d", ","]) {
      expect(sigs.has(sig)).toBe(true);
    }
  });

  test("reserves Shift+C for the comment navigator, rendered as shift + C caps", () => {
    // EXC-792: summons the comment navigator. Keyed "C" (a bare shifted key, no command
    // modifier and no explicit cap: keyCaps derives the shift + capital from the uppercase
    // key's case, the same path V/G take, EXC-831). "shift" is the token caps.ts resolves to
    // the global shift icon at render.
    const entry = CANONICAL_KEYMAP.find((e) => e.id === "actions.toggleComments");
    if (!entry) throw new Error("actions.toggleComments missing");
    expect(entry.group).toBe("actions");
    expect(entry.label).toBe("Toggle comments");
    expect(specSignature(entry.keys)).toBe("C");
    expect(keyCaps(entry.keys)).toEqual([["shift", "C"]]);
  });

  test("reserves Shift+R for Reject, rendered as shift + R caps (EXC-913)", () => {
    // EXC-913: shift+r fires the top bar's Reject. A bare shifted key (uppercase key,
    // no command modifier and no cap override), so keyCaps derives ["shift", "R"] from
    // the case and ariaKeyshortcuts derives "Shift+R" from the same field — the
    // ADVERTISED hint (aria-keyshortcuts) cannot drift from the key the dispatcher
    // fires on. The visible cap is still typed by hand at each call site, as the
    // topbar's a/r caps are, so it does not ride this guarantee.
    const entry = CANONICAL_KEYMAP.find((e) => e.id === "actions.reject");
    if (!entry) throw new Error("actions.reject missing");
    expect(entry.group).toBe("actions");
    expect(entry.label).toBe("Reject");
    expect(specSignature(entry.keys)).toBe("R");
    expect(keyCaps(entry.keys)).toEqual([["shift", "R"]]);
    expect(ariaKeyshortcutsFor("actions.reject")).toBe("Shift+R");
  });

  test("reserves \\ for the contents popup, rendered as a \\ cap (EXC-1097)", () => {
    // A bare backslash, no command modifier — the cap derives straight from the
    // key, no explicit override — and the advertised hint derives from the same
    // field, so the trigger's aria-keyshortcuts cannot drift from what the
    // dispatcher fires on.
    const entry = CANONICAL_KEYMAP.find((e) => e.id === "actions.contents");
    if (!entry) throw new Error("actions.contents missing");
    expect(entry.group).toBe("actions");
    expect(entry.label).toBe("Open contents");
    expect(specSignature(entry.keys)).toBe("\\");
    expect(keyCaps(entry.keys)).toEqual([["\\"]]);
    expect(ariaKeyshortcutsFor("actions.contents")).toBe("\\");
    // The breadcrumbs alias this key used to be is gone rather than renamed, so
    // the help modal cannot carry a row still claiming `\` opens the bar.
    expect(CANONICAL_KEYMAP.some((e) => e.id === "actions.toggleSidebar")).toBe(false);
  });

  test("reserves b for the heading breadcrumbs in the Actions group, rendered as a B cap", () => {
    // EXC-947: `b` invokes the heading breadcrumbs bar. The cap and the advertised
    // hint are derived from the same `key`, so the bar's aria-keyshortcuts cannot
    // drift from what the dispatcher fires on.
    const entry = CANONICAL_KEYMAP.find((e) => e.id === "actions.headingNav");
    if (!entry) throw new Error("actions.headingNav missing");
    expect(entry.group).toBe("actions");
    expect(entry.label).toBe("Open breadcrumbs");
    expect(specSignature(entry.keys)).toBe("b");
    expect(keyCaps(entry.keys)).toEqual([["B"]]);
    expect(ariaKeyshortcutsFor("actions.headingNav")).toBe("b");
  });

  test("derives shift + letter caps for the bare shifted vim keys (no cap override)", () => {
    // EXC-831: V and G are bare shifted keys (uppercase key, no command modifier and
    // no explicit cap); keyCaps derives the shift affordance from the key's case, so
    // they render as the shift icon + the capital — the same shape toggleComments
    // spells out by hand.
    const visual = CANONICAL_KEYMAP.find((e) => e.id === "commenting.visualLine");
    const bottom = CANONICAL_KEYMAP.find((e) => e.id === "motion.bottom");
    if (!visual || !bottom) throw new Error("V/G keymap entries missing");
    expect(keyCaps(visual.keys)).toEqual([["shift", "V"]]);
    expect(keyCaps(bottom.keys)).toEqual([["shift", "G"]]);
  });

  test("owns / for plan search (EXC-832), repointed from the contents filter", () => {
    // EXC-832 repurposes / from "focus contents filter" (EXC-789) to a vim-style
    // full-text search of the plan; the focus-filter binding is gone. The
    // breadcrumbs bar's `/` (EXC-948) lives inside an open crumb menu and is handled
    // there, so it never reaches this table.
    const search = CANONICAL_KEYMAP.find((e) => e.id === "actions.search");
    if (!search) throw new Error("actions.search missing");
    expect(search.group).toBe("actions");
    expect(search.label).toBe("Search plan");
    expect(specSignature(search.keys)).toBe("/");
    expect(CANONICAL_KEYMAP.some((e) => e.id === "actions.focusFilter")).toBe(false);
  });

  test("reserves n / N to cycle search matches (EXC-832)", () => {
    // n / N step to the next / previous match once a search is committed. n derives
    // its bare capital cap from its case; N is a bare shifted key (shift + capital),
    // the same shape as V/G.
    const next = CANONICAL_KEYMAP.find((e) => e.id === "actions.searchNext");
    const prev = CANONICAL_KEYMAP.find((e) => e.id === "actions.searchPrev");
    if (!next || !prev) throw new Error("search n/N keymap entries missing");
    expect(next.group).toBe("actions");
    expect(prev.group).toBe("actions");
    expect(next.label).toBe("Next match");
    expect(prev.label).toBe("Previous match");
    expect(specSignature(next.keys)).toBe("n");
    expect(specSignature(prev.keys)).toBe("N");
    expect(keyCaps(next.keys)).toEqual([["N"]]);
    expect(keyCaps(prev.keys)).toEqual([["shift", "N"]]);
  });
});

describe("EDITOR_SHORTCUTS", () => {
  test("the existing editor chords are display-only (no run) so the dispatcher never fires them", () => {
    expect(EDITOR_SHORTCUTS.length).toBeGreaterThan(0);
    for (const e of EDITOR_SHORTCUTS) {
      expect(e.run).toBeUndefined();
      expect(e.group).toBe("editor");
    }
  });

  test("registering them surfaces them in list() for the help modal", () => {
    const reg = createShortcutRegistry();
    for (const e of EDITOR_SHORTCUTS) reg.register(e);
    expect(
      reg
        .list()
        .map((e) => e.id)
        .sort(),
    ).toEqual([...EDITOR_SHORTCUTS.map((e) => e.id)].sort());
  });

  test("the completion-preview chord reserves Ctrl+Space and renders it as a cap", () => {
    // The list's hint strip is CSS generated content, so this reservation is the
    // only place the chord is written down as data — for the `?` modal, and for
    // the collision guard a later ticket claiming a key reads.
    const preview = EDITOR_SHORTCUTS.find((e) => e.id === "editor.previewCompletion");
    if (!preview) throw new Error("the completion-preview chord is missing");
    expect(keyCaps(preview.keys)).toEqual([["Ctrl", "Space"]]);
  });

  test("the submit chord renders as ⌘↵ caps and cancel as Esc", () => {
    const submit = EDITOR_SHORTCUTS.find((e) => e.id === "editor.submit");
    const cancel = EDITOR_SHORTCUTS.find((e) => e.id === "editor.cancel");
    if (!submit || !cancel) throw new Error("editor chords missing");
    expect(keyCaps(submit.keys)).toEqual([["⌘", "↵"]]);
    expect(keyCaps(cancel.keys)).toEqual([["Esc"]]);
  });
});

describe("bind", () => {
  test("spreads a reservation with the caller's run", () => {
    const run = () => {};
    const entry = bind("actions.approve", { run });
    expect(entry.id).toBe("actions.approve");
    expect(entry.keys).toEqual([{ key: "a" }]);
    expect(entry.group).toBe("actions");
    expect(entry.label).toBe("Approve");
    expect(entry.run).toBe(run);
  });

  test("carries an enabled guard when given", () => {
    const enabled = () => false;
    expect(bind("actions.approve", { run: () => {}, enabled }).enabled).toBe(enabled);
  });

  test("preserves the reservation's own scope when none is passed (help.show is global)", () => {
    expect(bind("help.show", { run: () => {} }).scope).toBe("global");
  });

  test("an explicit scope overrides the reservation's", () => {
    expect(bind("actions.approve", { run: () => {}, scope: "settings" }).scope).toBe("settings");
  });

  test("throws on an id absent from the table", () => {
    expect(() => bind("nope.missing", { run: () => {} })).toThrow();
  });
});

describe("ariaKeyshortcutsFor", () => {
  test("derives the aria-keyshortcuts string for a reserved id", () => {
    expect(ariaKeyshortcutsFor("actions.approve")).toBe("a");
    expect(ariaKeyshortcutsFor("actions.toggleComments")).toBe("Shift+C");
    expect(ariaKeyshortcutsFor("editor.submit")).toBe("Meta+Enter Control+Enter");
  });

  test("throws on an id absent from the table", () => {
    expect(() => ariaKeyshortcutsFor("nope.missing")).toThrow();
  });
});

describe("shortcuts singleton", () => {
  test("is a working registry instance", () => {
    const before = shortcuts.list().length;
    const off = shortcuts.register({
      id: "test.tmp",
      keys: [{ key: "z" }],
      group: "actions",
      label: "tmp",
      run: () => {},
    });
    expect(shortcuts.list().some((e) => e.id === "test.tmp")).toBe(true);
    off();
    expect(shortcuts.list().length).toBe(before);
  });
});

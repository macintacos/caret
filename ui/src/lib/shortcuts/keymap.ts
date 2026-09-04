// The canonical keymap (EXC-785): the shortcut table encoded as reserved-binding data,
// so every ticket that adds a binding claims a non-colliding key from one place. The
// entries carry no `run` — a live binding is built from a reservation through `bind`.

import {
  ariaKeyshortcuts,
  keyCaps,
  type ShortcutEntry,
  type ShortcutScope,
} from "$lib/shortcuts/registry.ts";

/** The editor's own chords, surfaced read-only in the help modal (EXC-786).
 * No `run`: the composer owns them on the focused editor — ⌘/Ctrl+Enter and Esc
 * in markdownEditor.ts, Ctrl+Space in editorCompletion.ts — so the global
 * dispatcher must not fire them. Declared here anyway, because this table is
 * what the help modal lists and what the collision guard reads. */
export const EDITOR_SHORTCUTS: ShortcutEntry[] = [
  {
    id: "editor.submit",
    keys: [{ key: "Enter", mods: ["mod"], cap: ["⌘", "↵"] }],
    group: "editor",
    label: "Submit comment",
  },
  {
    id: "editor.cancel",
    keys: [{ key: "Escape", cap: "Esc" }],
    group: "editor",
    label: "Cancel editing",
  },
  {
    // EXC-1186: toggles the preview panel beside an open `@`/`/` completion list.
    // Live only while that list is painted, which is why it is a CodeMirror
    // binding rather than a `run` here — but reserving it is what keeps the key
    // claimed against a later ticket and listed in the `?` modal, where a chord
    // that only announces itself in the list's own hint strip would not appear.
    id: "editor.previewCompletion",
    keys: [{ key: " ", mods: ["ctrl"] }],
    group: "editor",
    label: "Preview highlighted completion",
  },
];

/** The Settings modal's own keyboard affordances (EXC-849), reserved in the single source
 * (EXC-876). Display-only (no `run`): SettingsDialog owns `/` (focus search) and Esc
 * (close) through its own handlers — these entries exist so the scoped `?` help lists
 * exactly the shortcuts valid in Settings, and so the collision test sees the settings
 * scope. `scope: "settings"` also tells the dispatcher to suppress the review shortcuts
 * while the modal is open (see shortcuts/scope.ts). */
export const SETTINGS_SHORTCUTS: ShortcutEntry[] = [
  {
    id: "settings.search",
    keys: [{ key: "/" }],
    group: "settings",
    label: "Search settings",
    scope: "settings",
  },
  {
    id: "settings.close",
    keys: [{ key: "Escape", cap: "Esc" }],
    group: "settings",
    label: "Close settings",
    scope: "settings",
  },
];

/** Every reserved binding, in help-modal order. */
export const CANONICAL_KEYMAP: ShortcutEntry[] = [
  // Motion (cursor)
  { id: "motion.down", keys: [{ key: "j" }], group: "motion", label: "Line down" },
  { id: "motion.up", keys: [{ key: "k" }], group: "motion", label: "Line up" },
  {
    id: "motion.halfPageDown",
    keys: [{ key: "d", mods: ["ctrl"] }],
    group: "motion",
    label: "Half-page down",
  },
  {
    id: "motion.halfPageUp",
    keys: [{ key: "u", mods: ["ctrl"] }],
    group: "motion",
    label: "Half-page up",
  },
  { id: "motion.top", keys: [{ key: "g" }, { key: "g" }], group: "motion", label: "Go to top" },
  { id: "motion.bottom", keys: [{ key: "G" }], group: "motion", label: "Go to bottom" },
  {
    id: "motion.nextHeading",
    keys: [{ key: "]" }, { key: "]" }],
    group: "motion",
    label: "Next heading",
  },
  {
    id: "motion.prevHeading",
    keys: [{ key: "[" }, { key: "[" }],
    group: "motion",
    label: "Previous heading",
  },
  { id: "motion.nextBlank", keys: [{ key: "}" }], group: "motion", label: "Next blank line" },
  { id: "motion.prevBlank", keys: [{ key: "{" }], group: "motion", label: "Previous blank line" },
  // Commenting
  { id: "commenting.comment", keys: [{ key: "c" }], group: "commenting", label: "Comment line" },
  {
    id: "commenting.visualLine",
    keys: [{ key: "V" }],
    group: "commenting",
    label: "Visual line select",
  },
  {
    id: "commenting.clear",
    keys: [{ key: "Escape", cap: "Esc" }],
    group: "commenting",
    label: "Clear selection",
  },
  // Actions & chrome
  { id: "actions.approve", keys: [{ key: "a" }], group: "actions", label: "Approve" },
  {
    id: "actions.requestChanges",
    keys: [{ key: "r" }],
    group: "actions",
    label: "Request changes",
  },
  {
    // EXC-913: shifted rather than a second bare letter — reject is the one verdict with
    // no undo, and any free bare letter would sit a key or two from `r` (request changes),
    // so a slip lands it. Shift on the SAME key makes it deliberate.
    id: "actions.reject",
    keys: [{ key: "R" }],
    group: "actions",
    label: "Reject",
  },
  {
    id: "actions.toggleDiff",
    keys: [{ key: "d" }],
    group: "actions",
    label: "Toggle compare/diff",
  },
  {
    // EXC-832: / opens a vim-style full-text search of the plan, repurposed from
    // EXC-789's focus-contents-filter — this ticket owns / at the plan surface. The
    // breadcrumbs bar's own `/` (EXC-948) is scoped to an open crumb menu and is
    // handled there, so it needs no reservation here.
    id: "actions.search",
    keys: [{ key: "/" }],
    group: "actions",
    label: "Search plan",
  },
  // EXC-832: cycle to the next / previous search match (wrapping), registered live only
  // while a committed search HUD is up.
  { id: "actions.searchNext", keys: [{ key: "n" }], group: "actions", label: "Next match" },
  { id: "actions.searchPrev", keys: [{ key: "N" }], group: "actions", label: "Previous match" },
  { id: "actions.settings", keys: [{ key: "," }], group: "actions", label: "Open settings" },
  {
    id: "actions.toggleComments",
    keys: [{ key: "C" }],
    group: "actions",
    label: "Toggle comments",
  },
  // EXC-947: opens the heading breadcrumbs bar's trailing crumb — the level being read —
  // so the trail is reachable without the mouse.
  { id: "actions.headingNav", keys: [{ key: "b" }], group: "actions", label: "Open breadcrumbs" },
  // EXC-1097: opens the plan's table-of-contents popup. `\` has already been rebound twice
  // (EXC-830's docked rail, then EXC-949's breadcrumbs alias), so a third move costs
  // reviewers a third relearn.
  // Unlike `b`, this key only OPENS: the popup puts focus in a text field, so the
  // dispatcher's editing-context guard suppresses bare keys while it is up and a second
  // `\` types a backslash into the filter. Both labels read "Open …" for that reason.
  { id: "actions.contents", keys: [{ key: "\\" }], group: "actions", label: "Open contents" },
  // Settings
  ...SETTINGS_SHORTCUTS,
  // Help
  {
    id: "help.show",
    keys: [{ key: "?" }],
    group: "help",
    label: "Show shortcuts",
    // Global scope (EXC-849): ? toggles the help from any view — including over the
    // Settings modal, where every other review shortcut is suppressed. App binds this
    // reservation (EXC-876), so the key AND its global scope flow from the table.
    scope: "global",
  },
  // Editor
  ...EDITOR_SHORTCUTS,
];

// The one id → reservation lookup every accessor below resolves through (EXC-876).
const RESERVED = new Map(CANONICAL_KEYMAP.map((e) => [e.id, e] as const));

/** The reservation for `id`, or a hard error — a typo'd id is a bug, not a silent no-op:
 * the single source cannot serve a key it never reserved. */
function reservedEntry(id: string): ShortcutEntry {
  const base = RESERVED.get(id);
  if (!base) throw new Error(`no reserved shortcut "${id}" in CANONICAL_KEYMAP`);
  return base;
}

/** A live, dispatchable entry from a reservation: the canonical key/label/group/cap
 * spread with the caller's `run` (+ optional `enabled`/`scope`). The single seam every
 * live binding registers through (EXC-876). An explicit `scope` overrides; otherwise the
 * reservation's own scope (help.show's `"global"`) is preserved by the spread. */
export function bind(
  id: string,
  { run, enabled, scope }: { run: () => void; enabled?: () => boolean; scope?: ShortcutScope },
): ShortcutEntry {
  return { ...reservedEntry(id), run, enabled, ...(scope !== undefined && { scope }) };
}

/** The `aria-keyshortcuts` string a button advertises for the shortcut `id`, derived from
 * that id's reservation so the a11y hint can't drift from the key the dispatcher fires on.
 * Every advertising button resolves its hint through here (EXC-876). */
export function ariaKeyshortcutsFor(id: string): string {
  return ariaKeyshortcuts(reservedEntry(id).keys);
}

/** The caps a hint draws for the shortcut `id` — one array per chord, one glyph per key —
 * resolved through the same reservation `ariaKeyshortcutsFor` reads, so what a hint SHOWS
 * and what the dispatcher fires on cannot drift apart. */
export function keyCapsFor(id: string): string[][] {
  return keyCaps(reservedEntry(id).keys);
}

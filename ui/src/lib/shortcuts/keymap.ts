// The canonical keymap: EXC-785's shortcut table encoded as reserved-binding
// data so downstream tickets (EXC-787/788/789/790) claim non-colliding keys.
// These entries are a reference/reservation — they carry no `run`; a downstream
// ticket implementing a binding registers its own live entry with the action.
// EDITOR_SHORTCUTS are the exception registered now: the two existing composer
// chords, display-only so they appear in the help modal while the composer
// (markdownEditor.ts) keeps owning the behavior.

import {
  ariaKeyshortcuts,
  type ShortcutEntry,
  type ShortcutScope,
} from "$lib/shortcuts/registry.ts";

/** The existing editor chords, surfaced read-only in the help modal (EXC-786).
 * No `run`: markdownEditor.ts owns ⌘/Ctrl+Enter and Esc on the focused editor,
 * so the global dispatcher must not fire them. */
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

/** EXC-785's full proposed keymap. Reserved bindings for the vim-shortcut tree —
 * the single source downstream tickets read to claim non-colliding keys. Only
 * EDITOR_SHORTCUTS are registered live here; each other binding gains its `run`
 * when its owning ticket lands. */
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
    // EXC-913: shift+r rejects the plan. A bare shifted key — uppercase `key`, no
    // command modifier and no cap override — the same shape as V/G/C/N, so keyCaps
    // derives ["shift", "R"] from the case and ariaKeyshortcuts derives "Shift+R".
    // Shifted rather than a second bare letter: reject is the one verdict with no
    // undo, and any free bare letter would sit a key or two from `r` (request
    // changes), so a slip lands it. Shift on the SAME key makes it deliberate.
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
    // EXC-789's focus-contents-filter — this ticket owns /. The ToC filter keeps no
    // keybinding for now (parks EXC-793).
    id: "actions.search",
    keys: [{ key: "/" }],
    group: "actions",
    label: "Search plan",
  },
  // EXC-832: cycle to the next / previous search match (wrapping), registered live
  // only while a committed search HUD is up. n derives its bare capital cap from its
  // case; N is a bare shifted key (shift + capital), the same shape as V/G.
  { id: "actions.searchNext", keys: [{ key: "n" }], group: "actions", label: "Next match" },
  { id: "actions.searchPrev", keys: [{ key: "N" }], group: "actions", label: "Previous match" },
  { id: "actions.settings", keys: [{ key: "," }], group: "actions", label: "Open settings" },
  {
    // EXC-792: summons the comment navigator. Keyed "C" (a bare shifted key —
    // the case-sensitive matcher fires on it without a modifier flag, like V/G).
    // No cap override: a bare uppercase key derives its shift + capital from its case
    // (as V/G do, EXC-831), so C renders ["shift", "C"] straight from the key — one
    // rendering path for every shifted letter. "shift" draws the global shift icon (caps.ts).
    id: "actions.toggleComments",
    keys: [{ key: "C" }],
    group: "actions",
    label: "Toggle comments",
  },
  // EXC-830: toggles the plan's ToC rail (the sidebar). A bare backslash with no
  // command modifier; the cap derives straight from the key (no override needed).
  { id: "actions.toggleSidebar", keys: [{ key: "\\" }], group: "actions", label: "Toggle sidebar" },
  // EXC-947: opens the heading breadcrumbs bar's trailing crumb — the level being
  // read — so the trail is reachable without the mouse. A bare lowercase letter, no
  // command modifier and no cap override: keyCaps derives the capital from the key's
  // case, the same shape `d` and `n` take. `\` stays with actions.toggleSidebar; this
  // entry claims `b` only.
  { id: "actions.headingNav", keys: [{ key: "b" }], group: "actions", label: "Open breadcrumbs" },
  // Settings — the Settings modal's scoped affordances, display-only (EXC-849/876).
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
  // Editor (existing) — the read-only chords, registered live for the help modal.
  ...EDITOR_SHORTCUTS,
];

// One lookup of the reservations by id, built once. `bind` and `ariaKeyshortcutsFor` both
// resolve a shortcut id to its reservation through it, so id → entry lookup lives in one
// place (EXC-876).
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

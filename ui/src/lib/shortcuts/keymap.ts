// The canonical keymap: EXC-785's shortcut table encoded as reserved-binding
// data so downstream tickets (EXC-787/788/789/790) claim non-colliding keys.
// These entries are a reference/reservation — they carry no `run`; a downstream
// ticket implementing a binding registers its own live entry with the action.
// EDITOR_SHORTCUTS are the exception registered now: the two existing composer
// chords, display-only so they appear in the help modal while the composer
// (markdownEditor.ts) keeps owning the behavior.

import type { ShortcutEntry } from "$lib/shortcuts/registry.ts";

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
    id: "actions.toggleDiff",
    keys: [{ key: "d" }],
    group: "actions",
    label: "Toggle compare/diff",
  },
  {
    id: "actions.focusFilter",
    keys: [{ key: "/" }],
    group: "actions",
    label: "Focus contents filter",
  },
  { id: "actions.settings", keys: [{ key: "," }], group: "actions", label: "Open settings" },
  {
    // EXC-792: summons the comment navigator. Keyed "C" (a bare shifted key —
    // the case-sensitive matcher fires on it without a modifier flag, like V/G).
    // Its cap is set to ⇧ C explicitly, not the bare "C" V/G derive, so it can't
    // be misread as the lowercase-c comment-line shortcut it sits beside.
    id: "actions.toggleComments",
    keys: [{ key: "C", cap: ["⇧", "C"] }],
    group: "actions",
    label: "Toggle comments",
  },
  // Help
  { id: "help.show", keys: [{ key: "?" }], group: "help", label: "Show shortcuts" },
  // Editor (existing) — the read-only chords, registered live for the help modal.
  ...EDITOR_SHORTCUTS,
];

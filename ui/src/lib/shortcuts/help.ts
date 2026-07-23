// Pure grouping + filtering for the shortcuts help modal (EXC-787). Node-free and
// framework-agnostic — the modal (ShortcutsHelp.svelte) drives these, so the list
// logic is unit-testable without mounting (see help.test.ts, svelte-rules.md's
// "extract component logic to a testable lib module").

import { keyCaps, type ShortcutEntry, type ShortcutGroup } from "$lib/shortcuts/registry.ts";

/** One group's worth of entries, ready to render as a labelled section. */
export interface ShortcutGroupView {
  group: ShortcutGroup;
  label: string;
  entries: ShortcutEntry[];
}

// EXC-785's canonical group order + human-readable labels. Iterating this fixed
// list (rather than the entries) is what fixes the section order and drops any
// group with no live entries — including groups downstream tickets haven't
// registered into yet.
const GROUP_ORDER: readonly { group: ShortcutGroup; label: string }[] = [
  { group: "motion", label: "Motion" },
  { group: "commenting", label: "Commenting" },
  { group: "actions", label: "Actions" },
  { group: "settings", label: "Settings" },
  { group: "help", label: "Help" },
  { group: "editor", label: "Editor" },
];

/** Group entries into labelled sections in the canonical order, dropping empty
 * groups. Entry order within a group is the input order (registration order). */
export function groupShortcuts(entries: ShortcutEntry[]): ShortcutGroupView[] {
  return GROUP_ORDER.map(({ group, label }) => ({
    group,
    label,
    entries: entries.filter((e) => e.group === group),
  })).filter((g) => g.entries.length > 0);
}

// An entry's searchable text: its label plus every rendered key cap, so a query
// matches whether the reviewer types the action name ("approve") or the keys
// ("Esc", "?", "g").
function searchText(entry: ShortcutEntry): string {
  return `${entry.label} ${keyCaps(entry.keys).flat().join(" ")}`.toLowerCase();
}

/** Filter entries by a case-insensitive substring over label + key caps. An empty
 * (or whitespace-only) query returns every entry. */
export function filterShortcuts(entries: ShortcutEntry[], query: string): ShortcutEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter((e) => searchText(e).includes(q));
}

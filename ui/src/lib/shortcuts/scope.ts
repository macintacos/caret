// Shortcut scoping (EXC-849): the pure predicate that answers "is this shortcut
// active in the current view?". The dispatcher reads it to decide what may fire and
// the help modal reads it to decide what to list, so an open modal both suppresses
// the review shortcuts and narrows the ? help to the shortcuts valid in that view.
// Node-free and framework-agnostic — unit-tested without mounting (scope.test.ts,
// per svelte-rules.md's "extract component logic to a testable lib module").

import type { ShortcutEntry, ShortcutScope } from "$lib/shortcuts/registry.ts";

/** The surface an entry with no explicit scope belongs to — the plan-review view. */
const BASE_SCOPE: ShortcutScope = "review";

/** Whether `entry` is active under `activeScope` — the modal scope currently owning
 * the view, or null for the base review surface. A global entry is always active; a
 * scoped (or scopeless = base) entry only when its scope matches the active one. */
export function isEntryActive(entry: ShortcutEntry, activeScope: ShortcutScope | null): boolean {
  if (entry.scope === "global") return true;
  return (entry.scope ?? BASE_SCOPE) === (activeScope ?? BASE_SCOPE);
}

/** The subset of `entries` active under `activeScope`, input order preserved — what
 * the dispatcher may fire and the help modal lists for the current view. */
export function scopedShortcuts(
  entries: ShortcutEntry[],
  activeScope: ShortcutScope | null,
): ShortcutEntry[] {
  return entries.filter((e) => isEntryActive(e, activeScope));
}

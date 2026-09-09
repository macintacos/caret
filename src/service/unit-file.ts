// The file half of the idempotency predicate both ServiceManagers apply before they
// rewrite a unit and re-register it with their supervisor.

import { readFileSync } from "node:fs";

/** Whether the unit already at `path` is byte-identical to `text`. Absent and
 * unreadable both count as changed: either way the install must write. */
export function unitUnchanged(path: string, text: string): boolean {
  try {
    return readFileSync(path, "utf-8") === text;
  } catch {
    return false;
  }
}

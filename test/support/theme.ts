// Valid theme file text for suites that need a theme on disk.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CARET_DARK = join(import.meta.dir, "..", "..", "ui/src/lib/themes/caret-dark.json");

/** The text of a valid theme file with `id`: caret-dark's file, renamed. */
export function themeFileText(id: string): string {
  const file = JSON.parse(readFileSync(CARET_DARK, "utf8"));
  return JSON.stringify({ ...file, id, label: id });
}

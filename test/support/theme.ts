// Valid theme file text for suites that need a theme on disk.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const THEMES_DIR = join(import.meta.dirname, "..", "..", "ui/src/lib/themes");

/** The text of a valid theme file with `id`: caret's file for `scheme` (dark by default),
 * renamed, with `accent` and `keyword` swapped in when given. */
export function themeFileText(
  id: string,
  over: { scheme?: "light" | "dark"; accent?: string; keyword?: string } = {},
): string {
  const caretFile = JSON.parse(
    readFileSync(join(THEMES_DIR, `caret-${over.scheme ?? "dark"}.json`), "utf8"),
  );
  if (over.accent) caretFile.palette.accent = over.accent;
  if (over.keyword) caretFile.syntax.keyword = { ...caretFile.syntax.keyword, color: over.keyword };
  return JSON.stringify({ ...caretFile, id, label: id });
}

// Valid theme file text for suites that need a theme on disk.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const THEMES = join(import.meta.dirname, "..", "..", "ui/src/lib/themes");

/** The text of a valid theme file with `id`: caret's file for `scheme` (dark by default),
 * renamed, with `accent` and `keyword` swapped in when given. */
export function themeFileText(
  id: string,
  over: { scheme?: "light" | "dark"; accent?: string; keyword?: string } = {},
): string {
  const base = JSON.parse(
    readFileSync(join(THEMES, `caret-${over.scheme ?? "dark"}.json`), "utf8"),
  );
  if (over.accent) base.palette.accent = over.accent;
  if (over.keyword) base.syntax.keyword = { ...base.syntax.keyword, color: over.keyword };
  return JSON.stringify({ ...base, id, label: id });
}

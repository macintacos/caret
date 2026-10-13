// caret's bundled theme files for suites outside the UI bundle: read whole, or as valid
// theme-file text to put on disk.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { z } from "zod";

import type { ThemeFileSchema } from "@core/theme/schema.ts";

const THEMES_DIR = join(import.meta.dirname, "..", "..", "ui/src/lib/themes");

/** caret's own theme file for `scheme`, read as authored and unvalidated. */
export function caretThemeFile(scheme: "light" | "dark" = "dark"): z.input<typeof ThemeFileSchema> {
  return JSON.parse(readFileSync(join(THEMES_DIR, `caret-${scheme}.json`), "utf8"));
}

/** The text of a valid theme file with `id`: caret's file for `scheme` (dark by default),
 * renamed, with `accent` and `keyword` swapped in when given. */
export function themeFileText(
  id: string,
  over: { scheme?: "light" | "dark"; accent?: string; keyword?: string } = {},
): string {
  const caretFile = caretThemeFile(over.scheme);
  if (over.accent) caretFile.palette.accent = over.accent;
  if (over.keyword) caretFile.syntax.keyword = { ...caretFile.syntax.keyword, color: over.keyword };
  return JSON.stringify({ ...caretFile, id, label: id });
}

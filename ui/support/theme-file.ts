import { parseThemeFile, type ThemeFile } from "@core/theme/schema.ts";
import type { Scheme } from "$lib/theme.ts";
import { buildFileTheme, type FileTheme } from "$lib/theme-file.ts";

export async function readThemeFile(name: string): Promise<ThemeFile> {
  const parsed = parseThemeFile(
    await Bun.file(new URL(`../src/lib/themes/${name}`, import.meta.url)).text(),
  );
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  return parsed.file;
}

/** A theme file built from caret's own pair under a new id, with a keyword and accent
 * no built-in uses, so an assertion can tell it apart from caret's. */
export async function customThemeFile(id: string, scheme: Scheme): Promise<FileTheme> {
  const file = await readThemeFile(`caret-${scheme}.json`);
  return buildFileTheme({
    ...file,
    id,
    label: `Custom ${id}`,
    palette: { ...file.palette, accent: "#ff00aa" },
    syntax: { ...file.syntax, keyword: { color: "#00ffaa" } },
  });
}

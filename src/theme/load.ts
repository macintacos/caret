// Loads the user's custom themes from caret's themes folder, validating each file.
import type { Stats } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";

import { compareCodeUnits } from "@/lib/compare.ts";
import type { CustomThemes, ThemeFileError } from "@/lib/types.ts";
import { BUILTIN_THEME_IDS } from "@/theme/builtin-ids.ts";
import { parseThemeFile, type ThemeFile } from "@/theme/schema.ts";

/** Every request reads the whole folder; a real theme file is about 1 KiB. */
export const MAX_THEME_FILE_BYTES = 64 * 1024;

/** A file to parse, or a wire-ready error line for it: fixed text, never an fs message (those embed absolute paths). */
export type ThemeSource = { file: string; text: string } | { file: string; error: string };

/** Reads `dir` fresh on every call; a missing folder yields no themes and no errors. */
export async function loadCustomThemes(dir: string): Promise<CustomThemes> {
  return collectThemes(await readThemeSources(dir), BUILTIN_THEME_IDS);
}

/** Pure: parse each source, reject built-in ids, then reject every file of a duplicated id: file names are no basis for choosing which one loads. */
export function collectThemes(
  sources: readonly ThemeSource[],
  builtinIds: readonly string[],
): CustomThemes {
  const errors: ThemeFileError[] = [];
  const byId = new Map<string, { file: string; theme: ThemeFile }[]>();
  for (const source of sources) {
    if ("error" in source) {
      errors.push({ file: source.file, messages: [source.error] });
      continue;
    }
    const parsed = parseThemeFile(source.text);
    if (!parsed.ok) {
      errors.push({ file: source.file, messages: parsed.errors });
    } else if (builtinIds.includes(parsed.file.id)) {
      errors.push({ file: source.file, messages: [`id: "${parsed.file.id}" is a built-in theme`] });
    } else {
      const group = byId.get(parsed.file.id) ?? [];
      group.push({ file: source.file, theme: parsed.file });
      byId.set(parsed.file.id, group);
    }
  }
  const themes: { file: string; theme: ThemeFile }[] = [];
  for (const [id, group] of byId) {
    if (group.length === 1) {
      themes.push(...group);
      continue;
    }
    const files = group.map((entry) => entry.file).sort();
    const message = `id: "${id}" is declared by more than one file: ${files.join(", ")}`;
    for (const file of files) errors.push({ file, messages: [message] });
  }
  return {
    themes: themes.sort((a, b) => compareCodeUnits(a.file, b.file)).map((entry) => entry.theme),
    errors: errors.sort((a, b) => compareCodeUnits(a.file, b.file)),
  };
}

async function readThemeSources(dir: string): Promise<ThemeSource[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    return [{ file: basename(dir), error: "theme folder: could not be read" }];
  }
  const sources: ThemeSource[] = [];
  for (const file of names
    .filter((name) => name.endsWith(".json") && !name.startsWith("."))
    .sort()) {
    const source = await readThemeSource(join(dir, file), file);
    if (source) sources.push(source);
  }
  return sources;
}

async function readThemeSource(path: string, file: string): Promise<ThemeSource | undefined> {
  let stats: Stats;
  try {
    stats = await stat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    return { file, error: "theme file: could not be read" };
  }
  if (!stats.isFile()) return undefined;
  if (stats.size > MAX_THEME_FILE_BYTES) {
    return { file, error: `theme file: is larger than ${MAX_THEME_FILE_BYTES / 1024} KiB` };
  }
  try {
    // Bun.file strips a UTF-8 BOM; readFile keeps it and JSON.parse then rejects the text.
    return { file, text: await Bun.file(path).text() };
  } catch {
    return { file, error: "theme file: could not be read" };
  }
}

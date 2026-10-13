// Loads the user's custom themes from caret's themes folder, validating each file.
import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";

import type { CustomThemes, ThemeFileError } from "@/lib/types.ts";
import { BUILTIN_THEME_IDS } from "@/theme/builtin-ids.ts";
import { parseThemeFile, type ThemeFile } from "@/theme/schema.ts";

export const MAX_THEME_FILE_BYTES = 64 * 1024;

export type ThemeSource = { file: string; text: string } | { file: string; error: string };

/** Reads `dir` fresh on every call; a missing folder yields no themes and no errors. */
export async function loadCustomThemes(dir: string): Promise<CustomThemes> {
  return collectThemes(await readThemeSources(dir), BUILTIN_THEME_IDS);
}

/** Pure: parse each source, reject built-in ids, then reject every file of a duplicated id. */
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
    themes: themes.sort((a, b) => compare(a.file, b.file)).map((entry) => entry.theme),
    errors: errors.sort((a, b) => compare(a.file, b.file)),
  };
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// Node's fs errors embed the absolute path, so every failure below is fixed text.
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
    .sort(compare)) {
    const source = await readThemeSource(join(dir, file), file);
    if (source) sources.push(source);
  }
  return sources;
}

async function readThemeSource(path: string, file: string): Promise<ThemeSource | undefined> {
  const info = await stat(path).catch(() => undefined);
  if (!info?.isFile()) return undefined;
  if (info.size > MAX_THEME_FILE_BYTES) return { file, error: "theme file: is larger than 64 KiB" };
  try {
    // Bun.file strips a UTF-8 BOM; readFile keeps it and JSON.parse then rejects the text.
    return { file, text: await Bun.file(path).text() };
  } catch {
    return { file, error: "theme file: could not be read" };
  }
}

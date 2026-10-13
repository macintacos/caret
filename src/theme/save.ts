// Saves an uploaded theme file into caret's themes folder as `<id>.json`.
import type { Stats } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import { writeFileAtomic } from "@/lib/atomic-write.ts";
import { createKeyedQueue } from "@/lib/keyed-queue.ts";
import { BUILTIN_THEME_IDS } from "@/theme/builtin-ids.ts";
import { collectThemes, readThemeSources, type ThemeSource } from "@/theme/load.ts";
import { parseThemeFile, type ThemeFile } from "@/theme/schema.ts";

/**
 * Pure: what saving theme `id` as `<id>.json` removes from a folder holding `sources`, or why it must not.
 * Ids are lowercase slugs, so `<id>.json` is lowercase. The conflict check folds case because on a
 * case-insensitive filesystem `Nightly.json` is the target itself. A file that fails validation
 * declares nothing and is left alone; when it is the target, the write replaces it. Only an
 * `<id>.json` holding a theme caret loads is a conflict; one caret skips (a built-in or duplicated
 * id) is overwritten, or removed when it is a case variant.
 */
export function planThemeWrite(
  id: string,
  sources: readonly ThemeSource[],
): { remove: string[] } | { conflict: string } {
  const target = `${id}.json`;
  const remove: string[] = [];
  const loaded = new Set(collectThemes(sources, BUILTIN_THEME_IDS).themes.map((t) => t.id));
  for (const source of sources) {
    if ("error" in source) continue;
    const parsed = parseThemeFile(source.text);
    if (!parsed.ok) continue;
    const occupiesTarget = source.file.toLowerCase() === target;
    if (parsed.file.id === id || (occupiesTarget && !loaded.has(parsed.file.id))) {
      if (source.file !== target) remove.push(source.file);
    } else if (occupiesTarget) {
      return {
        conflict: `${source.file} already holds the theme "${parsed.file.id}"; rename or delete it, then upload again`,
      };
    }
  }
  return { remove };
}

export interface ThemeWriter {
  /**
   * Validate `text` and write it as `<id>.json` verbatim; re-serializing the parsed file would bake
   * in schema defaults and drop the user's formatting. Never throws: refusals and fs failures come
   * back as `ok: false`.
   */
  save(text: string): Promise<ThemeSave>;
}

/** Why an upload did not land. */
export type ThemeSaveRefusal = "invalid" | "conflict" | "unwritable";

/**
 * A save's `unremoved` names the files (inside the folder) that also declare the id but could
 * not be removed; `code` is the first such failure's errno, for the log.
 */
export type ThemeSave =
  | { ok: true; theme: ThemeFile; unremoved: string[]; code?: string }
  | { ok: false; reason: ThemeSaveRefusal; errors: string[]; code?: string };

/** Writes queue on the folder, so two uploads cannot interleave one's removals with the other's write. */
export function createThemeWriter(
  dir: string,
  remove = (path: string) => rm(path, { force: true }),
): ThemeWriter {
  const writes = createKeyedQueue();
  return {
    async save(text) {
      const { themes, errors } = collectThemes([{ file: "upload", text }], BUILTIN_THEME_IDS);
      const theme = themes[0];
      if (!theme)
        return { ok: false, reason: "invalid", errors: errors.flatMap((e) => e.messages) };
      let result: ThemeSave = { ok: true, theme, unremoved: [] };
      await writes.run(dir, async () => {
        const plan = planThemeWrite(theme.id, await readThemeSources(dir));
        if ("conflict" in plan) {
          result = { ok: false, reason: "conflict", errors: [plan.conflict] };
          return;
        }
        let written: Stats;
        try {
          await mkdir(dir, { recursive: true });
          // id is a schema slug, so it names no path outside dir.
          const target = join(dir, `${theme.id}.json`);
          await writeFileAtomic(target, text, { mode: 0o644 });
          written = await stat(target);
        } catch (error) {
          // Fixed text: fs messages embed absolute paths. The code is a closed token, for the log.
          result = {
            ok: false,
            reason: "unwritable",
            errors: ["theme folder: could not be written"],
            code: (error as NodeJS.ErrnoException).code,
          };
          return;
        }
        const unremoved: string[] = [];
        let code: string | undefined;
        for (const file of plan.remove) {
          // On a case-insensitive filesystem `Twin.json` is the file just written.
          const existing = await stat(join(dir, file)).catch(() => undefined);
          if (!existing || (existing.ino === written.ino && existing.dev === written.dev)) continue;
          try {
            await remove(join(dir, file));
          } catch (error) {
            unremoved.push(file);
            code ??= (error as NodeJS.ErrnoException).code;
          }
        }
        result =
          code === undefined
            ? { ok: true, theme, unremoved }
            : { ok: true, theme, unremoved, code };
      });
      return result;
    },
  };
}

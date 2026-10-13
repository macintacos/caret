// Saves an uploaded theme file into caret's themes folder as `<id>.json`.
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { writeFileAtomic } from "@/lib/atomic-write.ts";
import { createKeyedQueue } from "@/lib/keyed-queue.ts";
import { BUILTIN_THEME_IDS } from "@/theme/builtin-ids.ts";
import { collectThemes, readThemeSources, type ThemeSource } from "@/theme/load.ts";
import { parseThemeFile, type ThemeFile } from "@/theme/schema.ts";

/** Pure: what saving theme `id` as `<id>.json` removes from a folder holding `sources`, or why it must not. */
export function planThemeWrite(
  id: string,
  sources: readonly ThemeSource[],
): { remove: string[] } | { conflict: string } {
  const target = `${id}.json`;
  const remove: string[] = [];
  for (const source of sources) {
    if ("error" in source) continue;
    const parsed = parseThemeFile(source.text);
    if (!parsed.ok) continue;
    if (parsed.file.id === id) {
      if (source.file !== target) remove.push(source.file);
    } else if (source.file.toLowerCase() === target) {
      return {
        conflict: `${source.file} already holds the theme "${parsed.file.id}"; rename or delete it, then upload again`,
      };
    }
  }
  return { remove };
}

export interface ThemeWriter {
  save(text: string): Promise<ThemeSave>;
}

export type ThemeSave =
  | { ok: true; theme: ThemeFile }
  | { ok: false; status: 400 | 409 | 500; errors: string[] };

/** Writes queue on the folder, so two uploads cannot interleave one's removals with the other's write. */
export function createThemeWriter(dir: string): ThemeWriter {
  const writes = createKeyedQueue();
  return {
    async save(text) {
      const { themes, errors } = collectThemes([{ file: "upload", text }], BUILTIN_THEME_IDS);
      const theme = themes[0];
      if (!theme) return { ok: false, status: 400, errors: errors.flatMap((e) => e.messages) };
      let result: ThemeSave = { ok: true, theme };
      await writes.run(dir, async () => {
        const plan = planThemeWrite(theme.id, await readThemeSources(dir));
        if ("conflict" in plan) {
          result = { ok: false, status: 409, errors: [plan.conflict] };
          return;
        }
        try {
          await mkdir(dir, { recursive: true });
          // Removals first: on a case-insensitive filesystem `Twin.json` is `twin.json`, so
          // removing after the write would delete the theme just written.
          for (const file of plan.remove) await rm(join(dir, file), { force: true });
          await writeFileAtomic(join(dir, `${theme.id}.json`), text, { mode: 0o644 });
        } catch {
          result = { ok: false, status: 500, errors: ["theme folder: could not be written"] };
        }
      });
      return result;
    },
  };
}

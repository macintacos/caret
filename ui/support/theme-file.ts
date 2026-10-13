import { parseThemeFile, type SyntaxRole, type ThemeFile } from "@core/theme/schema.ts";
import { themeFileText } from "@test/support/theme.ts";
import { DARK_SLOT_KEY, MODE_KEY, writeCachedTheme } from "$lib/appearance.ts";
import type { Scheme } from "$lib/theme.ts";
import { buildFileTheme, type FileTheme } from "$lib/theme-file.ts";

/** The accent and keyword colors `customThemeSource` swaps in. */
export const CUSTOM_ACCENT = "#ff00aa";
export const CUSTOM_KEYWORD = "#00ffaa";

function parsedOrThrow(text: string): ThemeFile {
  const parsed = parseThemeFile(text);
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  return parsed.file;
}

/** Parse a theme file bundled under `ui/src/lib/themes/`, throwing on a validation error. */
export async function readThemeFile(name: string): Promise<ThemeFile> {
  return parsedOrThrow(
    await Bun.file(new URL(`../src/lib/themes/${name}`, import.meta.url)).text(),
  );
}

/** A bundled theme file's colors in one record: its palette, plus each syntax role's color
 * keyed by role. */
export async function themeFileColors(
  name: string,
): Promise<ThemeFile["palette"] & Record<SyntaxRole, string>> {
  const file = await readThemeFile(name);
  const roleColors = Object.entries(file.syntax).map(([role, style]) => [role, style.color]);
  return { ...file.palette, ...(Object.fromEntries(roleColors) as Record<SyntaxRole, string>) };
}

/** `themeFileText`'s file, parsed, with a keyword and accent no built-in uses so an
 * assertion can tell it apart from caret's — the unit suites and the daemon/e2e suites
 * share this one recipe. */
export async function customThemeSource(id: string, scheme: Scheme): Promise<ThemeFile> {
  return parsedOrThrow(
    themeFileText(id, { scheme, accent: CUSTOM_ACCENT, keyword: CUSTOM_KEYWORD }),
  );
}

/** `customThemeSource`, built. */
export async function customThemeFile(id: string, scheme: Scheme): Promise<FileTheme> {
  return buildFileTheme(await customThemeSource(id, scheme));
}

/** Dark mode with the dark slot saved as `id`, unregistered, and its palette cached — a
 * reload's storage before the daemon's themes arrive. Boot an appearance to show it. */
export async function seedDarkStandIn(id: string): Promise<FileTheme> {
  const file = await customThemeFile(id, "dark");
  localStorage.setItem(MODE_KEY, "dark");
  localStorage.setItem(DARK_SLOT_KEY, id);
  writeCachedTheme({ id, scheme: "dark", tokens: file.tokens });
  return file;
}

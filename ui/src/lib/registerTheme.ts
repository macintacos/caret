import { appearance } from "@/state/appearance.svelte.ts";
import { registerDiffTheme } from "$lib/diffview/theme.ts";
import { addTheme, type ThemeId } from "$lib/theme.ts";
import type { FileTheme } from "$lib/theme-file.ts";

/** The one call a theme's arrival needs: registers it for painting, both
 * highlighters, and its scheme's slot. Throws when its id is already taken. */
export function registerTheme(file: FileTheme): ThemeId {
  const id = addTheme(file);
  registerDiffTheme(id);
  appearance.refresh();
  return id;
}

import { appearance } from "@/state/appearance.svelte.ts";
import { registerDiffTheme } from "$lib/diffview/theme.ts";
import { addTheme, type CustomThemeId } from "$lib/theme.ts";
import type { FileTheme } from "$lib/theme-file.ts";

/** The one call a theme's arrival needs: registers it for painting, both
 * highlighters, and its scheme's slot. Throws when its id is already taken. */
export function registerTheme(file: FileTheme): CustomThemeId {
  // `addTheme` first — it is the only step that throws, so a refusal registers nothing;
  // the diff loader before `refresh()`, so the diff view can resolve the id the moment
  // the appearance switches to it.
  const id = addTheme(file);
  registerDiffTheme(id);
  appearance.refresh();
  return id;
}

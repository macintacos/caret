import type { CustomThemes, ThemeFileError } from "@core/lib/types";
import type { ThemeFile } from "@core/theme/schema.ts";
import { appearance } from "@/state/appearance.svelte.ts";
import { registerDiffTheme } from "$lib/diffview/theme.ts";
import { addTheme, type CustomThemeId, isCustomThemeId, replaceTheme } from "$lib/theme.ts";
import { buildFileTheme, type FileTheme } from "$lib/theme-file.ts";

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

/** The arrival call for a theme file the daemon saved. Unlike `registerTheme` it may
 * replace: a registered id is swapped in place, re-registered in the diff highlighter,
 * and re-applied to the appearance. Throws on a built-in id. */
export function registerUploadedTheme(source: ThemeFile): "added" | "replaced" {
  const file = buildFileTheme(source);
  if (!isCustomThemeId(file.id)) {
    registerTheme(file);
    return "added";
  }
  // The diff loader before reapply: a showing theme retints the diff view at once,
  // and the view must already resolve the fresh name.
  const id = replaceTheme(file);
  registerDiffTheme(id);
  appearance.reapply(id);
  return "replaced";
}

/** Registers the daemon's custom themes, then reports them loaded to the appearance
 * (`themesLoaded`), returning the files that failed to load. `null` (a failed read)
 * registers nothing and reports `themesUnavailable`, which drops a boot stand-in. Call
 * once per page load: a second call would re-register the same ids and throw. */
export function registerCustomThemes(served: CustomThemes | null): readonly ThemeFileError[] {
  if (served === null) {
    appearance.themesUnavailable();
    return [];
  }
  for (const file of served.themes) registerTheme(buildFileTheme(file));
  appearance.themesLoaded();
  return served.errors;
}

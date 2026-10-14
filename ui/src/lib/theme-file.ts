import { fillHeadingLevels } from "@core/theme/role-scopes.ts";
import type { ThemeFile } from "@core/theme/schema.ts";
import { syntaxShikiTheme } from "$lib/caret-shiki.ts";
import type { RuntimeTheme } from "$lib/theme.ts";
import { type PaletteInput, paletteTokens } from "$lib/themes/recipe.ts";

/** Not a `Theme`: its id is a plain string until `addTheme` mints it a `CustomThemeId` or `THEMES` narrows it to a `BuiltinThemeId`, and it carries no `revision` until `addTheme` sets one. */
export type FileTheme = Omit<RuntimeTheme, "id" | "revision"> & { id: string };

type RecipeColors = Omit<PaletteInput, "scheme">;
type Palette = ThemeFile["palette"];

// `never` unless the schema's palette keys equal the recipe's: the spread into
// `paletteTokens` skips excess-property checks, so a one-sided hue would pass silently.
type PaletteCheckedThemeFile = [keyof Palette, keyof RecipeColors] extends [
  keyof RecipeColors,
  keyof Palette,
]
  ? ThemeFile
  : never;

/** Build a theme file's token set and shiki theme — the one path every theme caret paints,
 * built-in or custom, goes through. */
export function buildFileTheme(file: PaletteCheckedThemeFile): FileTheme {
  const markdown = fillHeadingLevels(file.markdown ?? {});
  return {
    id: file.id,
    label: file.label,
    scheme: file.scheme,
    tokens: paletteTokens({ scheme: file.scheme, ...file.palette }),
    markdown,
    shikiTheme: syntaxShikiTheme({ ...file, markdown }),
  };
}

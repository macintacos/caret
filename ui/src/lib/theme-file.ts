import type { ThemeFile } from "@core/theme/schema.ts";
import { syntaxShikiTheme } from "$lib/caret-shiki.ts";
import type { RuntimeTheme } from "$lib/theme.ts";
import { type PaletteInput, paletteTokens } from "$lib/themes/recipe.ts";

/** Not a `Theme`: its id is a plain string until `addTheme` mints it a `CustomThemeId`. */
export type FileTheme = Omit<RuntimeTheme, "id"> & { id: string };

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

/** Build a validated theme file's token set and shiki theme, the way caret's own pair is built. */
export function buildFileTheme(file: PaletteCheckedThemeFile): FileTheme {
  return {
    id: file.id,
    label: file.label,
    scheme: file.scheme,
    tokens: paletteTokens({ scheme: file.scheme, ...file.palette }),
    shikiTheme: syntaxShikiTheme(file.id, file.scheme, file.palette, file.syntax),
  };
}

import type { ThemeRegistrationRaw } from "shiki/core";

import type { ThemeFile } from "@core/theme/schema.ts";
import { syntaxShikiTheme } from "$lib/caret-shiki.ts";
import type { Theme } from "$lib/theme.ts";
import { type PaletteInput, paletteTokens } from "$lib/themes/recipe.ts";

/** Not a `Theme`: `ThemeId` and `ShikiThemeId` are closed unions a file's slug
 * cannot join until the theme is registered. */
export type FileTheme = Omit<Theme, "id" | "shikiTheme"> & {
  id: string;
  shikiTheme: ThemeRegistrationRaw;
};

type RecipeColors = Omit<PaletteInput, "id" | "label" | "scheme" | "shikiTheme">;
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

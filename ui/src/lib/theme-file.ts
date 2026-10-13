import type { ThemeRegistrationRaw } from "shiki/core";

import type { ThemeFile } from "@core/theme/schema.ts";
import { syntaxShikiTheme } from "$lib/caret-shiki.ts";
import type { ColorToken, Scheme } from "$lib/theme.ts";
import { paletteTokens } from "$lib/themes/recipe.ts";

export interface FileTheme {
  id: string;
  label: string;
  scheme: Scheme;
  tokens: Record<ColorToken, string>;
  shikiTheme: ThemeRegistrationRaw;
}

/** Build a validated theme file's token set and shiki theme, the way caret's own pair is built. */
export function buildFileTheme(file: ThemeFile): FileTheme {
  return {
    id: file.id,
    label: file.label,
    scheme: file.scheme,
    tokens: paletteTokens({ scheme: file.scheme, ...file.palette }),
    shikiTheme: syntaxShikiTheme(file.id, file.scheme, file.palette, file.syntax),
  };
}

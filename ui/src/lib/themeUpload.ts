// Saving a theme file the user picked, and the status line the theme picker shows for it.
import type { ThemeFileError } from "@core/lib/types";
import { uploadTheme } from "$lib/api.ts";
import { registerUploadedTheme } from "$lib/registerTheme.ts";

/** A save's status line plus the folder's refreshed load errors, or a refusal: the picked file's name and one line per problem. */
export type ThemeUploadOutcome =
  | { ok: true; message: string; loadErrors: readonly ThemeFileError[] }
  | { ok: false; file: string; errors: string[] };

/** Uploads a picked theme file and registers what the daemon saved, returning the line
 * to show. A save is `ok` even when registration fails or an old file stayed behind. */
export async function uploadThemeFile(file: File): Promise<ThemeUploadOutcome> {
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { ok: false, file: file.name, errors: ["The file couldn't be read."] };
  }
  const result = await uploadTheme(text);
  if (!result.ok) return { ok: false, file: file.name, errors: result.errors };
  const { theme, errors: loadErrors, unremoved } = result;
  const saved = (message: string): ThemeUploadOutcome => ({ ok: true, message, loadErrors });
  // The folder skips every file declaring a shared id, so registering would show a theme
  // the next load refuses.
  if (unremoved.length > 0) {
    const names = unremoved.map((name) => `"${name}"`).join(", ");
    const [declares, them] = unremoved.length === 1 ? ["declares", "it"] : ["declare", "them"];
    return saved(
      `Saved "${theme.label}", but ${names} also ${declares} its id. Delete ${them} and reload the page.`,
    );
  }
  let registration: "added" | "replaced";
  try {
    registration = registerUploadedTheme(theme);
  } catch {
    // The daemon has already saved the file, so this is not a refusal.
    return saved(`Saved "${theme.label}". Reload the page to use it.`);
  }
  return saved(
    registration === "added"
      ? `Added "${theme.label}" to the ${theme.scheme} themes.`
      : `Replaced "${theme.label}".`,
  );
}

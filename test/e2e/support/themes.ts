// Theme files a spec puts in its daemon's themes folder and selects before the page loads.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Page } from "@playwright/test";

import type { Daemon } from "@test/e2e/support/fixtures.ts";
import { caretThemeFile } from "@test/support/theme.ts";

/** caret's own theme file for `scheme`, renamed `id`, with `accent` in place of caret's so a
 * spec can tell when it has painted, and `markdown` in place of caret's markdown styles —
 * none when omitted. */
export function caretThemeVariant(
  id: string,
  scheme: "light" | "dark",
  {
    accent,
    markdown,
  }: { accent: string; markdown?: ReturnType<typeof caretThemeFile>["markdown"] },
): ReturnType<typeof caretThemeFile> {
  const caret = caretThemeFile(scheme);
  return { ...caret, id, label: id, palette: { ...caret.palette, accent }, markdown };
}

/** Write `file` into the themes folder and save it as its scheme's choice, before the page
 * loads. It paints once the daemon's themes arrive. */
export async function selectThemeFile(
  page: Page,
  daemon: Daemon,
  file: ReturnType<typeof caretThemeFile>,
): Promise<void> {
  await writeFile(join(daemon.themesDir, `${file.id}.json`), JSON.stringify(file));
  await page.addInitScript(([scheme, id]) => localStorage.setItem(`caret.theme.${scheme}`, id), [
    file.scheme,
    file.id,
  ] as const);
}

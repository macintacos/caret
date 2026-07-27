// Standalone syntax highlighting for the filename-hover excerpt (EXC-687). The
// @pierre/diffs library keeps its own private highlighter, so this builds a small
// dedicated one bound to shiki's full grammar bundle and caret's themes, then
// highlights an excerpt to the caret theme in effect — so the popover reads like
// the plan view's own code. Grammars load lazily and cache; anything that can't
// highlight falls back to plain text. Never throws.

import { REGISTERED_SHIKI_THEMES } from "$lib/caret-theme.ts";
import { createHighlighter } from "$lib/diffview/shiki-bundle.ts";
import type { ThemeId } from "$lib/theme.ts";

type Highlighter = Awaited<ReturnType<typeof createHighlighter>>;

let highlighterPromise: Promise<Highlighter> | undefined;
const loadedLanguages = new Set<string>();

function highlighter(): Promise<Highlighter> {
  if (highlighterPromise === undefined) {
    highlighterPromise = createHighlighter({
      langs: [],
      themes: REGISTERED_SHIKI_THEMES,
    });
  }
  return highlighterPromise;
}

// Loads `language`'s grammar into the shared highlighter, returning the name to
// actually highlight with — the requested grammar when it loads, else "text".
async function resolveLanguage(hl: Highlighter, language: string): Promise<string> {
  if (language === "" || language === "text") return "text";
  if (loadedLanguages.has(language)) return language;
  try {
    await hl.loadLanguage(language as Parameters<Highlighter["loadLanguage"]>[0]);
    loadedLanguages.add(language);
    return language;
  } catch {
    return "text";
  }
}

/** Highlights `code` to themed HTML (`<pre class="shiki">…`) for the excerpt
 * popover, in the caret theme currently painted — the popover opens over the plan
 * view, so it reads as the same palette. Returns "" on any failure so the caller
 * can fall back to rendering the code as plain text. */
export async function highlightExcerpt(
  code: string,
  language: string,
  themeId: ThemeId,
): Promise<string> {
  try {
    const hl = await highlighter();
    const lang = await resolveLanguage(hl, language);
    return hl.codeToHtml(code, { lang, theme: themeId });
  } catch {
    return "";
  }
}

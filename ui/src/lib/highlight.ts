import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { caretDark, caretLight } from "./caret-theme.ts";

let highlighter: HighlighterCore | null = null;
let initPromise: Promise<void> | null = null;

// The pure-JS regex engine (no oniguruma WASM) is shiki's recommended browser
// setup: it covers every built-in grammar caret ships and avoids the ~472 KB
// WASM fetch the oniguruma engine would cost. Grammars are lazy `() => import()`
// factories so vite code-splits each into its own hashed chunk the highlighter
// fetches on demand, keeping them out of the initial JS payload — a bare
// `import()` promise would fetch eagerly, the factory defers. Extend coverage by
// adding another `() => import("shiki/langs/*.mjs")` factory to this list.
const langs = [
  () => import("shiki/langs/typescript.mjs"),
  () => import("shiki/langs/javascript.mjs"),
  () => import("shiki/langs/json.mjs"),
  () => import("shiki/langs/yaml.mjs"),
  () => import("shiki/langs/toml.mjs"),
  () => import("shiki/langs/shellscript.mjs"),
  () => import("shiki/langs/diff.mjs"),
  () => import("shiki/langs/markdown.mjs"),
];

/**
 * Create the shared shiki highlighter once. Awaited at app bootstrap
 * (ui/src/main.ts) before the first render so renderPlan() stays synchronous.
 * Idempotent and concurrency-safe: the in-flight promise is memoized, so
 * overlapping callers share one build rather than each creating a highlighter.
 */
export function initHighlighter(): Promise<void> {
  initPromise ??= createHighlighterCore({
    themes: [caretLight, caretDark],
    langs,
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  }).then((hl) => {
    highlighter = hl;
  });
  return initPromise;
}

/**
 * Highlight one fenced code block, returning shiki's dual-theme HTML
 * (`<pre class="shiki" …>` with per-token `--shiki-light` / `--shiki-dark`
 * variables). Returns null when highlighting can't apply — the highlighter is
 * not ready (cold start, failed init, tests), there is no language marker, or
 * the language is unknown/unloaded — so callers fall back to a plain <pre>.
 */
export function highlightToHtml(code: string, lang: string | undefined): string | null {
  if (!highlighter || !lang) return null;
  const id = lang.toLowerCase();
  if (!highlighter.getLoadedLanguages().includes(id)) return null;
  return highlighter.codeToHtml(code, {
    lang: id,
    themes: { light: "caret-light", dark: "caret-dark" },
    defaultColor: false,
  });
}

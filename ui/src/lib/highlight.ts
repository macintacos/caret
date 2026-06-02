import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import diff from "shiki/langs/diff.mjs";
import javascript from "shiki/langs/javascript.mjs";
import json from "shiki/langs/json.mjs";
import markdown from "shiki/langs/markdown.mjs";
import shellscript from "shiki/langs/shellscript.mjs";
import toml from "shiki/langs/toml.mjs";
import typescript from "shiki/langs/typescript.mjs";
import yaml from "shiki/langs/yaml.mjs";
import { caretDark, caretLight } from "./caret-theme.ts";

let highlighter: HighlighterCore | null = null;

// The pure-JS regex engine (no oniguruma WASM) and statically-imported grammars
// keep shiki inside vite-plugin-singlefile's no-dynamic-import / single-file
// bundle constraint. Extend coverage by adding another `shiki/langs/*.mjs`
// import to this list.
const langs = [typescript, javascript, json, yaml, toml, shellscript, diff, markdown];

/**
 * Create the shared shiki highlighter once. Awaited at app bootstrap
 * (ui/src/main.ts) before the first render so renderPlan() stays synchronous.
 * Idempotent; safe to call more than once.
 */
export async function initHighlighter(): Promise<void> {
  if (highlighter) return;
  highlighter = await createHighlighterCore({
    themes: [caretLight, caretDark],
    langs,
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  });
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

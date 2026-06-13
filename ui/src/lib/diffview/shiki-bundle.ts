// Scoped stand-in for the bare `shiki` barrel that @pierre/diffs imports.
// vite.config.ts aliases `shiki` to this module for the UI build, so the
// library's `import { bundledLanguages } from "shiki"` resolves here instead of
// shiki's full bundle. The full barrel's `bundledLanguages` is a map of ~300
// language loaders; vite code-splits every one into the bundle, so importing it
// pulls every grammar into the embedded UI asset even though the source view
// only ever highlights markdown. This module re-exports shiki's tree-shakable
// core plus the engine factories the library names, and narrows the bundled
// language/theme maps to the set caret actually renders: markdown plus the
// grammars caret's highlight pipeline loads for fenced code, and no themes
// (caret registers its own via registerCustomTheme, so the bundled-theme map is
// never consulted). The Oniguruma WASM engine stays exported so the library's
// static reference resolves, but caret uses the pure-JS engine, so the WASM
// binary is never fetched.

import { createBundledHighlighter } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

// shiki/core carries the token/theme/codeToHtml surface the library imports
// from the bare barrel (getTokenStyleObject, stringifyTokenStyle, normalizeTheme,
// codeToHtml, createCssVariablesTheme, …); re-export it wholesale so the alias is
// a faithful superset for everything except the bundled maps narrowed below.
export * from "shiki/core";

// The grammar scope: markdown (the plan source language) plus the grammars
// caret's highlight pipeline loads for fenced code blocks. Each entry is a lazy
// `() => import("shiki/langs/*.mjs")` factory, so vite emits one chunk per
// grammar and the highlighter fetches it on demand — keeping grammars out of
// the initial payload while bounding the build to this set.
export const bundledLanguages = {
  markdown: () => import("shiki/langs/markdown.mjs"),
  typescript: () => import("shiki/langs/typescript.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  toml: () => import("shiki/langs/toml.mjs"),
  shellscript: () => import("shiki/langs/shellscript.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
} as const;

// caret registers caret-light / caret-dark as custom themes (diffview/theme.ts),
// so the library resolves them from its custom-theme registry and never falls
// through to this map. An empty map keeps shiki's bundled themes out of the
// build without changing what caret renders.
export const bundledThemes = {} as const;

// Engine factories the library names from the bare barrel. The JS regex engine
// is caret's runtime engine; the Oniguruma factory is re-exported only so the
// library's static reference resolves — it is never invoked, so the WASM binary
// never loads.
export { createJavaScriptRegexEngine } from "shiki/engine/javascript";
export { createOnigurumaEngine, loadWasm } from "shiki/engine/oniguruma";

/**
 * A `createHighlighter` bound to the scoped language/theme maps above, built the
 * way shiki's own bundles are (createBundledHighlighter). The library calls this
 * to construct its shared highlighter; binding it to the scoped maps means a
 * `langs: ["markdown"]` request resolves from this set, and any out-of-scope
 * language id is simply not found — the source view falls back to plain text,
 * matching the pre-existing pipeline's behavior for unloaded grammars.
 */
export const createHighlighter = createBundledHighlighter({
  langs: bundledLanguages,
  themes: bundledThemes,
  engine: () => createJavaScriptRegexEngine(),
});

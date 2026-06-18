// Stand-in for the bare `shiki` barrel that @pierre/diffs imports. vite.config.ts
// aliases `shiki` to this module for the UI build, so the library's
// `import { bundledLanguages } from "shiki"` resolves here instead of shiki's own
// bundle entry. The module exists to swap two things the library would otherwise
// take from the bare barrel: the highlighter's regex engine (caret uses shiki's
// pure-JS engine, never the Oniguruma WASM binary) and the bundled-theme map
// (caret registers its own themes via registerCustomTheme, so the bundled-theme
// map is never consulted). It re-exports shiki's tree-shakable core plus the
// engine factories the library names, and — per EXC-665 — exposes shiki's FULL
// language bundle so every grammar an agent can tag a fenced code block with is
// highlightable, not just a hand-picked subset. caret runs entirely locally, so
// the embedded asset's size is a non-concern; the grammars are lazy loaders
// (below), so the full set costs build-time chunks, not a bigger initial payload.

import { bundledLanguages as fullBundledLanguages } from "shiki/bundle/full";
import { createBundledHighlighter } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

// shiki/core carries the token/theme/codeToHtml surface the library imports
// from the bare barrel (getTokenStyleObject, stringifyTokenStyle, normalizeTheme,
// codeToHtml, createCssVariablesTheme, …); re-export it wholesale so the alias is
// a faithful superset for everything except the bundled-theme map narrowed below.
export * from "shiki/core";

// shiki's full grammar bundle (EXC-665): every language shiki ships, each entry a
// lazy `() => import("shiki/langs/*.mjs")` factory, so vite emits one chunk per
// grammar and the highlighter fetches it on demand — driven by the languages
// caret scans out of the plan's fences (see languages.ts). Exposing the full set
// means any fence tag an agent writes — lua, kotlin, swift, … — resolves and
// highlights, rather than only the grammars an earlier scoped list happened to
// name. shiki-bundle.test.ts pins this to shiki's own full bundle, so a
// regression that re-narrows it (the bug EXC-665 fixed, where unlisted languages
// rendered plain) fails the unit suite.
export const bundledLanguages = fullBundledLanguages;

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
 * A `createHighlighter` bound to the full language bundle + caret's themes, built
 * the way shiki's own bundles are (createBundledHighlighter). The library calls
 * this to construct its shared highlighter; binding it to the full set means a
 * `langs: ["markdown"]` request — or any grammar id caret's fence scan turns up —
 * resolves from shiki's complete bundle. The JS engine runs `forgiving`, so a
 * grammar carrying a pattern the engine can't compile skips that pattern instead
 * of throwing at load time, maximizing how much of the full set actually
 * highlights; a grammar that still fails to load leaves its fences plain
 * (languages.ts) — the pre-existing behavior for an unavailable grammar.
 */
export const createHighlighter = createBundledHighlighter({
  langs: bundledLanguages,
  themes: bundledThemes,
  engine: () => createJavaScriptRegexEngine({ forgiving: true }),
});

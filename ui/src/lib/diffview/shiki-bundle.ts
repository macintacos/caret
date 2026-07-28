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
import {
  createJavaScriptRegexEngine,
  defaultJavaScriptRegexConstructor,
} from "shiki/engine/javascript";

import { jscSafeSource } from "$lib/diffview/jsc-regex.ts";

// shiki/core carries the token/theme/codeToHtml surface the library imports
// from the bare barrel (getTokenStyleObject, stringifyTokenStyle, normalizeTheme,
// codeToHtml, createCssVariablesTheme, …); re-export it wholesale so the alias is
// a faithful superset for everything except the bundled-theme map narrowed below.
export * from "shiki/core";

// shiki's full grammar bundle (EXC-665): every language shiki ships, each a lazy
// `() => import("shiki/langs/*.mjs")` factory the highlighter fetches on demand
// (driven by the fences caret scans — see languages.ts). shiki-bundle.test.ts
// pins this to shiki's own full bundle, so a regression that re-narrows it — the
// bug EXC-665 fixed, where unlisted languages rendered plain — fails the suite.
export const bundledLanguages = fullBundledLanguages;

// caret registers every one of its palettes as a custom theme (diffview/theme.ts),
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
 * caret's regex engine: shiki's pure-JS engine with every compiled pattern passed
 * through the JavaScriptCore repair in `jsc-regex.ts` (EXC-911). Named rather than
 * inlined so a test can tokenize through the exact engine the UI renders with — a
 * bare `createJavaScriptRegexEngine()` is a different engine and pins nothing.
 *
 * The engine runs STRICT. `forgiving: true` was carried here from EXC-665 on the
 * theory that some grammar needed it, but all 332 bundled grammars load and all
 * 14,234 of their patterns translate without it, so it rescued nothing. What it
 * did do was let a pattern the engine cannot compile be dropped silently — and
 * silent degradation is precisely what hid EXC-911's mis-scoped comments for so
 * long. Strict trades that for a throw, which surfaces rather than festers.
 *
 * Patterns compile lazily, at first tokenize rather than at load, so the strict
 * throw would land when a fence is rendered. shiki-bundle.test.ts guards both
 * halves: every grammar loading on each run, and every pattern translating under
 * an opt-in sweep (it costs ~9s, so it is not on the default path).
 */
export const createCaretRegexEngine = () =>
  createJavaScriptRegexEngine({
    regexConstructor: (pattern) => {
      const re = defaultJavaScriptRegexConstructor(pattern, { target: "auto" });
      // oniguruma-to-es hands back an EmulatedRegExp subclass when a pattern needs
      // state a plain RegExp cannot carry — hidden captures, capture transfers, a
      // search strategy — and its `exec` uses that state to remap capture indices.
      // Rebuilding one as a plain RegExp would silently drop it and shift every
      // index, which is the very positional-capture corruption this module exists
      // to prevent. No pattern in the bundle needs both, so leave the emulated ones
      // exactly as produced: unrepaired beats subtly wrong.
      if (Object.getPrototypeOf(re) !== RegExp.prototype) return re;
      const safe = jscSafeSource(re.source);
      // Rebuild only when the transform fired, so the 14,192 untouched patterns
      // keep the exact RegExp the default constructor produced.
      return safe === re.source ? re : new RegExp(safe, re.flags);
    },
  });

/**
 * A `createHighlighter` bound to the full language bundle + caret's themes, built
 * the way shiki's own bundles are (createBundledHighlighter). The library calls
 * this to construct its shared highlighter; binding it to the full set means a
 * `langs: ["markdown"]` request — or any grammar id caret's fence scan turns up —
 * resolves from shiki's complete bundle. A grammar that fails to load leaves its
 * fences plain (languages.ts) — the pre-existing behavior for an unavailable
 * grammar.
 */
export const createHighlighter = createBundledHighlighter({
  langs: bundledLanguages,
  themes: bundledThemes,
  engine: createCaretRegexEngine,
});

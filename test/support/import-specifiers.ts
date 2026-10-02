/**
 * Every module specifier in `source`, type-only imports included, in source order:
 * `from "…"` (which also catches `export … from`), a bare side-effect `import "…"`, and a
 * dynamic `import("…")`. The structure suites that police imports read them through this
 * one extractor, so hardening it hardens all of them.
 *
 * - The `(?<!@)` guard drops CSS `@import` at-rules, which are not module references.
 * - **Double-quoted specifiers only**: biome formats the tree with `quoteStyle: "double"`,
 *   so a single-quoted import fails `mise run lint` first. A template-literal or
 *   `require()` specifier is missed.
 * - **Raw source is scanned, not a token stream**, so a `from "…"` in a comment or a
 *   template literal counts. That loud false positive (reword the prose) is the
 *   deliberate trade against a tokenizer that could mis-parse a regex literal and
 *   silently stop seeing real imports.
 */
export function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/(?<!@)\b(?:from|import)\s*\(?\s*"([^"]+)"/g)].flatMap((m) =>
    m[1] ? [m[1]] : [],
  );
}

// Statements TypeScript erases entirely. `import { type X } from "p"` still counts: whether
// it survives depends on the transpiler (caret's verbatimModuleSyntax keeps it as
// `import {} from`), so the gate assumes it does. The `^` anchor keeps a match out of
// comments and binding lists; `[^{}]` rather than `[^}]` keeps an unclosed `import type {`
// from running on to a later statement's `}` and erasing a real import.
const ERASED_STATEMENT =
  /^(?:import|export)\s+type\s+(?:\{[^{}]*\}|\*(?:\s+as\s+\w+)?|\w+)\s*from\s*"[^"]+"/gm;

/** Every specifier except those of whole statements TypeScript erases; a type-position
 * `import("…")` still counts. */
export function runtimeImportSpecifiers(source: string): string[] {
  return importSpecifiers(source.replace(ERASED_STATEMENT, ""));
}

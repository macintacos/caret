// Fenced-code highlighting for the markdown plan view. @pierre/diffs highlights
// the plan as a single "markdown" document, and shiki's markdown grammar lists
// every fenced language as `embeddedLangsLazy` — grammars it will tokenize a
// ```lang block with, but only once that grammar is attached to the highlighter.
// The library only ever attaches the file's own language ("markdown"), so by
// default fenced code renders as one un-tokenized markdown "raw" color. This
// module closes that gap: it scans the plan for the languages its fences use and
// attaches those grammars to the library's shared highlighter, so the markdown
// grammar's embedded rules light the code up.
//
// This is the single owner of the fenced-language @pierre/diffs imports, mirroring
// how theme.ts owns the theme registration.
import { preloadHighlighter } from "@pierre/diffs";

import { bundledLanguages } from "$lib/diffview/shiki-bundle.ts";
import { caretDiffTheme } from "$lib/diffview/theme.ts";

// The grammars the shiki bundle can resolve (canonical shiki names). markdown is
// the plan source language itself; the rest are the fenced-code grammars.
const BUNDLED: ReadonlySet<string> = new Set(Object.keys(bundledLanguages));

// Fence info-strings agents write don't always match shiki's canonical grammar
// name; map the common aliases onto the grammar that actually carries their
// scope so ```sh and ```py resolve. Tags already equal to a canonical name pass
// through unchanged (the lookup below defaults to the tag itself).
const ALIAS: Readonly<Record<string, string>> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  node: "javascript",
  ts: "typescript",
  py: "python",
  python3: "python",
  rb: "ruby",
  rs: "rust",
  golang: "go",
  sh: "shellscript",
  bash: "shellscript",
  zsh: "shellscript",
  shell: "shellscript",
  console: "shellscript",
  yml: "yaml",
  "c++": "cpp",
  cxx: "cpp",
  cc: "cpp",
  hpp: "cpp",
  htm: "html",
  docker: "dockerfile",
  gql: "graphql",
};

// Opening fences: 3+ backticks or tildes (≤3 leading spaces per CommonMark),
// then the info string's first token. A closing fence has no token, so it never
// matches. The class allows `+`/`#`/`.` so c++, c#, and dotted ids survive to
// the alias step. This is intentionally a stateless superset, not a CommonMark
// parser: a fence shown *inside* another fenced block is also scanned, so a
// language may be over-attached (one extra on-demand chunk, harmless — the
// markdown grammar still nests correctly at tokenization time). It never
// under-attaches, which is what matters.
const FENCE_RE = /^[ \t]{0,3}(?:`{3,}|~{3,})[ \t]*([A-Za-z0-9_+#.-]+)/gm;

/**
 * Canonical grammar names for the fenced code blocks in `text`, limited to the
 * grammars the shiki bundle can resolve. Aliased tags (js, sh, py…) normalize
 * to their canonical grammar; `markdown`, plain ```text, and any tag outside the
 * bundle are dropped so the highlighter is never asked to load a grammar it
 * doesn't have. Deduped and sorted for a stable preload key.
 */
export function scanFenceLanguages(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(FENCE_RE)) {
    const tag = (m[1] ?? "").toLowerCase();
    const lang = ALIAS[tag] ?? tag;
    if (lang !== "markdown" && BUNDLED.has(lang)) found.add(lang);
  }
  return [...found].sort();
}

// A grammar is attached to the shared highlighter exactly once, but several
// mounts can ask for it concurrently (e.g. a fast review switch between two plans
// that use the same language). Track load COMPLETION, not just the request:
// `loaded` holds grammars now attached, `inflight` holds the in-progress load per
// grammar. Every concurrent caller awaits the same promise and is told truthfully
// whether the grammar became attached, so each schedules its own re-highlight
// once the chunk lands — rather than the first caller "winning" the request and
// the rest no-op'ing against a grammar that wasn't attached yet.
const loaded = new Set<string>();
const inflight = new Map<string, Promise<boolean>>();

// Load one grammar into the shared highlighter, deduped by name. Resolves true
// once attached, false if the load failed (best-effort: a grammar that fails to
// load leaves its fences plain and must never break the view). A failed load is
// dropped from `inflight` (and never added to `loaded`) so a later mount retries.
function startLoad(lang: string): Promise<boolean> {
  const p = preloadHighlighter({
    themes: [caretDiffTheme.theme.light, caretDiffTheme.theme.dark],
    langs: [lang],
  })
    .then(() => {
      loaded.add(lang);
      return true;
    })
    .catch(() => false)
    .finally(() => {
      inflight.delete(lang);
    });
  inflight.set(lang, p);
  return p;
}

/**
 * Attach the given fenced-code grammars to the library's shared highlighter so
 * the markdown grammar's embedded fence rules can tokenize them. Resolves to
 * whether any grammar became newly attached as a result of this call — the
 * caller uses that to decide whether to force a re-highlight. Safe to call
 * repeatedly and concurrently: already-attached grammars are skipped and an
 * in-flight load is shared, so concurrent callers each learn when it lands.
 */
export async function preloadFenceLanguages(langs: string[]): Promise<boolean> {
  const pending = langs.filter((l) => !loaded.has(l)).map((l) => inflight.get(l) ?? startLoad(l));
  if (pending.length === 0) return false;
  const results = await Promise.all(pending);
  return results.some(Boolean);
}

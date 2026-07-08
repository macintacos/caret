// Caret-themed code highlighting for the rendered plan view (EXC-693). The
// source view highlights fenced code through @pierre/diffs' shiki; the rendered
// view renders code blocks as light-DOM panels, so it needs its own highlighter.
// This builds one bound to caret's own themes (caret-theme.ts) — the SAME colors
// the source view uses — so a code block reads identically in both views.
//
// Output is dual-theme (defaultColor:false): each token carries --shiki-light /
// --shiki-dark CSS variables, and app.css switches them on prefers-color-scheme,
// matching how the rest of caret flips light/dark. The highlighter is a lazy
// singleton over shiki's pure-JS regex engine (never the Oniguruma WASM), and
// grammars load on demand; an unknown or failed grammar falls back to escaped
// plain code so a code block never breaks the view.
import { bundledLanguages } from "shiki/bundle/full";
import { createBundledHighlighter } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { caretDark, caretLight } from "./caret-theme.ts";

// Canonical grammar names the bundle can resolve.
const BUNDLED: ReadonlySet<string> = new Set(Object.keys(bundledLanguages));

// Fence info-strings agents write don't always match shiki's canonical grammar
// name; map the common aliases (mirrors diffview/languages.ts). A tag already
// equal to a canonical name passes through unchanged.
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

/** Canonical grammar for a fence info-string, or null when unavailable (the code
 * then renders as escaped plain text). Case-insensitive; aliases normalized. */
export function resolveLang(lang: string | null | undefined): string | null {
  if (lang == null) return null;
  const key = lang.trim().toLowerCase();
  if (key === "") return null;
  const canon = ALIAS[key] ?? key;
  return BUNDLED.has(canon) ? canon : null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The fallback code panel: escaped, inert monospace text, same wrapper shape as
 * shiki's output so the panel CSS applies either way. */
export function plainCodeHtml(code: string): string {
  return `<pre class="shiki md-code-plain"><code>${escapeHtml(code)}</code></pre>`;
}

const createCaretHighlighter = createBundledHighlighter({
  langs: bundledLanguages,
  themes: {
    "caret-light": async () => ({ ...caretLight, name: "caret-light" }),
    "caret-dark": async () => ({ ...caretDark, name: "caret-dark" }),
  },
  engine: () => createJavaScriptRegexEngine({ forgiving: true }),
});

type CaretHighlighter = Awaited<ReturnType<typeof createCaretHighlighter>>;
let highlighterPromise: Promise<CaretHighlighter> | undefined;

function getHighlighter(): Promise<CaretHighlighter> {
  if (highlighterPromise == null) {
    highlighterPromise = createCaretHighlighter({
      langs: [],
      themes: ["caret-light", "caret-dark"],
    });
  }
  return highlighterPromise;
}

/**
 * Highlight `code` for `lang`, returning caret-themed dual-theme HTML. An unknown
 * or failed grammar falls back to escaped plain code — best-effort, never throws,
 * so a code block can't break the rendered view.
 */
export async function highlightCode(
  code: string,
  lang: string | null | undefined,
): Promise<string> {
  const resolved = resolveLang(lang);
  if (resolved == null) return plainCodeHtml(code);
  try {
    const highlighter = await getHighlighter();
    if (!highlighter.getLoadedLanguages().includes(resolved)) {
      // resolveLang already proved `resolved` is a bundled grammar name, but its
      // static type is the open BundledLanguage union — cast to what loadLanguage
      // accepts rather than widen the whole bundle's typing.
      await highlighter.loadLanguage(resolved as Parameters<CaretHighlighter["loadLanguage"]>[0]);
    }
    return highlighter.codeToHtml(code, {
      lang: resolved,
      themes: { light: "caret-light", dark: "caret-dark" },
      defaultColor: false,
    });
  } catch {
    return plainCodeHtml(code);
  }
}

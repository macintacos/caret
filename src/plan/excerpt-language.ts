// The grammar a file previews in, by its extension. Node-free, so the browser can warm the
// grammars a plan's file references will open in, as well as the daemon naming one with
// each excerpt.

// Extension → shiki grammar name. Only the common source/config kinds are
// mapped; anything else previews as plain "text" (still readable, just uncolored).
export const EXT_LANGUAGE: Readonly<Record<string, string>> = {
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".jsx": "jsx",
  ".svelte": "svelte",
  ".vue": "vue",
  ".json": "json",
  ".jsonc": "jsonc",
  ".css": "css",
  ".scss": "scss",
  ".less": "less",
  ".html": "html",
  ".htm": "html",
  ".xml": "xml",
  ".svg": "xml",
  ".md": "markdown",
  ".mdx": "mdx",
  ".py": "python",
  ".rb": "ruby",
  ".rs": "rust",
  ".go": "go",
  ".java": "java",
  ".kt": "kotlin",
  ".c": "c",
  ".h": "c",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".hpp": "cpp",
  ".sh": "shellscript",
  ".bash": "shellscript",
  ".zsh": "shellscript",
  ".toml": "toml",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".ini": "ini",
  ".sql": "sql",
  ".graphql": "graphql",
  ".gql": "graphql",
  ".php": "php",
  ".swift": "swift",
  ".dart": "dart",
  ".lua": "lua",
};

/** The shiki grammar `path` previews in, or "text" where its extension maps to none. A
 * dotfile has no extension. */
export function languageForPath(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return (dot > 0 ? EXT_LANGUAGE[name.slice(dot).toLowerCase()] : undefined) ?? "text";
}

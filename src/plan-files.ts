// Resolves a plan's filename reference to a real file inside the review's cwd
// and reads a bounded, line-aware excerpt for the hover preview (EXC-687). The
// browser can't touch the filesystem, so the daemon does both — keyed off the
// review record's cwd, never a client-supplied base. Resolution is confined to
// cwd: a `../` or symlink target that escapes it resolves to null, so the
// daemon never becomes an arbitrary local-file reader. A reference that resolves
// to no real file yields null, and the UI then shows no icon and no affordance.

import { type Dirent, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { FileExcerpt } from "./types.ts";

/** Lines of context on each side of a referenced `:line` (the ±window). */
export const EXCERPT_RADIUS = 12;
/** Lines shown from the top when a reference carries no line number. */
export const EXCERPT_HEAD_LINES = 24;
/** Files larger than this are not previewed (skip, don't read). */
export const MAX_EXCERPT_BYTES = 2 * 1024 * 1024;
/** Upper bound on directory entries the basename fallback will scan. */
const MAX_SCAN_ENTRIES = 5000;

// Heavy or irrelevant subtrees the basename search never descends into.
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage", "out"]);

// Extension → shiki grammar name. Only the common source/config kinds are
// mapped; anything else previews as plain "text" (still readable, just uncolored).
const EXT_LANGUAGE: Readonly<Record<string, string>> = {
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
};

function languageForPath(path: string): string {
  return EXT_LANGUAGE[extname(path).toLowerCase()] ?? "text";
}

function safeRealpath(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

// The canonical path of `abs` when it is a real regular file inside `cwdReal`,
// else null. realpath resolves symlinks first, so a link whose target escapes
// cwd is rejected here rather than followed out of the tree.
function containedFile(cwdReal: string, abs: string): string | null {
  const real = safeRealpath(abs);
  if (real === null) return null;
  if (real !== cwdReal && !real.startsWith(cwdReal + sep)) return null;
  try {
    if (!statSync(real).isFile()) return null;
  } catch {
    return null;
  }
  return real;
}

// Breadth-first search for a file named `name` under cwdReal, returning the
// shallowest match (BFS visits by depth). Bounded by MAX_SCAN_ENTRIES and blind
// to symlinked directories (withFileTypes reports the link, not its target), so
// it can neither loop nor escape the tree. This is the "intelligent guess" for a
// reference that gives only a basename.
function basenameSearch(cwdReal: string, name: string): string | null {
  if (name === "") return null;
  let scanned = 0;
  const queue: string[] = [cwdReal];
  while (queue.length > 0) {
    const currentDir = queue.shift() as string;
    let entries: Dirent[];
    try {
      entries = readdirSync(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (++scanned > MAX_SCAN_ENTRIES) return null;
      if (entry.isFile()) {
        if (entry.name === name) return join(currentDir, entry.name);
      } else if (entry.isDirectory() && !SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
        queue.push(join(currentDir, entry.name));
      }
    }
  }
  return null;
}

/**
 * Resolves a plan's filename reference to a real file's canonical absolute path,
 * confined to `cwd`. Tries `cwd`-relative resolution first; on a miss, falls
 * back to a bounded basename search under `cwd`. Returns null when `cwd` is not
 * an absolute path, when nothing matches, or when the target escapes `cwd`.
 */
export function resolveFileInCwd(cwd: string, candidate: string): string | null {
  if (cwd === "" || !isAbsolute(cwd)) return null;
  const cwdReal = safeRealpath(cwd);
  if (cwdReal === null) return null;

  const cleaned = candidate.trim();
  if (cleaned === "") return null;

  const direct = containedFile(cwdReal, resolve(cwdReal, cleaned));
  if (direct !== null) return direct;

  // Only the basename matters to the fallback; a directory hint that didn't
  // resolve directly can't help narrow a filesystem-wide search here.
  const name = cleaned.split("/").pop() ?? "";
  return basenameSearch(cwdReal, name);
}

/**
 * Resolves `candidate` within `cwd` and returns a bounded excerpt: a ±window
 * around `line` (1-based) when given, else the head of the file. Returns null
 * when the reference doesn't resolve, the file is too large, or its content is
 * binary. Never throws.
 */
export function readFileExcerpt(cwd: string, candidate: string, line?: number): FileExcerpt | null {
  const abs = resolveFileInCwd(cwd, candidate);
  if (abs === null) return null;

  let size: number;
  try {
    size = statSync(abs).size;
  } catch {
    return null;
  }
  if (size > MAX_EXCERPT_BYTES) return null;

  let content: string;
  try {
    content = readFileSync(abs, "utf-8");
  } catch {
    return null;
  }
  if (content.includes("\0")) return null; // binary

  const allLines = content.split("\n");
  // A trailing newline yields a phantom empty final element; drop it so the line
  // count matches the editor's, but keep a genuinely-empty file as one line.
  if (allLines.length > 1 && allLines[allLines.length - 1] === "") allLines.pop();
  const totalLines = allLines.length;

  let startLine: number;
  let endLine: number;
  if (line !== undefined && line >= 1) {
    startLine = Math.max(1, line - EXCERPT_RADIUS);
    endLine = Math.min(totalLines, line + EXCERPT_RADIUS);
  } else {
    startLine = 1;
    endLine = Math.min(totalLines, EXCERPT_HEAD_LINES);
  }

  const cwdReal = safeRealpath(cwd) ?? cwd;
  return {
    path: relative(cwdReal, abs),
    language: languageForPath(abs),
    startLine,
    endLine,
    lines: allLines.slice(startLine - 1, endLine),
    totalLines,
  };
}

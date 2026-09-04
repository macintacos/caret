// Resolves a plan's path reference against the review's cwd — reporting whether
// it is a file or a directory (EXC-916) — and reads a line-aware excerpt of a
// file for the preview card (EXC-687). The browser can't touch the filesystem,
// so the daemon does both, keyed off the review record's cwd and never a
// client-supplied base. Resolution is confined to cwd: a `../` or symlink target
// that escapes it resolves to null, so the daemon never becomes an arbitrary
// local-file reader.

import { type Dirent, readFileSync, type Stats } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { EXCERPT_RADIUS, hasKnownFileExtension } from "@/config/constants.ts";
import type { FileExcerpt, FileRefKind } from "@/lib/types.ts";

// EXCERPT_RADIUS lives in @/config/constants.ts because the browser reads it too
// — this module imports node:fs, so the UI cannot.
/** Lines shown from the top when a reference carries no line number. */
export const EXCERPT_HEAD_LINES = 60;
/**
 * Files larger than this are not previewed (skip, don't read).
 *
 * Memory sets the number, not read or render cost: the daemon serves bounded
 * line ranges off one memoized read (`readLines` below) and the client mounts
 * only the rows near the viewport (EXC-970). Measured on ~48-byte source lines,
 * the memo retains ~1.9x the file's bytes and a reader who scrolls a whole file
 * accumulates ~6x it in the browser — ~58 MiB in the tab at this ceiling, where
 * 20 MiB would be ~120 MiB for the same gesture.
 *
 * A single very long line is the one cost a ceiling counted in file bytes cannot
 * see — quadratic in the line's length, guarded separately by
 * `MAX_HIGHLIGHT_LINE_CHARS` in `ui/src/lib/diffview/highlight.ts`.
 */
export const MAX_EXCERPT_BYTES = 10 * 1024 * 1024;
/** Upper bound on directory entries the basename fallback will scan. */
const MAX_SCAN_ENTRIES = 5000;

/** Heavy or irrelevant subtrees the basename search never descends into, and
 * that the directory listing marks as not-expandable rows
 * (`@/plan/directory.ts`). One set so the walk's refusal and the listing's
 * marker can't drift apart. */
export const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage", "out"]);

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

/** `path`'s canonical form, or null when it can't be resolved. */
export function safeRealpath(path: string): Promise<string | null> {
  return realpath(path).catch(() => null);
}

/** A resolved reference: the canonical path on disk, and what it turned out to be. */
export interface ResolvedRef {
  path: string;
  kind: FileRefKind;
}

function safeStat(path: string): Promise<Stats | null> {
  return stat(path).catch(() => null);
}

// What `abs` is when it is a real file or directory inside `cwdReal`, else null.
// realpath runs first, so a symlink whose target escapes cwd is rejected here
// rather than followed out of the tree.
async function contained(cwdReal: string, abs: string): Promise<ResolvedRef | null> {
  const real = await safeRealpath(abs);
  if (real === null) return null;
  if (real !== cwdReal && !real.startsWith(cwdReal + sep)) return null;
  const stats = await safeStat(real);
  if (stats === null) return null;
  if (stats.isFile()) return { path: real, kind: "file" };
  return stats.isDirectory() ? { path: real, kind: "directory" } : null;
}

// Breadth-first search for a file named `name` under cwdReal: the shallowest
// match wins. Bounded by MAX_SCAN_ENTRIES and blind to symlinked directories
// (withFileTypes reports the link, not its target), so it can neither loop nor
// escape the tree.
async function basenameSearch(cwdReal: string, name: string): Promise<string | null> {
  let scanned = 0;
  const queue: string[] = [cwdReal];
  while (queue.length > 0) {
    const currentDir = queue.shift() as string;
    let entries: Dirent[];
    try {
      entries = await readdir(currentDir, { withFileTypes: true });
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
 * Resolves a plan's path reference to its canonical absolute path and kind,
 * confined to `cwd`. Tries `cwd`-relative resolution first; on a miss, a bare
 * file-shaped name falls back to a bounded basename search under `cwd`. Returns
 * null when `cwd` is not an absolute path, when nothing matches, or when the
 * target escapes `cwd`.
 *
 * Each call realpaths `cwd` itself, so a route resolving a whole plan's
 * candidates pays that walk per candidate rather than once per batch — warm and
 * cached, and not worth a second batch-shaped entry point beside this one.
 */
export async function resolveInCwd(cwd: string, candidate: string): Promise<ResolvedRef | null> {
  if (cwd === "" || !isAbsolute(cwd)) return null;
  const cwdReal = await safeRealpath(cwd);
  if (cwdReal === null) return null;

  const cleaned = candidate.trim();
  if (cleaned === "") return null;

  const direct = await contained(cwdReal, resolve(cwdReal, cleaned));
  if (direct !== null) return direct;

  // The fallback walks the tree, so it is spent only on a bare name that reads
  // like a file. A directory hint already said where to look and missed — guessing
  // past it would land the reference on a same-named file elsewhere — and an
  // extensionless token would fire the walk on every `--flag` and `someVariable` a
  // plan mentions (EXC-916).
  if (cleaned.includes("/") || !hasKnownFileExtension(cleaned)) return null;
  const found = await basenameSearch(cwdReal, cleaned);
  return found === null ? null : { path: found, kind: "file" };
}

/**
 * True when `candidate` resolves to a real file inside `cwd` that exceeds
 * `MAX_EXCERPT_BYTES` — the one case `readFileExcerpt`'s null hides that the UI
 * shows differently. Call it on the error path only: it repeats the resolve,
 * bounded basename search included. Never throws.
 */
export async function isFileTooLargeToPreview(cwd: string, candidate: string): Promise<boolean> {
  const hit = await resolveInCwd(cwd, candidate);
  if (hit === null || hit.kind !== "file") return false;
  const stats = await safeStat(hit.path);
  return stats !== null && stats.size > MAX_EXCERPT_BYTES;
}

// The one file the preview is currently walking, already split. A preview grows
// one file a chunk at a time (EXC-969), so one entry turns a scroll from a
// whole-file read-and-split *per chunk* into one for the file.
let memo: { path: string; identity: string; lines: string[] | null } | null = null;

// Size and mtime are the usual pair; the inode catches an atomic replace
// (write-temp-then-rename) that lands on the same size and timestamp.
function statIdentity(stats: Stats): string {
  return `${stats.size}:${stats.mtimeMs}:${stats.ino}`;
}

// Drops the phantom empty element a trailing newline leaves, so the count
// matches the editor's — but keeps a genuinely empty file as one line.
function splitLines(content: string): string[] {
  const lines = content.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * The lines of the file at canonical path `abs`, or null when it can't be read
 * or holds binary content — memoized against `stats`.
 *
 * `abs` must be a path `resolveInCwd` just returned: containment is re-decided
 * from `cwd` on every request before this is reached, so the memo can never
 * grant a path the check would have refused. An entry is used only while the
 * file's stat identity still matches, so an edit on disk re-reads.
 */
function readLines(abs: string, stats: Stats): string[] | null {
  const identity = statIdentity(stats);
  if (memo !== null && memo.path === abs && memo.identity === identity) return memo.lines;
  let content: string;
  try {
    content = readFileSync(abs, "utf-8");
  } catch {
    return null;
  }
  const lines = content.includes("\0") ? null : splitLines(content); // null = binary
  memo = { path: abs, identity, lines };
  return lines;
}

/**
 * Resolves `candidate` within `cwd` and returns an excerpt: the 1-based
 * inclusive `range` when given, else a ±window around `line`, else the head of
 * the file. A range is clamped to the file and never inverted, so it always
 * yields at least one line. Returns null when the reference doesn't resolve, the
 * file is too large, or its content is binary. Never throws.
 */
export async function readFileExcerpt(
  cwd: string,
  candidate: string,
  line?: number,
  range?: { start: number; end: number },
): Promise<FileExcerpt | null> {
  const hit = await resolveInCwd(cwd, candidate);
  if (hit === null || hit.kind !== "file") return null;
  const abs = hit.path;

  const stats = await safeStat(abs);
  if (stats === null || stats.size > MAX_EXCERPT_BYTES) return null;

  const allLines = readLines(abs, stats);
  if (allLines === null) return null; // unreadable, or binary
  const totalLines = allLines.length;

  let startLine: number;
  let endLine: number;
  if (range !== undefined) {
    startLine = Math.min(Math.max(1, range.start), totalLines);
    endLine = Math.min(totalLines, Math.max(range.end, startLine));
  } else if (line !== undefined && line >= 1) {
    // A plan can cite a line past a file that has since shrunk; unclamped, that
    // gives startLine > endLine and so no lines at all.
    const target = Math.min(line, totalLines);
    startLine = Math.max(1, target - EXCERPT_RADIUS);
    endLine = Math.min(totalLines, target + EXCERPT_RADIUS);
  } else {
    startLine = 1;
    endLine = Math.min(totalLines, EXCERPT_HEAD_LINES);
  }

  const cwdReal = (await safeRealpath(cwd)) ?? cwd;
  return {
    path: relative(cwdReal, abs),
    language: languageForPath(abs),
    startLine,
    endLine,
    lines: allLines.slice(startLine - 1, endLine),
    totalLines,
  };
}

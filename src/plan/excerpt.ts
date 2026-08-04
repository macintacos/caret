// Resolves a plan's filename reference to a real file inside the review's cwd
// and reads a line-aware excerpt for the preview card (EXC-687). The browser
// can't touch the filesystem, so the daemon does both — keyed off the review
// record's cwd, never a client-supplied base. Resolution is confined to cwd: a
// `../` or symlink target that escapes it resolves to null, so the daemon never
// becomes an arbitrary local-file reader. A reference that resolves to no real
// file yields null, and the UI then shows no icon and no affordance.

import {
  type Dirent,
  readdirSync,
  readFileSync,
  realpathSync,
  type Stats,
  statSync,
} from "node:fs";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { EXCERPT_RADIUS } from "@/config/constants.ts";
import type { FileExcerpt } from "@/lib/types.ts";

// The opening window is sized to show enough of the file to judge a plan against
// it without leaving the review; the card scrolls internally past that, and its
// boundary strips expand the window through an explicit range until the reader
// reaches line 1 and the last line. Only MAX_EXCERPT_BYTES bounds how wide a
// window can get. EXCERPT_RADIUS lives in @/config/constants.ts because the
// browser reads it too — this module imports node:fs, so the UI cannot.
/** Lines shown from the top when a reference carries no line number. */
export const EXCERPT_HEAD_LINES = 60;
/**
 * Files larger than this are not previewed (skip, don't read).
 *
 * The old 2 MiB ceiling defended against reading and rendering a whole file at
 * once. Neither happens any more: the daemon serves bounded line ranges off one
 * memoized read (`readLines` below), and the client mounts only the rows near
 * the viewport (EXC-970). What is left is memory, and memory is what sets this
 * number.
 *
 * Measured on ~48-byte source lines: the memo retains ~1.9x the file's bytes
 * here, and a reader who scrolls a whole file accumulates ~6x it in the browser
 * — the raw lines kept for a theme repaint plus shiki's token HTML, which runs
 * ~7.7x the text it colours. At 10 MiB that is ~19 MiB held by the daemon for
 * the one file it has cached, and ~58 MiB in the tab for a reader who went end
 * to end (measured: 57.6 MiB). Both are bounded and both are survivable; 20 MiB
 * would put the tab at ~120 MiB for the same gesture, which is where it stops
 * being a preview and starts being a leak.
 *
 * Highlighting does not enter into it: it is paid per chunk (~127 ms for a
 * ~148-line chunk), so it does not grow with this number. The one cost that
 * does explode is a single very long line — quadratic in the line's length, and
 * invisible to a ceiling counted in file bytes. `MAX_HIGHLIGHT_LINE_CHARS` in
 * `ui/src/lib/diffview/highlight.ts` guards that separately.
 */
export const MAX_EXCERPT_BYTES = 10 * 1024 * 1024;
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

function safeStat(path: string): Stats | null {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

/**
 * True when `candidate` resolves to a real file inside `cwd` that exceeds
 * `MAX_EXCERPT_BYTES` — the one case `readFileExcerpt`'s null hides that the UI
 * shows differently. Answered on the error path only, so the common path pays
 * nothing for the extra resolve; on that path a reference that resolves to
 * nothing re-runs `resolveFileInCwd`'s bounded basename search, which is why
 * this is not called before `readFileExcerpt`. Never throws.
 */
export function isFileTooLargeToPreview(cwd: string, candidate: string): boolean {
  const abs = resolveFileInCwd(cwd, candidate);
  if (abs === null) return false;
  const stats = safeStat(abs);
  return stats !== null && stats.size > MAX_EXCERPT_BYTES;
}

// The one file the preview is currently walking, already split. A preview shows
// one file at a time and grows it a chunk at a time (EXC-969), so successive
// requests are overwhelmingly the same file: one entry turns a scroll from one
// whole-file read-and-split *per chunk* into one for the file. A miss costs
// exactly what every request used to, so switching files degrades to the old
// behaviour rather than to something worse.
let memo: { path: string; identity: string; lines: string[] | null } | null = null;

// What a cache hit has to mean: the same bytes on disk. Size and mtime are the
// usual pair; the inode is what catches an atomic replace (write-temp-then-
// rename) that happens to land on the same size and timestamp.
function statIdentity(stats: Stats): string {
  return `${stats.size}:${stats.mtimeMs}:${stats.ino}`;
}

// Split on newlines, dropping the phantom empty element a trailing newline
// leaves so the count matches the editor's — but keeping a genuinely empty file
// as one line.
function splitLines(content: string): string[] {
  const lines = content.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * The lines of the file at canonical path `abs`, or null when it can't be read
 * or holds binary content — memoized against `stats`.
 *
 * `abs` must be a path `resolveFileInCwd` just returned. That is what keeps the
 * memo out of the security boundary: containment is re-decided from `cwd` on
 * every request before this is reached, so an entry is only ever *reachable*
 * through a reference that passed the check on that same request — the cache
 * can neither grant a path it would have refused nor outlive the check. And an
 * entry is only *used* when the file's stat identity still matches, so an edit
 * on disk re-reads rather than serving a stale copy.
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
export function readFileExcerpt(
  cwd: string,
  candidate: string,
  line?: number,
  range?: { start: number; end: number },
): FileExcerpt | null {
  const abs = resolveFileInCwd(cwd, candidate);
  if (abs === null) return null;

  const stats = safeStat(abs);
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
    // Clamp a past-EOF line to the last line, so a plan citing a line past a file
    // that has since shrunk still yields a non-empty, correctly-labeled window
    // (an unclamped line beyond EOF would give startLine > endLine → no lines).
    const target = Math.min(line, totalLines);
    startLine = Math.max(1, target - EXCERPT_RADIUS);
    endLine = Math.min(totalLines, target + EXCERPT_RADIUS);
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

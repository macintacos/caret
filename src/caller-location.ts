// Repo-relative `path:line` of a log call site, for the record's `caller`
// field (EXC-451) — e.g. `src/daemon.ts:295`. Split out from the emit path so
// the V8-stack parsing and PKG_ROOT/sourcemap normalization can be pinned by
// focused boundary tests independently of the loggers.
//
// Parses the stack STRING rather than the V8 CallSite API because Bun remaps
// the string through sourcemaps, which is what the compiled binary needs.
// Best-effort and never throws: every miss yields undefined, so the field is
// simply omitted.

import { dirname } from "node:path";

// Package root, computed once: this module lives in <root>/src, so the root is
// the parent of its dir. parseCaller() strips a leading "<root>/" off captured
// frames to yield repo-relative paths (src/cli.ts, test/log.test.ts) — see
// EXC-451. import.meta.dir is the directory of THIS file, resolved through Bun's
// sourcemap remap so the compiled binary agrees.
export const PKG_ROOT = dirname(import.meta.dir);

// A Bun stack frame, either named or anonymous (verified shapes):
//   `    at fnName (/abs/path.ts:12:34)`  and  `    at /abs/path.ts:12:34`
// Capture the file path (up to the line:col suffix) and the line number; the
// column is matched but discarded. A leading `file://` is allowed and stripped.
export const FRAME = /^\s*at (?:.* \()?(?:file:\/\/)?(.+):(\d+):\d+\)?$/;

// The logging machinery's own modules: their frames sit between `new Error()`
// and the real caller, so the walk skips them by path suffix (depth varies by
// entry path, so suffix-match beats a fixed skip count).
const INTERNAL_SUFFIXES = ["src/caller-location.ts", "src/log.ts"];

/** Walk `stack`'s frames (a `new Error().stack` string), skipping the Error
 * header and the logging machinery's own frames, and return the first external
 * frame as a repo-relative `path:line` against `pkgRoot`. Returns undefined on
 * any parse miss so the `caller` field is omitted. Pure (stack + pkgRoot in,
 * string out) so the normalization branches are unit-testable with synthetic
 * stacks. */
export function parseCaller(stack: string | undefined, pkgRoot = PKG_ROOT): string | undefined {
  if (!stack) return undefined;
  for (const line of stack.split("\n")) {
    const m = FRAME.exec(line);
    if (!m?.[1] || !m[2]) continue; // no frame match (e.g. the `Error` header line)
    const path = m[1];
    if (INTERNAL_SUFFIXES.some((s) => path.endsWith(s))) continue; // our own wrapper frames
    // Runtime-internal frames — pathless (`native:7:39`, `[eval]:1:30`) or
    // node:-scheme (`node:internal/...`) — are never the caller.
    if (!path.includes("/") || path.startsWith("node:")) continue;
    // Normalize: a relative path is already repo-relative (the compiled
    // binary's sourcemapped frames come out that way); an absolute one under
    // the package root loses that prefix; any other absolute path falls back
    // to its last two segments so the field stays compact.
    const rel = !path.startsWith("/")
      ? path
      : path.startsWith(`${pkgRoot}/`)
        ? path.slice(pkgRoot.length + 1)
        : path.split("/").slice(-2).join("/");
    return `${rel}:${m[2]}`;
  }
  return undefined;
}

/** Repo-relative `path:line` of the call site that invoked a log method
 * (EXC-451). Captures the live stack and delegates to parseCaller; returns
 * undefined — never throws — on any parse miss. */
export function callerLocation(): string | undefined {
  try {
    return parseCaller(new Error().stack);
  } catch {
    return undefined; // parsing must never destabilize a log emit
  }
}

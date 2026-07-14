// The file-write side of caret's OpenCode install: substitute the command files'
// install-time marker and deploy / uninstall them in OpenCode's command dir. caret
// itself installs as a `plugin` array entry (@macintacos/caret; the array edit lives
// in config-plugin.ts) — OpenCode installs the package + its deps — but the
// `/caret:*` command files aren't array-installable, so they still ship as files.
// Idempotent (re-deploy overwrites in place) and dry-run aware. Pure of any path
// resolution (callers pass absolute paths via paths.ts) so it is unit-testable
// against a temp dir.

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Substitute a command file's install-time marker (`__CARET_BIN__`, e.g. in
 * discovery.md) with the running caret binary's path (and `__CARET_VERSION__` when
 * present). Pure. The replacements use a function replacer so the substituted value
 * is taken LITERALLY: a binary path containing `$&` / `$$` / `$\`` (legal in a
 * filesystem path) must not be reinterpreted as a `String.replace` pattern. */
export function renderPlugin(source: string, opts: { version: string; binPath: string }): string {
  return source
    .replaceAll("__CARET_VERSION__", () => opts.version)
    .replaceAll("__CARET_BIN__", () => opts.binPath);
}

export interface DeployFile {
  /** Absolute path to write. */
  path: string;
  /** File contents. */
  contents: string;
}

export interface DeployResult {
  /** The paths written (or, in dry-run, that would be written / removed). */
  paths: string[];
  dryRun: boolean;
}

/** Write each file, creating parent dirs. Overwrite-in-place makes re-runs
 * idempotent. In dry-run, touches nothing and just collects the paths. */
export function deployFiles(files: DeployFile[], opts: { dryRun: boolean }): DeployResult {
  const paths: string[] = [];
  for (const f of files) {
    if (!opts.dryRun) {
      mkdirSync(dirname(f.path), { recursive: true });
      writeFileSync(f.path, f.contents);
    }
    paths.push(f.path);
  }
  return { paths, dryRun: opts.dryRun };
}

/** Remove each path that is actually present, and report only those — so an
 * uninstall on a machine that never installed caret reports "removed 0", not a
 * confident list of files that were never there. In dry-run, removes nothing but
 * still reports only the paths that exist (an honest preview). A missing path is
 * skipped silently. */
export function removeFiles(targets: string[], opts: { dryRun: boolean }): DeployResult {
  const paths: string[] = [];
  for (const p of targets) {
    if (!existsSync(p)) continue;
    if (!opts.dryRun) rmSync(p, { force: true });
    paths.push(p);
  }
  return { paths, dryRun: opts.dryRun };
}

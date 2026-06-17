// The WRITE side of caret's OpenCode install: render the plugin (substitute its
// install-time markers) and deploy / uninstall caret's files in OpenCode's config
// dir. caret installs as auto-loaded FILES (a plugin file + command files) and
// NEVER mutates the user's `plugin` config array — an existing array of
// third-party plugins is untouched. Idempotent (re-deploy overwrites in place) and
// dry-run aware. Pure of any path resolution (callers pass absolute paths via
// paths.ts) so it is unit-testable against a temp dir.

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Substitute a deployed template's install-time markers (`__CARET_VERSION__`,
 * `__CARET_BIN__`) with the resolved caret version and the caret binary path —
 * applied to the plugin source and to the command files. Pure. The replacements
 * use a function replacer so the substituted value is taken LITERALLY: a binary
 * path or version containing `$&` / `$$` / `$\`` (legal in a filesystem path)
 * must not be reinterpreted as a `String.replace` substitution pattern. */
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

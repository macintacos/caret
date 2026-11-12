// The file-write side of caret's OpenCode install: substitute the deployed files'
// install-time markers and deploy / uninstall them under OpenCode's config dir. caret
// itself installs as a plugin entry (@macintacos/caret, in `plugins` when every
// `opencode` on PATH is v2, else `plugin`; the edit lives in config-plugin.ts) — OpenCode
// installs the package + its deps — but the `/caret` command file and the references it
// loads aren't array-installable, so they still ship as files. Idempotent (re-deploy
// overwrites in place) and dry-run aware. Pure of any path resolution (callers pass absolute paths via
// paths.ts) so it is unit-testable against a temp dir.

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Substitute a deployed file's install-time markers — `__CARET_BIN__` → `binPath`,
 * `__CARET_DEMO_TEMPLATE__` → `demoTemplate`, `__CARET_VERSION__` → `version`,
 * `__CARET_REFERENCES__` → `referencesDir`. Pure. Each value is taken LITERALLY (a
 * function replacer): a path or template may contain `$&` / `$$` / `$\``, which
 * `String.replace` would otherwise reinterpret. */
export function renderPlugin(
  source: string,
  opts: { version: string; binPath: string; demoTemplate: string; referencesDir: string },
): string {
  return source
    .replaceAll("__CARET_VERSION__", () => opts.version)
    .replaceAll("__CARET_BIN__", () => opts.binPath)
    .replaceAll("__CARET_DEMO_TEMPLATE__", () => opts.demoTemplate)
    .replaceAll("__CARET_REFERENCES__", () => opts.referencesDir);
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

// The writer behind the stable launcher path. A launchd plist or systemd unit must name
// one absolute executable that never moves, so caret owns a copy of bin/caret-launcher at
// $XDG_STATE_HOME/caret/bin/caret and leaves the version resolution to it, at exec time
// (EXC-1160). The install's service step is the caller: the launcher lands before the unit
// that names it, and goes with it on `--uninstall`.

import { chmodSync, copyFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { resolveCaretRoot } from "@/adapters/opencode/packaging.ts";
import {
  ensureStateDir,
  launcherBunFile,
  launcherPath,
  launcherRecordDir,
  launcherServiceFile,
} from "@/config/paths.ts";
import { buildKind } from "@/lib/build-id.ts";

/** What to record, plus the injection seams for tests: the `bun` to record and the
 * shipped script to copy, so the whole function runs against a temp state dir without a
 * resolvable caret root. `source` is a thunk because resolveCaretRoot() throws, which a
 * default argument would raise from inside this call rather than where the root actually
 * could not be found. */
export interface LauncherDeps {
  /** The unit this install registered, which the launcher stops on a terminal failure
   * and deletes on eviction. Absent when no supervisor was installed — the launcher
   * treats a missing record as "nothing here to tear down". */
  serviceLabel?: string;
  bunPath?: string;
  source?: () => string;
}

/** Install the shipped launcher to the path a service unit names, recording the `bun` it
 * should prefer over the ones it searches for. */
export function installLauncher(deps: LauncherDeps = {}): void {
  const source = (deps.source ?? (() => join(resolveCaretRoot(), "bin", "caret-launcher")))();

  ensureStateDir(dirname(launcherPath()));
  // Land atomically: a service unit names launcherPath() forever, and bash reads a script
  // lazily from its open fd — so an in-place rewrite can feed a running launcher the tail
  // of a different file, and a hard kill mid-copy leaves a truncated executable there.
  const tmp = `${launcherPath()}.${process.pid}.tmp`;
  copyFileSync(source, tmp);
  chmodSync(tmp, 0o755);
  renameSync(tmp, launcherPath());

  // Under a compiled binary execPath is caret itself, not bun, so there is nothing worth
  // recording and the launcher is left to its own search.
  const bunPath = deps.bunPath ?? (buildKind() === "binary" ? undefined : process.execPath);
  if (bunPath === undefined && deps.serviceLabel === undefined) return;

  ensureStateDir(launcherRecordDir());
  if (bunPath !== undefined) writeRecord(launcherBunFile(), bunPath);
  if (deps.serviceLabel !== undefined) writeRecord(launcherServiceFile(), deps.serviceLabel);
}

/** The launcher's `read -r` reports EOF on a file with no trailing newline, and that read
 * is what decides the record exists at all. */
function writeRecord(path: string, value: string): void {
  writeFileSync(path, `${value}\n`, { mode: 0o600 });
}

/** Remove the launcher and everything it reads, the half of `--uninstall` that takes the
 * launcher out with the plugin. Mirrors evict() in bin/caret-launcher, which deletes the
 * same two directories and leaves prefs and review state for a reinstall. */
export function uninstallLauncher(): void {
  rmSync(dirname(launcherPath()), { recursive: true, force: true });
  rmSync(launcherRecordDir(), { recursive: true, force: true });
}

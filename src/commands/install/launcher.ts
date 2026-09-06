// The writer behind the stable launcher path. A launchd plist or systemd unit must name
// one absolute executable that never moves, so caret owns a copy of bin/caret-launcher at
// $XDG_STATE_HOME/caret/bin/caret and leaves the version resolution to it, at exec time
// (EXC-1160). `caret install` wires this in under EXC-1167 — which is what decides whether
// a machine is resident at all; today the only caller is the test.

import { chmodSync, copyFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { resolveCaretRoot } from "@/adapters/opencode/packaging.ts";
import {
  ensureStateDir,
  launcherBunFile,
  launcherPath,
  launcherRecordDir,
} from "@/config/paths.ts";
import { buildKind } from "@/lib/build-id.ts";

/** Injection seam for tests: the `bun` to record and the shipped script to copy, so the
 * whole function runs against a temp state dir without a resolvable caret root. `source`
 * is a thunk because resolveCaretRoot() throws, which a default argument would raise from
 * inside this call rather than where the root actually could not be found. */
export interface LauncherDeps {
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
  if (bunPath === undefined) return;

  ensureStateDir(launcherRecordDir());
  // The launcher's `read -r` reports EOF on a file with no trailing newline, and that read
  // is what decides the record exists at all.
  writeFileSync(launcherBunFile(), `${bunPath}\n`, { mode: 0o600 });
}

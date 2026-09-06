// The writer behind the stable launcher path. A launchd plist or systemd unit must name
// one absolute executable that never moves, so caret owns a copy of bin/caret-launcher at
// $XDG_STATE_HOME/caret/bin/caret and leaves the version resolution to it, at exec time
// (EXC-1160).

import { chmodSync, copyFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { resolveCaretRoot } from "@/adapters/opencode/packaging.ts";
import {
  ensureStateDir,
  launcherBunFile,
  launcherPath,
  launcherRecordDir,
} from "@/config/paths.ts";

/** Install the shipped launcher to the path a service unit names, recording the `bun` it
 * should prefer over the ones it searches for. */
export function installLauncher(
  bunPath: string = process.execPath,
  source: string = join(resolveCaretRoot(), "bin", "caret-launcher"),
): void {
  ensureStateDir(dirname(launcherPath()));
  copyFileSync(source, launcherPath());
  chmodSync(launcherPath(), 0o755);
  ensureStateDir(launcherRecordDir());
  // The launcher's `read -r` yields nothing from a file with no trailing newline.
  writeFileSync(launcherBunFile(), `${bunPath}\n`);
}

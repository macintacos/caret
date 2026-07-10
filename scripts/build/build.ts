// `build` umbrella task: build the UI then the binary. build-bin depends on
// build-ui (the `#MISE depends=["build-bin"]` on the forwarder chains both), so
// by the time this subcommand runs the compile is already done — its own body is
// just the completion line plus the optional --install step.

import { runForward } from "../tasks/exec.ts";

export interface BuildOptions {
  /** After building, install the local checkout + cycle the daemon (dev only). */
  install: boolean;
}

/** The install command `build --install` runs (EXC-555): delegate to
 * install.sh's --from-local mode, which reuses these artifacts (no rebuild),
 * reinstalls the plugin, and cycles the daemon to this build. Null when
 * --install was not passed, so a plain `build` never touches install.sh. */
export function buildInstallCommand(opts: BuildOptions): string[] | null {
  return opts.install ? ["scripts/install.sh", "--from-local"] : null;
}

export async function runBuild(opts: BuildOptions): Promise<never> {
  console.log("caret build complete: bin/caret-native (run via the bin/caret shim)");
  const install = buildInstallCommand(opts);
  if (install === null) process.exit(0);
  process.exit(await runForward(install));
}

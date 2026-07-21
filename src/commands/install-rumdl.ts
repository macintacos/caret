// `caret install-rumdl` (EXC-828): eagerly download rumdl (the plan formatter)
// into caret's state dir, so install.sh users don't pay the first-plan download
// latency. A thin idempotent wrapper over ensureRumdl() — the same acquisition the
// daemon runs lazily on the first plan format. Best-effort by design: install.sh
// invokes it non-fatally, and if it's ever skipped the runtime path still installs
// rumdl on the first plan. The report distinguishes a fresh download from a cached
// one so the install output (and the idempotency check) reads cleanly.

import { existsSync } from "node:fs";

import { rumdlBin } from "@/config/paths.ts";
import { ensureRumdl } from "@/plan/rumdl.ts";

/** Injection seams for tests: stub acquisition, the cache check, and the writer so
 * the command runs offline without touching the real state dir. */
export interface InstallRumdlDeps {
  ensure?: () => Promise<{ bin: string; config: string }>;
  isPresent?: (bin: string) => boolean;
  write?: (s: string) => void;
}

export async function runInstallRumdlSubcommand(deps: InstallRumdlDeps = {}): Promise<void> {
  const ensure = deps.ensure ?? ensureRumdl;
  const isPresent = deps.isPresent ?? existsSync;
  const write = deps.write ?? ((s: string) => void process.stdout.write(s));

  // Sample the cache before ensure() may download, so the verb reflects what this
  // run actually did.
  const cached = isPresent(rumdlBin());
  const { bin } = await ensure();
  write(`caret: rumdl ${cached ? "already present" : "installed"} at ${bin}.\n`);
}

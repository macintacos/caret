// `caret install-rumdl` (EXC-828): eagerly download rumdl (the plan formatter)
// into caret's state dir, so install.sh users don't pay the first-plan download
// latency. A thin idempotent wrapper over ensureRumdl() — the same acquisition the
// daemon runs lazily on the first plan format. Best-effort by design: install.sh
// invokes it non-fatally, and if it's ever skipped the runtime path still installs
// rumdl on the first plan. The report distinguishes a fresh download from a cached
// one so the install output (and the idempotency check) reads cleanly.

import { ensureRumdl } from "@/plan/rumdl.ts";

/** Injection seams for tests: stub acquisition and the writer so the command runs
 * offline without touching the real state dir. */
export interface InstallRumdlDeps {
  ensure?: () => Promise<{ bin: string; config: string; installed: boolean }>;
  write?: (s: string) => void;
}

export async function runInstallRumdlSubcommand(deps: InstallRumdlDeps = {}): Promise<void> {
  const ensure = deps.ensure ?? ensureRumdl;
  const write = deps.write ?? ((s: string) => void process.stdout.write(s));

  // `installed` is ensureRumdl's own signal for "this call downloaded it" — honest
  // whether the binary was freshly fetched, already cached, or a CARET_RUMDL_BIN
  // override (no guessing at the cache path the override never populates).
  const { bin, installed } = await ensure();
  write(`caret: rumdl ${installed ? "installed" : "already present"} at ${bin}.\n`);
}

// `setup` task: one-shot local bootstrap. `mise install` installs every tool in
// mise.toml (its postinstall hook then runs `hk install --mise` to register the
// git hooks); `bun install` fetches the JS deps; the palette generator emits the
// gitignored partial app.css @imports, so the raw `bun test --conditions browser`
// CONTRIBUTING.md documents works on a fresh clone; and `playwright install
// chromium` fetches the Chromium binary the e2e suite drives. Steps run in
// order and the first failure aborts (matching the former task's `set -e`).

import { paletteCssCommand } from "@/tasks/build.ts";
import { runForward } from "@/tasks/lib/exec.ts";

/**
 * The commands `setup` runs, in order. `scripts/bootstrap.sh` sets
 * CARET_BOOTSTRAPPED only after its cold path has run the `preamble` set below
 * and every step succeeded, so a set marker means those are already done. Unset
 * means nothing vouches for them — the warm path, where the bootstrap no-ops, or
 * any invocation outside a mise forwarder — and the full list runs.
 */
export function setupCommands(env: Record<string, string | undefined>): string[][] {
  // What scripts/bootstrap.sh re-implements in bash. A new step the tasks CLI
  // needs in order to *load* belongs here and there, or a fresh clone can't run.
  const preamble = [["mise", "install"], ["bun", "install"], paletteCssCommand()];
  // What `setup` owns whatever the preamble did. Chromium is here because the
  // bootstrap deliberately never downloads a browser; new steps go here too.
  const own = [["bunx", "playwright", "install", "chromium"]];
  return env.CARET_BOOTSTRAPPED ? own : [...preamble, ...own];
}

export async function runSetup(): Promise<never> {
  for (const cmd of setupCommands(process.env)) {
    const code = await runForward(cmd);
    if (code !== 0) process.exit(code);
  }
  process.exit(0);
}

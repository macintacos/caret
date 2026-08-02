// `setup` task: one-shot local bootstrap. `mise install` installs every tool in
// mise.toml (its postinstall hook then runs `hk install --mise` to register the
// git hooks); `bun install` fetches the JS deps; the palette generator emits the
// gitignored partial app.css @imports, so the raw `bun test --conditions browser`
// CONTRIBUTING.md documents works on a fresh clone; and `playwright install
// chromium` fetches the Chromium binary the e2e suite drives. Steps run in
// order and the first failure aborts (matching the former task's `set -e`).
//
// On a cold checkout scripts/bootstrap.sh has already run the first three to get
// this file loadable at all, so it exports CARET_BOOTSTRAPPED and `setup` runs
// only the Chromium step — the one the bootstrap deliberately never downloads.

import { paletteCssCommand } from "@/tasks/build.ts";
import { runForward } from "@/tasks/lib/exec.ts";

/**
 * The commands `setup` runs, in order.
 *
 * `CARET_BOOTSTRAPPED` answers "did the bootstrap preamble just install these?".
 * When it is set, only the e2e Chromium is left — `scripts/bootstrap.sh` excludes
 * that download, so it is the one step both shapes always run. Unset (the warm
 * path, where the bootstrap no-ops) gives the full four-step refresh.
 *
 * `scripts/bootstrap.sh` re-implements the first three in bash for its cold path
 * — a new step the tasks CLI needs in order to *load* has to be added there too,
 * or a fresh clone still can't run.
 */
export function setupCommands(env: Record<string, string | undefined>): string[][] {
  const chromium = ["bunx", "playwright", "install", "chromium"];
  if (env.CARET_BOOTSTRAPPED) return [chromium];
  return [["mise", "install"], ["bun", "install"], paletteCssCommand(), chromium];
}

export async function runSetup(): Promise<never> {
  for (const cmd of setupCommands(process.env)) {
    const code = await runForward(cmd);
    if (code !== 0) process.exit(code);
  }
  process.exit(0);
}

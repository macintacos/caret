// `setup` task: one-shot local bootstrap. `mise install` installs every tool in
// mise.toml (its postinstall hook then runs `hk install --mise` to register the
// git hooks); `bun install` fetches the JS deps; the palette generator emits the
// gitignored partial app.css @imports, so the raw `bun test --conditions browser`
// CONTRIBUTING.md documents works on a fresh clone; and `playwright install
// chromium` fetches the Chromium binary the e2e suite drives. Steps run in
// order and the first failure aborts (matching the former task's `set -e`).

import { paletteCssCommand } from "@/tasks/build.ts";
import { runForward } from "@/tasks/lib/exec.ts";

/** The commands `setup` runs, in order. */
export function setupCommands(): string[][] {
  return [
    ["mise", "install"],
    ["bun", "install"],
    paletteCssCommand(),
    ["bunx", "playwright", "install", "chromium"],
  ];
}

export async function runSetup(): Promise<never> {
  for (const cmd of setupCommands()) {
    const code = await runForward(cmd);
    if (code !== 0) process.exit(code);
  }
  process.exit(0);
}

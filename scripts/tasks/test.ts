// `test` task: the bun unit-test suite. `--conditions browser` selects svelte's
// client runtime entry so the UI component suite can mount components under
// happy-dom (see bunfig.toml and ui/test-svelte-preload.ts); the backend suite
// passes unchanged under it. Extra args (a path, --test-name-pattern, …) are
// forwarded to `bun test`.

import { execAndExit } from "./lib/exec.ts";

/** The argv `test` runs, plus forwarded args. */
export function testCommand(args: string[]): string[] {
  return ["bun", "test", "--conditions", "browser", ...args];
}

export async function runTest(args: string[]): Promise<never> {
  return execAndExit(testCommand(args));
}

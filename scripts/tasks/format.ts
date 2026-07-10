// `format` task: format + autofix the whole tree (hk fix). `--no-stage` leaves
// the resulting working-tree changes unstaged. Extra args (e.g. specific paths)
// are forwarded to `hk fix`.

import { execAndExit } from "./lib/exec.ts";

/** The argv `format` runs, plus forwarded args. */
export function formatCommand(args: string[]): string[] {
  return ["hk", "fix", "--all", "--no-stage", ...args];
}

export async function runFormat(args: string[]): Promise<never> {
  return execAndExit(formatCommand(args));
}

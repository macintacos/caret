// `lint` task: caret's read-only formatting + lint gate (hk check over the whole
// tree). Extra args (e.g. specific paths) are forwarded to `hk check`.

import { execAndExit } from "@/tasks/lib/exec.ts";

/** The argv `lint` runs, plus forwarded args. */
export function lintCommand(args: string[]): string[] {
  return ["hk", "check", "--all", ...args];
}

export async function runLint(args: string[]): Promise<never> {
  return execAndExit(lintCommand(args));
}

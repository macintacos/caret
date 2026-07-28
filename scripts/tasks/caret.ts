// `caret` task: run caret's own CLI straight from source, so a dev can drive any
// subcommand (install, discovery, review, …) against the working tree. It runs
// src/cli.ts rather than bin/caret because the shim execs the compiled
// bin/caret-native whenever a build produced one, which can lag the checkout —
// this task always reflects what is on disk right now. Every argument is
// forwarded untouched, and stdio is inherited, so a stdin-reading subcommand
// (`mise run caret review < payload.json`) works as it would from a shell.

import { execAndExit } from "@/tasks/lib/exec.ts";

/** The argv `caret` runs, plus forwarded args. */
export function caretCommand(args: string[]): string[] {
  return ["bun", "run", "src/cli.ts", ...args];
}

export async function runCaret(args: string[]): Promise<never> {
  return execAndExit(caretCommand(args));
}

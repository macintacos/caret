// `caret install`'s exit code, end to end. `runInstallSubcommand` reports its outcome as
// a return value and writes no exit code, so the mapping lives in `src/cli.ts`'s action —
// out of reach of the orchestrator suite, and silently droppable. A subprocess is the only
// thing that catches that.

import { expect, test } from "bun:test";

import { runCaretCli } from "@test/support/cli-process.ts";

test("a refused invocation exits 2 rather than reporting a problem and succeeding", async () => {
  // `--from-local --uninstall` is the one refusal reachable without a machine to install
  // into: it is rejected before target selection, so nothing is detected, spawned, or
  // written.
  const { exitCode } = await runCaretCli(["install", "--from-local", "--uninstall"], {
    env: process.env,
  });
  expect(exitCode).toBe(2);
});

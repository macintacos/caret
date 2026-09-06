// Gates the shell test suites under scripts/ through `bun test` (and therefore the
// preflight gate), so a regression in shipped shell can't slip past a green
// preflight. A non-zero exit fails the bun test with the suite's own output
// attached, so the failure is actionable without re-running the script by hand.

import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { drainProcess } from "@test/support/cli-process.ts";

const REPO_ROOT = join(import.meta.dir, "..", "..");

// The shell suites, each self-contained (mktemp fixtures, PATH stubs — no network,
// no real installs). caret-shim covers the bin/caret entrypoint resolver;
// caret-launcher covers the service launcher that resolves caret and bun at exec
// time; bootstrap covers the dep-free preamble a task forwarder sources before bun.
//
// `.bats` is the target form (EXC-1230 converts the two remaining `.sh` suites);
// both run here so the conversion lands one suite at a time.
const SHELL_SUITES = [
  "scripts/caret-shim.test.sh",
  "scripts/caret-launcher.bats",
  "scripts/bootstrap.test.sh",
];

// `mise x` rather than a bare `bats`: mise computes a task's PATH from the tools
// installed when it launched, so on a fresh clone — where scripts/bootstrap.sh has
// just installed bats — that PATH is already stale. Same reasoning bootstrap.sh
// gives for `mise exec -- bun`. --print-output-on-failure adds `$output` to a
// failing case, which bats otherwise captures and discards.
function commandFor(rel: string): string[] {
  const path = join(REPO_ROOT, rel);
  return rel.endsWith(".bats")
    ? ["mise", "x", "--", "bats", "--print-output-on-failure", path]
    : ["bash", path];
}

// Most of these spawn only short-lived bash subprocesses, but caret-launcher sleeps
// through three 10s probe budgets — it tests a real wall-clock window — so its floor is
// ~32s and it is what this ceiling has to clear on a busy machine.
const SUITE_TIMEOUT_MS = 60_000;

async function runSuite(rel: string): Promise<{ exit: number; output: string }> {
  const proc = Bun.spawn(commandFor(rel), {
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
    // Bun.spawn snapshots env at spawn; pass it explicitly and force plain output
    // so the captured logs carry no ANSI escapes.
    env: { ...process.env, NO_COLOR: "1" },
  });
  const { stdout, stderr, exit } = await drainProcess(proc);
  return { exit, output: `${stdout}${stderr}` };
}

describe("scripts/ shell suites", () => {
  for (const rel of SHELL_SUITES) {
    test(
      rel,
      async () => {
        const { exit, output } = await runSuite(rel);
        if (exit !== 0) throw new Error(`${rel} exited ${exit}\n\n${output}`);
        expect(exit).toBe(0);
      },
      SUITE_TIMEOUT_MS,
    );
  }
});

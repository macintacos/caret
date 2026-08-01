// Gates the bash test suites under scripts/ through `bun test` (and therefore the
// preflight gate), so a regression in shipped shell can't slip past a green
// preflight. Each is spawned under `bash`; a non-zero exit fails the bun test with
// the suite's own output attached, so the failure is actionable without re-running
// the script by hand.

import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..");

// The bash suites, each self-contained (mktemp fixtures, PATH stubs — no network,
// no real installs). caret-shim covers the bin/caret entrypoint resolver;
// bootstrap covers the dep-free preamble a task forwarder sources before bun.
const SHELL_SUITES = ["scripts/caret-shim.test.sh", "scripts/bootstrap.test.sh"];

// Each suite spawns several short-lived bash subprocesses of its own; give a
// generous ceiling so a busy machine running the suites concurrently never flakes.
const SUITE_TIMEOUT_MS = 60_000;

async function runSuite(rel: string): Promise<{ exit: number; output: string }> {
  const proc = Bun.spawn(["bash", join(REPO_ROOT, rel)], {
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
    // Bun.spawn snapshots env at spawn; pass it explicitly and force plain output
    // so the captured logs carry no ANSI escapes.
    env: { ...process.env, NO_COLOR: "1" },
  });
  const [stdout, stderr, exit] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exit, output: `${stdout}${stderr}` };
}

describe("scripts/*.test.sh (bash suites)", () => {
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

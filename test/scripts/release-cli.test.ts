// Contract test for the release CLI's stdout discipline (EXC-473). The
// /release-caret skill parses the CLI's stdout as a single JSON object, so
// Commander's help / usage / error output MUST go to stderr, never stdout.
// Application-level errors (e.g. an invalid bump) keep emitting their JSON
// ReleaseError on stdout — that is part of the same contract. We exercise the
// CLI as a subprocess, the way it actually runs during a release.

import { expect, test } from "bun:test";

const CLI = "scripts/release/cli.ts";

/** Run the release CLI as a subprocess; capture exit code, stdout, stderr. */
async function runCli(args: string[]): Promise<{ exit: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([process.execPath, CLI, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exit] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exit, stdout, stderr };
}

test("--help routes help to stderr, leaving stdout empty", async () => {
  const { exit, stdout, stderr } = await runCli(["--help"]);
  expect(exit).toBe(0);
  expect(stdout).toBe("");
  expect(stderr).toContain("Usage:");
});

test("an unknown command leaves stdout empty (usage on stderr)", async () => {
  const { exit, stdout, stderr } = await runCli(["bogus"]);
  expect(exit).not.toBe(0);
  expect(stdout).toBe("");
  expect(stderr).toContain("Usage:");
});

test("a bare invocation with no subcommand leaves stdout empty", async () => {
  const { exit, stdout, stderr } = await runCli([]);
  expect(exit).not.toBe(0);
  expect(stdout).toBe("");
  expect(stderr).toContain("Usage:");
});

test("an invalid bump still emits a BAD_BUMP JSON object on stdout", async () => {
  const { exit, stdout } = await runCli(["compute", "notabump"]);
  expect(exit).not.toBe(0);
  const parsed = JSON.parse(stdout);
  expect(parsed.ok).toBe(false);
  expect(parsed.errorCode).toBe("BAD_BUMP");
});

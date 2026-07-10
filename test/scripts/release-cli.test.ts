// Contract test for the release subcommand group's stdout discipline (EXC-473).
// The /release-caret skill parses `caret-tasks release <sub>` stdout as a single
// JSON object, so Commander's help / usage / error output MUST go to stderr,
// never stdout. Application-level errors (e.g. an invalid bump) keep emitting
// their JSON ReleaseError on stdout — that is part of the same contract. The
// release group carries its own configureOutput + per-action error handling, so
// this discipline holds even though the group is mounted under the tasks CLI
// (whose top-level errors go to plain stderr). We exercise the CLI as a
// subprocess, the way it actually runs during a release.

import { expect, test } from "bun:test";

const CLI = "scripts/tasks/cli.ts";

/** Run `caret-tasks release <args>` as a subprocess; capture exit, stdout, stderr. */
async function runRelease(
  args: string[],
): Promise<{ exit: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([process.execPath, CLI, "release", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exit] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exit, stdout, stderr };
}

// Each case spawns a cold `bun` subprocess; that start-up plus the CLI's import
// graph can run several seconds when the suite's files execute concurrently on
// a busy machine, so these get a generous timeout instead of bun's 5s default.
const SUBPROCESS_SPAWN_TIMEOUT_MS = 30_000;

test(
  "release --help routes help to stderr, leaving stdout empty",
  async () => {
    const { exit, stdout, stderr } = await runRelease(["--help"]);
    expect(exit).toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toContain("Usage:");
  },
  SUBPROCESS_SPAWN_TIMEOUT_MS,
);

test(
  "an unknown release subcommand leaves stdout empty (usage on stderr)",
  async () => {
    const { exit, stdout, stderr } = await runRelease(["bogus"]);
    expect(exit).not.toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toContain("Usage:");
  },
  SUBPROCESS_SPAWN_TIMEOUT_MS,
);

test(
  "a bare release invocation with no subcommand leaves stdout empty",
  async () => {
    const { exit, stdout, stderr } = await runRelease([]);
    expect(exit).not.toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toContain("Usage:");
  },
  SUBPROCESS_SPAWN_TIMEOUT_MS,
);

test(
  "an invalid bump still emits a BAD_BUMP JSON object on stdout",
  async () => {
    const { exit, stdout } = await runRelease(["compute", "notabump"]);
    expect(exit).not.toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.errorCode).toBe("BAD_BUMP");
  },
  SUBPROCESS_SPAWN_TIMEOUT_MS,
);

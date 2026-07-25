// Contract test for the release subcommand group's stdout discipline (EXC-473).
// The /release-caret skill parses `caret-tasks release <sub>` stdout as a single
// JSON object, so Commander's help / usage / error output MUST go to stderr,
// never stdout. Application-level errors (e.g. an invalid bump) keep emitting
// their JSON ReleaseError on stdout — that is part of the same contract. The
// release group carries its own configureOutput + per-action error handling, so
// this discipline holds even though the group is mounted under the tasks CLI
// (whose top-level errors go to plain stderr).
//
// Two layers: the subprocess cases exercise the CLI the way it runs during a
// release (Commander parsing, help/usage routing, the BAD_BUMP path); the
// in-process cases at the bottom inject a throwing `Deps` — which a subprocess
// can't force deterministically — to pin emitStep's conversion of a thrown step
// error into JSON-on-stdout.

import { describe, expect, test } from "bun:test";

import { buildReleaseCommand } from "@/tasks/release/command.ts";
import type { Deps } from "@/tasks/release/steps.ts";

import { makeReleaseHarness } from "../support/release-harness.ts";

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

// Drive a release subcommand in-process against injected deps, capturing what the
// action writes and intercepting the process.exit that fail() calls (so it stops
// the action here instead of the test runner). If emitStep ever propagated a step
// error instead of converting it, `threw` would hold that error and stdout would
// be empty — which is exactly what these tests forbid.
async function runReleaseInProcess(
  deps: Deps,
  argv: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number | undefined; threw: unknown }> {
  const out: string[] = [];
  const err: string[] = [];
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  const origExit = process.exit;
  const EXIT = Symbol("exit");
  let exitCode: number | undefined;
  let threw: unknown;
  const capture = (sink: string[]) => (s: string | Uint8Array) => {
    sink.push(typeof s === "string" ? s : Buffer.from(s).toString());
    return true;
  };
  process.stdout.write = capture(out) as typeof process.stdout.write;
  process.stderr.write = capture(err) as typeof process.stderr.write;
  process.exit = ((code?: number) => {
    exitCode = code;
    throw EXIT;
  }) as typeof process.exit;
  try {
    await buildReleaseCommand(deps).parseAsync(argv, { from: "user" });
  } catch (e) {
    if (e !== EXIT) threw = e;
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
    process.exit = origExit;
  }
  return { stdout: out.join(""), stderr: err.join(""), exitCode, threw };
}

describe("release group error discipline (in-process, injected deps)", () => {
  test("a GuardError from a step becomes a typed JSON error on stdout, stderr clean", async () => {
    // latestTag: null drives compute's NO_BASELINE guard (a thrown GuardError).
    const { deps } = makeReleaseHarness({ latestTag: null });
    const { stdout, stderr, exitCode, threw } = await runReleaseInProcess(deps, [
      "compute",
      "patch",
    ]);
    expect(threw).toBeUndefined(); // the action self-contained the error; nothing propagated
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.errorCode).toBe("NO_BASELINE");
    // The GuardError path never touches stderr — and in particular never reaches
    // the tasks CLI's plain-stderr `caret-tasks:` top-level catch.
    expect(stderr).toBe("");
  });

  test("finalize's --title and --notes-file reach the step and shape the release", async () => {
    // Commander camelCases --notes-file to opts.notesFile; a slip there reads as
    // "no notes" and publishes a silently empty Release body, discovered only after
    // the tag is pushed. --title fails loudly by contrast, so only this asserts it.
    const NOTES_FILE = "/tmp/caret-release-notes.md";
    const { deps, releases } = makeReleaseHarness({
      refs: { "origin/trunk": "mergedsha" },
      files: { [NOTES_FILE]: "Ships the widget.\n" },
      filesAtRef: {
        "origin/trunk:package.json": '{ "version": "0.1.0" }',
        "origin/trunk:.claude-plugin/plugin.json": '{ "version": "0.1.0" }',
        "origin/trunk:.claude-plugin/marketplace.json": '{ "version": "0.1.0" }',
      },
    });
    const { threw } = await runReleaseInProcess(deps, [
      "finalize",
      "--yes",
      "--title",
      "The Foundations Release",
      "--notes-file",
      NOTES_FILE,
    ]);
    expect(threw).toBeUndefined();
    expect(releases.get("v0.1.0")?.notes).toContain("Ships the widget.");
  });

  test("an unexpected step error becomes an INTERNAL JSON error on stdout, stack to stderr", async () => {
    const { deps } = makeReleaseHarness();
    // A non-GuardError thrown mid-step: exercised via a collaborator compute calls.
    const boom: Deps = {
      ...deps,
      git: {
        ...deps.git,
        latestVersionTag: async () => {
          throw new Error("boom");
        },
      },
    };
    const { stdout, stderr, exitCode, threw } = await runReleaseInProcess(boom, [
      "compute",
      "patch",
    ]);
    expect(threw).toBeUndefined();
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.errorCode).toBe("INTERNAL");
    expect(stderr).toContain("boom"); // the stack/message went to stderr, not stdout
    expect(stderr).not.toContain("caret-tasks:"); // not the tasks CLI's top-level catch
  });
});

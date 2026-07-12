// The release pipeline as a subcommand group of the caret tasks CLI. Mounted by
// scripts/tasks/cli.ts as `caret-tasks release compute|baseline|prepare|finalize`;
// the `.mise/tasks/release` forwarder execs `scripts/tasks/cli.ts release "$@"`.
//
// Unlike the sibling tasks, the release group prints exactly one JSON object on
// stdout — a step result on success or a ReleaseError on a guard rejection — so
// /release-caret parses rather than scrapes. Two pieces enforce that: a
// configureOutput that routes Commander's help/usage/parse-error text to stderr
// (keeping stdout a lone JSON object), and per-action error handling (emitStep)
// that turns any thrown error into a typed JSON error on stdout. This discipline
// is deliberately scoped to the release group and does not lean on the tasks
// CLI's top-level catch, which prints plain stderr and would break the JSON
// contract. The scripts/release/* step modules own the pipeline; this file only
// wires the command tree and injects the real collaborators.

import type { Command } from "@commander-js/extra-typings";
import { createProgram } from "../../src/program.ts";
import { errorResult, type ReleaseError } from "../release/contract.ts";
import { createGit } from "../release/git.ts";
import { createGitHub } from "../release/github.ts";
import { createNpm } from "../release/npm.ts";
import { baseline, compute, type Deps, finalize, GuardError, prepare } from "../release/steps.ts";
import { isBumpLevel } from "../release/version.ts";

function realDeps(): Deps {
  return {
    git: createGit(),
    github: createGitHub(),
    npm: createNpm(),
    fs: {
      read: (path) => Bun.file(path).text(),
      write: async (path, contents) => {
        await Bun.write(path, contents);
      },
      exists: (path) => Bun.file(path).exists(),
    },
    io: { log: (m) => process.stderr.write(`${m}\n`) },
    now: () => new Date(),
  };
}

function emit(result: unknown): void {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function fail(error: ReleaseError): never {
  emit(error);
  process.exit(1);
}

// Run one release step: emit its JSON result on stdout, or convert any thrown
// error to a typed JSON ReleaseError on stdout — never the tasks CLI's
// plain-stderr top-level catch — so /release-caret always gets a parseable
// stdout. A GuardError is a clean, expected rejection; anything else logs its
// stack to stderr and emits an INTERNAL error. Both exit 1 via fail().
async function emitStep(run: () => Promise<unknown>): Promise<void> {
  try {
    emit(await run());
  } catch (e) {
    if (e instanceof GuardError) fail(errorResult(e.code, e.message));
    process.stderr.write(`${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
    fail(errorResult("INTERNAL", e instanceof Error ? e.message : String(e)));
  }
}

// Mutating commands need an explicit --yes (the skill passes it after its single
// version-confirmation gate) or --dry-run to preview.
function requireGo(command: string, opts: { dryRun?: boolean; yes?: boolean }): void {
  if (!opts.dryRun && !opts.yes) {
    fail(
      errorResult(
        "INTERNAL",
        `${command} mutates state; pass --yes to proceed or --dry-run to preview.`,
      ),
    );
  }
}

function requireBump(bump: string): "patch" | "minor" | "major" {
  if (!isBumpLevel(bump)) {
    fail(errorResult("BAD_BUMP", `Invalid bump ${JSON.stringify(bump)}; use patch|minor|major.`));
  }
  return bump;
}

/**
 * Build the release subcommand group. `deps` is injectable to mirror the tasks
 * CLI's action seam; production wires realDeps(). The group carries its own
 * configureOutput (help/usage/errors to stderr) so stdout stays a lone JSON
 * object for /release-caret, independent of how the tasks CLI reports errors.
 */
export function buildReleaseCommand(deps: Deps = realDeps()): Command {
  const program = createProgram(
    "release",
    "caret release pipeline: baseline | compute | prepare | finalize",
  ).configureOutput({
    writeOut: (s) => process.stderr.write(s),
    writeErr: (s) => process.stderr.write(s),
  });

  program
    .command("compute")
    .description("compute the next version (read-only)")
    .argument("<bump>", "patch | minor | major")
    .action(async (bump) => {
      const level = requireBump(bump);
      await emitStep(() => compute(deps, { bump: level }));
    });

  program
    .command("baseline")
    .description("tag the repo's root commit as the v0.0.1 baseline")
    .option("--dry-run", "preview without mutating")
    .option("--yes", "confirm the mutation")
    .action(async (opts) => {
      requireGo("baseline", opts);
      await emitStep(() => baseline(deps, { dryRun: opts.dryRun ?? false }));
    });

  program
    .command("prepare")
    .description("phase 1: bump manifests, commit, push, open the release PR")
    .argument("<bump>", "patch | minor | major")
    .option("--dry-run", "preview without mutating")
    .option("--yes", "confirm the mutation")
    .action(async (bump, opts) => {
      const level = requireBump(bump);
      requireGo("prepare", opts);
      await emitStep(() => prepare(deps, { bump: level, dryRun: opts.dryRun ?? false }));
    });

  program
    .command("finalize")
    .description("phase 2: tag merged trunk and publish the GitHub Release")
    .option("--dry-run", "preview without mutating")
    .option("--yes", "confirm the mutation")
    .action(async (opts) => {
      requireGo("finalize", opts);
      await emitStep(() => finalize(deps, { dryRun: opts.dryRun ?? false }));
    });

  return program;
}

#!/usr/bin/env bun
// CLI entry for the release pipeline. Dispatches to the steps in steps.ts,
// printing exactly one JSON result on stdout (so /release-caret parses rather
// than scrapes) and all diagnostics on stderr. Exit 0 on success, 1 on any guard
// rejection or unexpected error. Commander parses the args (EXC-473) via the
// shared scaffolding in src/program.ts; the divergence is configureOutput, which
// routes Commander's help/usage/error output to stderr to keep stdout a lone JSON
// object, and the onError that emits a typed JSON error rather than denying.

import type { Command } from "@commander-js/extra-typings";
import { $ } from "bun";
import { createProgram, runProgram } from "../../src/program.ts";
import { errorResult, type ReleaseError } from "./contract.ts";
import { createGit } from "./git.ts";
import { createGitHub } from "./github.ts";
import { createNpm } from "./npm.ts";
import { baseline, compute, type Deps, finalize, GuardError, prepare } from "./steps.ts";
import { isBumpLevel } from "./version.ts";

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
    preflight: async () => {
      // .quiet() keeps preflight's task output off our stdout (which must
      // stay a single JSON object); it is still captured into r.stdout/r.stderr.
      const r = await $`mise run preflight`.quiet().nothrow();
      return {
        ok: r.exitCode === 0,
        output: `${r.stdout.toString()}${r.stderr.toString()}`,
      };
    },
  };
}

function emit(result: unknown): void {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function fail(error: ReleaseError): never {
  emit(error);
  process.exit(1);
}

// Mutating commands need an explicit --yes (the skill passes it only after its
// remote-mutation confirmation) or --dry-run to preview.
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

function buildProgram(): Command {
  const deps = realDeps();
  // Route every Commander-originated write (help, usage, parse errors, and the
  // post-error help from showHelpAfterError) to stderr; stdout is reserved for
  // emit()'s single JSON object so /release-caret can parse it (EXC-473).
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
    .action(async (bump) => emit(await compute(deps, { bump: requireBump(bump) })));

  program
    .command("baseline")
    .description("tag the repo's root commit as the v0.0.1 baseline")
    .option("--dry-run", "preview without mutating")
    .option("--yes", "confirm the mutation")
    .action(async (opts) => {
      requireGo("baseline", opts);
      emit(await baseline(deps, { dryRun: opts.dryRun ?? false }));
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
      emit(await prepare(deps, { bump: level, dryRun: opts.dryRun ?? false }));
    });

  program
    .command("finalize")
    .description("phase 2: tag merged trunk and publish the GitHub Release")
    .option("--dry-run", "preview without mutating")
    .option("--yes", "confirm the mutation")
    .action(async (opts) => {
      requireGo("finalize", opts);
      emit(await finalize(deps, { dryRun: opts.dryRun ?? false }));
    });

  return program;
}

if (import.meta.main) {
  // This onError mirrors the former main()'s try/catch: a GuardError becomes its
  // typed ReleaseError on stdout; any other error logs its stack to stderr and
  // emits an INTERNAL ReleaseError. Both exit 1 via fail().
  runProgram(buildProgram(), (e) => {
    if (e instanceof GuardError) fail(errorResult(e.code, e.message));
    process.stderr.write(`${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
    fail(errorResult("INTERNAL", e instanceof Error ? e.message : String(e)));
  });
}

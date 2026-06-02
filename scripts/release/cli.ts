#!/usr/bin/env bun
// CLI entry for the release pipeline. Dispatches to the steps in steps.ts,
// printing exactly one JSON result on stdout (so /release-caret parses rather
// than scrapes) and all diagnostics on stderr. Exit 0 on success, 1 on any guard
// rejection or unexpected error. Mirrors scripts/dev/driver.ts: import.meta.main
// guard, stderr logging, top-level catch.

import { $ } from "bun";
import { type ReleaseError, errorResult } from "./contract.ts";
import { createGit } from "./git.ts";
import { createGitHub } from "./github.ts";
import { type Deps, GuardError, baseline, compute, finalize, prepare } from "./steps.ts";
import { isBumpLevel } from "./version.ts";

function realDeps(): Deps {
  return {
    git: createGit(),
    github: createGitHub(),
    fs: {
      read: (path) => Bun.file(path).text(),
      write: async (path, contents) => {
        await Bun.write(path, contents);
      },
      exists: (path) => Bun.file(path).exists(),
    },
    io: { log: (m) => process.stderr.write(`${m}\n`) },
    preflight: async () => {
      const r = await $`mise run preflight`.nothrow();
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

const USAGE = `Usage:
  release baseline            [--dry-run] [--yes]
  release compute  <patch|minor|major>
  release prepare  <patch|minor|major> [--dry-run] [--yes]
  release finalize            [--dry-run] [--yes]`;

async function main(argv: string[]): Promise<void> {
  const args = argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  const positional = args.filter((a) => !a.startsWith("--"));
  const command = positional[0] ?? "";
  const dryRun = flags.has("--dry-run");
  const yes = flags.has("--yes");
  const deps = realDeps();

  // Mutating commands need an explicit --yes (the skill passes it only after its
  // remote-mutation confirmation) or --dry-run to preview.
  const requireGo = (): void => {
    if (!dryRun && !yes) {
      fail(
        errorResult(
          "INTERNAL",
          `${command} mutates state; pass --yes to proceed or --dry-run to preview.`,
        ),
      );
    }
  };

  const requireBump = (): "patch" | "minor" | "major" => {
    const bump = positional[1] ?? "";
    if (!isBumpLevel(bump)) {
      fail(errorResult("BAD_BUMP", `Invalid bump ${JSON.stringify(bump)}; use patch|minor|major.`));
    }
    return bump;
  };

  try {
    switch (command) {
      case "compute":
        emit(await compute(deps, { bump: requireBump() }));
        return;
      case "baseline":
        requireGo();
        emit(await baseline(deps, { dryRun }));
        return;
      case "prepare": {
        const bump = requireBump();
        requireGo();
        emit(await prepare(deps, { bump, dryRun }));
        return;
      }
      case "finalize":
        requireGo();
        emit(await finalize(deps, { dryRun }));
        return;
      default:
        process.stderr.write(`${USAGE}\n`);
        fail(errorResult("INTERNAL", `Unknown command ${JSON.stringify(command)}.`));
    }
  } catch (e) {
    if (e instanceof GuardError) fail(errorResult(e.code, e.message));
    process.stderr.write(`${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
    fail(errorResult("INTERNAL", e instanceof Error ? e.message : String(e)));
  }
}

if (import.meta.main) {
  void main(process.argv);
}

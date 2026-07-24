#!/usr/bin/env bun
// caret hook CLI. Subcommands: daemon | prewarm | review | reconcile | redact |
// discovery | install.
//
// This file is only the composition point: it assembles the Commander tree and
// threads each subcommand's parsed options into its run function (the actions in
// src/commands/). The review orchestration core (src/review/orchestrate.ts), daemon
// takeover/lifecycle (src/daemon/lifecycle.ts), the HTTP client
// (src/daemon/client.ts), and build/commit fingerprinting (src/lib/build-id.ts) live
// in their own modules and are imported by the commands.
//
// FAIL-SAFE = DENY: shipping an unreviewed plan is the one outcome we never
// allow. Every abnormal path (bad stdin, unreachable daemon, timeout, signal,
// daemon death) emits a deny — never an allow.

import type { Command } from "@commander-js/extra-typings";

import { fatalDeny } from "@/adapters/index.ts";
import { runDaemon } from "@/commands/daemon.ts";
import { runDiscoverySubcommand } from "@/commands/discovery.ts";
import { runInstallSubcommand } from "@/commands/install.ts";
import { runInstallRumdlSubcommand } from "@/commands/install-rumdl.ts";
import { runPrewarm } from "@/commands/prewarm.ts";
import { runReconcileSubcommand } from "@/commands/reconcile.ts";
import { runRedactSubcommand } from "@/commands/redact.ts";
import { runReviewSubcommand } from "@/commands/review.ts";
import { logFile } from "@/config/paths.ts";
import { VERSION } from "@/lib/build-id.ts";
import { logError } from "@/lib/log.ts";
import { createProgram, runProgram } from "@/lib/program.ts";

// The CLI command tree (EXC-472). Each subcommand's action threads its parsed
// options into the run functions, replacing the former process.argv reads. The
// daemon self-spawn vector (daemonCommand) and runReviewSubcommand's fail-safe
// are independent of this layer and unchanged.
function buildProgram(): Command {
  const program = createProgram(
    "caret",
    "caret hook CLI: daemon | prewarm | review | reconcile | redact | discovery | install",
  ).version(VERSION);

  program
    .command("daemon")
    .description("run the review daemon")
    .option("--ephemeral", "bind an OS-assigned port instead of the configured one")
    .action((opts) => runDaemon({ ephemeral: opts.ephemeral ?? false }));

  program
    .command("prewarm")
    .description("warm-start the daemon")
    .action(() => runPrewarm());

  program
    .command("review")
    .description("review a plan from stdin (ExitPlanMode hook)")
    .action(() => runReviewSubcommand());

  program
    .command("reconcile")
    .description(
      "reconcile a terminal plan approval into the daemon (ExitPlanMode PostToolUse hook)",
    )
    .action(() => runReconcileSubcommand());

  program
    .command("redact")
    .description("write redacted copies of the logs")
    .action(() => runRedactSubcommand());

  program
    .command("discovery")
    .description("print a diagnostics report")
    .option("--json", "emit the machine-readable JSON document")
    .action((opts) => runDiscoverySubcommand({ json: opts.json ?? false }));

  program
    .command("install")
    .description("install caret into a coding agent (omit --target to choose interactively)")
    .option(
      "--target <targets>",
      "comma-separated agents to install into: opencode, claude, or opencode,claude",
    )
    .option("--uninstall", "remove caret from the target(s) instead of installing")
    .option("--dry-run", "print what would change without writing")
    .action((opts) =>
      runInstallSubcommand({
        target: opts.target,
        uninstall: opts.uninstall ?? false,
        dryRun: opts.dryRun ?? false,
      }),
    );

  program
    .command("install-rumdl")
    .description("download the rumdl plan formatter into caret's state dir")
    .action(() => runInstallRumdlSubcommand());

  return program;
}

if (import.meta.main) {
  // KEEP the guard: the command modules and cores are imported by the test
  // suites for their internal functions; the parse must run only when this file
  // is the entrypoint, never on import (it would parse the test runner's argv and
  // exit 1, killing tests).
  runProgram(buildProgram(), (err) => {
    // Last-resort fail-safe for the review path; harmless noise elsewhere.
    // fatalDeny resolves the active adapter and renders its deny, degrading to a
    // dependency-free deny line if selection or rendering throws — so the
    // truly-fatal path always ships a deny rather than emitting nothing.
    logError("fatal", err);
    const reason = `caret: fatal ${err} — denying to fail safe. See ${logFile()}.`;
    process.stdout.write(`${fatalDeny(reason)}\n`);
    process.exit(0);
  });
}

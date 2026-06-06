#!/usr/bin/env bun
// caret hook CLI. Subcommands: daemon | prewarm | review | redact | discovery.
//
// This file is only the composition point: it assembles the Commander tree and
// threads each subcommand's parsed options into its run function (the actions in
// src/commands/). The review orchestration core (src/review.ts), daemon
// takeover/lifecycle (src/daemon-lifecycle.ts), the HTTP client
// (src/daemon-client.ts), and build/commit fingerprinting (src/build-id.ts) live
// in their own modules and are imported by the commands.
//
// FAIL-SAFE = DENY: shipping an unreviewed plan is the one outcome we never
// allow. Every abnormal path (bad stdin, unreachable daemon, timeout, signal,
// daemon death) emits a deny — never an allow.

import { Command } from "@commander-js/extra-typings";
import { denyOutput } from "./adapters/claude/feedback.ts";
import { runDaemon } from "./commands/daemon.ts";
import { runDiscoverySubcommand } from "./commands/discovery.ts";
import { runPrewarm } from "./commands/prewarm.ts";
import { runRedactSubcommand } from "./commands/redact.ts";
import { runReviewSubcommand } from "./commands/review.ts";
import { logError } from "./log.ts";
import { logFile, VERSION } from "./paths.ts";

// The CLI command tree (EXC-472). Each subcommand's action threads its parsed
// options into the run functions, replacing the former process.argv reads. The
// daemon self-spawn vector (daemonCommand) and runReviewSubcommand's fail-safe
// are independent of this layer and unchanged.
function buildProgram(): Command {
  const program = new Command()
    .name("caret")
    .description("caret hook CLI: daemon | prewarm | review | redact | discovery")
    .version(VERSION)
    // We never call exitOverride(): a parse error (unknown command/option, bare
    // `caret`) prints usage to stderr and exits non-zero via Commander's default,
    // synchronously during parse. It can never reach the fail-safe catch below,
    // so a parse error never masquerades as a deny (EXC-472).
    .showHelpAfterError();

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
    .command("redact")
    .description("write redacted copies of the logs")
    .action(() => runRedactSubcommand());

  program
    .command("discovery")
    .description("print a diagnostics report")
    .option("--json", "emit the machine-readable JSON document")
    .action((opts) => runDiscoverySubcommand({ json: opts.json ?? false }));

  return program;
}

if (import.meta.main) {
  // KEEP the guard: the command modules and cores are imported by the test
  // suites for their internal functions; parseAsync must run only when this file
  // is the entrypoint, never on import (it would parse the test runner's argv and
  // exit 1, killing tests). parseAsync (not parse) so an async action's rejection
  // propagates to .catch().
  buildProgram()
    .parseAsync(process.argv)
    .catch((err) => {
      // Last-resort fail-safe for the review path; harmless noise elsewhere.
      logError("fatal", err);
      process.stdout.write(
        `${JSON.stringify(denyOutput(`caret: fatal ${err} — denying to fail safe. See ${logFile()}.`))}\n`,
      );
      process.exit(0);
    });
}

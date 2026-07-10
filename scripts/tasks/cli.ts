#!/usr/bin/env bun
// The caret dev/build tasks CLI (the "single CLI" the mise tasks forward to).
// mise file tasks under .mise/tasks/ are thin Bun shims that forward their argv
// to this one program for parsing — e.g. `.mise/tasks/dev` calls
// run(["dev", ...argv]) — so commander owns every flag's parsing, validation,
// defaults, and --help, and the tasks stay one line each. Today it hosts `dev`;
// the other tasks (build, lint, …) migrate here next.
//
// Composition point only, like src/cli.ts: it assembles the commander tree and
// threads each subcommand's parsed options into its run function
// (scripts/dev/run.ts, etc.). It reuses createProgram from src/program.ts so all
// three caret CLIs share the same name/description/help conventions.

import { InvalidArgumentError } from "@commander-js/extra-typings";
import { createProgram } from "../../src/program.ts";
import { DEFAULT_NUM_VERSIONS, parsePositiveInt } from "../dev/protocol.ts";
import { type RunDevOptions, runDev } from "../dev/run.ts";

/** Build the tasks commander program. The dev action is injectable so tests can
 * assert the parsed options without spawning the real dev stack. */
export function buildProgram(devAction: (opts: RunDevOptions) => Promise<unknown> = runDev) {
  const program = createProgram("caret-tasks", "caret dev/build tasks CLI: dev");

  program
    .command("dev")
    .description("Run the dev UI with an isolated, fake-plan-seeded caret daemon")
    .option(
      "--num-versions <n>",
      "how many versions the primary dev review opens with",
      (raw) => {
        try {
          return parsePositiveInt(raw, "--num-versions");
        } catch (err) {
          throw new InvalidArgumentError((err as Error).message);
        }
      },
      DEFAULT_NUM_VERSIONS,
    )
    .option("--notify", "arm the recurring extra-review seeder (the EXC-427 notification path)")
    .action(async (opts) => {
      await devAction({ numVersions: opts.numVersions, notify: opts.notify ?? false });
    });

  return program;
}

/** Parse user-supplied argv (no node/script prefix) and run. The thin task shims
 * call this with their subcommand prepended, e.g. run(["dev", ...userArgs]). */
export async function run(argv: string[]): Promise<void> {
  await buildProgram().parseAsync(argv, { from: "user" });
}

if (import.meta.main) {
  // Guard so importing this file (tests) never parses the runner's argv.
  run(Bun.argv.slice(2)).catch((err) => {
    process.stderr.write(`caret-tasks: ${err instanceof Error ? err.message : err}\n`);
    process.exit(1);
  });
}

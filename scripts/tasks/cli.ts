#!/usr/bin/env bun
// The caret dev/build tasks CLI (the "single CLI" the mise tasks forward to).
// mise file tasks under .mise/tasks/ are thin bash forwarders that exec their
// subcommand here — e.g. `.mise/tasks/lint` is `exec bun scripts/tasks/cli.ts
// lint "$@"` — so commander owns every flag's parsing, validation, defaults, and
// --help, and each task file stays one line. Two tasks stay out of this CLI on
// purpose: `release` keeps its own CLI at scripts/release/cli.ts (a reverse-merge
// into this one is tracked by EXC-736), and `preflight` stays a TOML task so
// mise's usage spec can feed its --json flags into scripts/preflight.ts (migrating
// it too is tracked by EXC-737).
//
// Composition point only, like src/cli.ts: it assembles the commander tree and
// threads each subcommand's parsed options/args into its run function. Every
// task module is a sibling in this directory (scripts/tasks/*.ts, plus the
// multi-file dev task in scripts/tasks/dev/); code shared across tasks lives in
// scripts/tasks/lib/. Each action is injectable so tests drive the real parsing
// without spawning the tools. It reuses createProgram from src/program.ts so all
// caret CLIs share the same name/description/help conventions.

import { InvalidArgumentError } from "@commander-js/extra-typings";
import { createProgram } from "../../src/program.ts";
import { runBuildBin } from "./build-bin.ts";
import { runBuildBundle } from "./build-bundle.ts";
import { runBuildUi } from "./build-ui.ts";
import { runBuild } from "./build.ts";
import { DEFAULT_NUM_VERSIONS, parsePositiveInt } from "./dev/protocol.ts";
import { type RunDevOptions, runDev } from "./dev/run.ts";
import { runFormat } from "./format.ts";
import { runLint } from "./lint.ts";
import { runSetup } from "./setup.ts";
import { runSmokeBin } from "./smoke-bin.ts";
import { runSmokeBundle } from "./smoke-bundle.ts";
import { runTestE2e } from "./test-e2e.ts";
import { runTest } from "./test.ts";

/** The action behind each subcommand. Injectable so tests assert the parsed
 * options/args without spawning the real tools; production wires the run
 * functions in `realActions`. */
export interface TaskActions {
  dev: (opts: RunDevOptions) => Promise<unknown>;
  buildUi: (args: string[]) => Promise<unknown>;
  buildBin: () => Promise<unknown>;
  buildBundle: () => Promise<unknown>;
  build: (opts: { install: boolean }) => Promise<unknown>;
  lint: (args: string[]) => Promise<unknown>;
  format: (args: string[]) => Promise<unknown>;
  test: (args: string[]) => Promise<unknown>;
  testE2e: (args: string[]) => Promise<unknown>;
  setup: () => Promise<unknown>;
  smokeBin: () => Promise<unknown>;
  smokeBundle: () => Promise<unknown>;
}

const realActions: TaskActions = {
  dev: runDev,
  buildUi: runBuildUi,
  buildBin: runBuildBin,
  buildBundle: runBuildBundle,
  build: runBuild,
  lint: runLint,
  format: runFormat,
  test: runTest,
  testE2e: runTestE2e,
  setup: runSetup,
  smokeBin: runSmokeBin,
  smokeBundle: runSmokeBundle,
};

/** Build the tasks commander program. `overrides` replaces individual actions
 * (tests inject capturing fakes); anything unset falls back to `realActions`. */
export function buildProgram(overrides: Partial<TaskActions> = {}) {
  const actions = { ...realActions, ...overrides };
  // enablePositionalOptions lets the passthrough subcommands below use
  // passThroughOptions, so their `"$@"` (operands AND flags) reaches the tool
  // untouched instead of being parsed by commander.
  const program = createProgram(
    "caret-tasks",
    "caret dev/build tasks CLI",
  ).enablePositionalOptions();

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
      await actions.dev({ numVersions: opts.numVersions, notify: opts.notify ?? false });
    });

  // A passthrough task is a bare subcommand that forwards its raw argv (operands
  // and flags) to the tool its run function shells out to. allowUnknownOption +
  // passThroughOptions keep commander from parsing the forwarded flags.
  const passthrough = (
    name: string,
    description: string,
    run: (args: string[]) => Promise<unknown>,
  ): void => {
    program
      .command(name)
      .description(description)
      .allowUnknownOption()
      .passThroughOptions()
      .argument("[args...]", "forwarded to the underlying tool")
      .action(async (args: string[]) => {
        await run(args);
      });
  };

  passthrough(
    "build-ui",
    "Build the Svelte UI (Vite -> ui/dist: index.html + hashed assets)",
    (a) => actions.buildUi(a),
  );
  passthrough("lint", "Check formatting and lint rules (Biome, read-only)", (a) => actions.lint(a));
  passthrough("format", "Format all files (Biome, write mode)", (a) => actions.format(a));
  passthrough("test", "Run the test suite (bun test)", (a) => actions.test(a));
  passthrough("test-e2e", "Run the Playwright e2e suite against an isolated daemon", (a) =>
    actions.testE2e(a),
  );

  // build-bin and build-bundle take no args; the mise forwarders carry their
  // `#MISE depends=[...]` so the DAG (build-ui first, etc.) stays at the mise
  // layer, not here.
  program
    .command("build-bin")
    .description("Compile the single caret binary (bun build --compile)")
    .action(async () => {
      await actions.buildBin();
    });

  program
    .command("build-bundle")
    .description(
      "Bundle caret for the npm/github plugin install (dist/cli.js + ui/dist; runs on bun, no node_modules)",
    )
    .action(async () => {
      await actions.buildBundle();
    });

  program
    .command("build")
    .description("Build the UI then the binary (build-ui -> build-bin)")
    .option("--install", "after building, install the local checkout + cycle the daemon (dev only)")
    .action(async (opts) => {
      await actions.build({ install: opts.install ?? false });
    });

  program
    .command("setup")
    .description("Install pinned tools, JS deps, e2e Chromium, and register git hooks")
    .action(async () => {
      await actions.setup();
    });

  program
    .command("smoke-bin")
    .description("Smoke-test the compiled binary: serves the embedded multi-asset UI over the wire")
    .action(async () => {
      await actions.smokeBin();
    });

  program
    .command("smoke-bundle")
    .description(
      "Smoke-test the run-from-source bundle: prewarm spawns a daemon that serves the UI",
    )
    .action(async () => {
      await actions.smokeBundle();
    });

  return program;
}

/** Parse user-supplied argv (no node/script prefix) and run. The thin task
 * forwarders call this with their subcommand prepended, e.g.
 * run(["lint", ...userArgs]). */
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

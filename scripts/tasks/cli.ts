#!/usr/bin/env bun
// The caret dev/build tasks CLI (the "single CLI" the mise tasks forward to).
// mise file tasks under .mise/tasks/ are thin bash forwarders that exec their
// subcommand here — e.g. `.mise/tasks/lint` is `exec bun scripts/tasks/cli.ts
// lint "$@"` — so commander owns every flag's parsing, validation, defaults, and
// --help, and each task file stays one line. The `release` pipeline is mounted
// here as a nested subcommand group (`caret-tasks release compute|baseline|
// prepare|finalize`, built in ./release/command.ts); it keeps its own JSON-on-stdout
// error discipline so /release-caret can parse it, independent of this CLI's
// plain-stderr top-level catch. The `preflight` gate is a subcommand too, but
// unlike the passthrough tasks its --json/-v/--grep/--task flags are real
// commander options, parsed here and handed to the gate orchestrator +
// --json reporting in scripts/preflight.ts (EXC-737).
//
// Composition point only, like src/cli.ts: it assembles the commander tree and
// threads each subcommand's parsed options/args into its run function. Every
// task module is a sibling in this directory (scripts/tasks/*.ts, plus the
// multi-file dev task in scripts/tasks/dev/); code shared across tasks lives in
// scripts/tasks/lib/. Each action is injectable so tests drive the real parsing
// without spawning the tools. It reuses createProgram from src/program.ts so all
// caret CLIs share the same name/description/help conventions.

import { InvalidArgumentError } from "@commander-js/extra-typings";
import { type JsonArgs, runPreflightCli } from "../../scripts/preflight.ts";
import { createProgram } from "../../src/program.ts";
import { runBuild, runBuildBin, runBuildBundle, runBuildUi } from "./build.ts";
import { DEFAULT_NUM_VERSIONS, parsePositiveInt } from "./dev/protocol.ts";
import { type RunDevOptions, runDev } from "./dev/run.ts";
import { runFormat } from "./format.ts";
import { runLint } from "./lint.ts";
import { buildReleaseCommand } from "./release/command.ts";
import { runSetup } from "./setup.ts";
import { runSmoke, runSmokeBin, runSmokeBundle } from "./smoke.ts";
import { runTest, runTestE2e } from "./test.ts";

/** The action behind each subcommand. Injectable so tests assert the parsed
 * options/args without spawning the real tools; production wires the run
 * functions in `realActions`. */
export interface TaskActions {
  dev: (opts: RunDevOptions) => Promise<unknown>;
  build: (opts: { install: boolean }) => Promise<unknown>;
  buildUi: (args: string[]) => Promise<unknown>;
  buildBin: () => Promise<unknown>;
  buildBundle: () => Promise<unknown>;
  lint: (args: string[]) => Promise<unknown>;
  format: (args: string[]) => Promise<unknown>;
  test: (args: string[]) => Promise<unknown>;
  testE2e: (args: string[]) => Promise<unknown>;
  setup: () => Promise<unknown>;
  smoke: () => Promise<unknown>;
  smokeBin: () => Promise<unknown>;
  smokeBundle: () => Promise<unknown>;
  preflight: (args: JsonArgs) => Promise<unknown>;
}

const realActions: TaskActions = {
  dev: runDev,
  build: runBuild,
  buildUi: runBuildUi,
  buildBin: runBuildBin,
  buildBundle: runBuildBundle,
  lint: runLint,
  format: runFormat,
  test: runTest,
  testE2e: runTestE2e,
  setup: runSetup,
  smoke: runSmoke,
  smokeBin: runSmokeBin,
  smokeBundle: runSmokeBundle,
  preflight: runPreflightCli,
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
    .option(
      "--port <n>",
      "fixed dev daemon port (overrides CARET_DEV_PORT / [dev].port)",
      (raw) => {
        try {
          return parsePositiveInt(raw, "--port");
        } catch (err) {
          throw new InvalidArgumentError((err as Error).message);
        }
      },
    )
    .option(
      "--state-dir <dir>",
      "persistent dev state dir (overrides CARET_DEV_STATE_DIR / [dev].state_dir)",
    )
    .option("--persist", "keep the ephemeral state dir on exit instead of wiping it")
    .action(async (opts) => {
      await actions.dev({
        numVersions: opts.numVersions,
        notify: opts.notify ?? false,
        port: opts.port,
        stateDir: opts.stateDir,
        persist: opts.persist ?? false,
      });
    });

  // A passthrough command forwards its raw argv (operands and flags) to the tool
  // its run function shells out to. allowUnknownOption + passThroughOptions keep
  // commander from parsing the forwarded flags; the top-level
  // enablePositionalOptions above lets even a nested subcommand (e.g. `build ui`)
  // pass through untouched.
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

  passthrough("lint", "Check formatting and lint rules (Biome, read-only)", (a) => actions.lint(a));
  passthrough("format", "Format all files (Biome, write mode)", (a) => actions.format(a));

  // `build`: bare umbrella (UI -> binary, plus the optional --install dev step),
  // with `ui`/`bin`/`bundle` as positional targets so `mise run build ui` reaches
  // the `ui` subcommand. UI-first ordering + the CARET_SKIP_BUILD_UI skip live in
  // build.ts, not a mise `depends` edge — scripts/preflight.ts is why the gate
  // builds the UI exactly once. `ui` forwards args to `vite build`.
  const build = program
    .command("build")
    .description("Build the UI then the binary (bare); or a `ui`/`bin`/`bundle` target")
    .option("--install", "after building, install the local checkout + cycle the daemon (dev only)")
    .action(async (opts) => {
      await actions.build({ install: opts.install ?? false });
    });
  build
    .command("ui")
    .description("Build the Svelte UI (Vite -> ui/dist: index.html + hashed assets)")
    .allowUnknownOption()
    .passThroughOptions()
    .argument("[args...]", "forwarded to vite build")
    .action(async (args: string[]) => {
      await actions.buildUi(args);
    });
  build
    .command("bin")
    .description("Compile the single caret binary (bun build --compile; builds the UI first)")
    .action(async () => {
      await actions.buildBin();
    });
  build
    .command("bundle")
    .description(
      "Bundle caret for the npm/github plugin install (dist/cli.js + ui/dist; builds the UI first)",
    )
    .action(async () => {
      await actions.buildBundle();
    });

  // `test`: bare and `unit` run the bun unit suite (the default target); `e2e`
  // runs the Playwright suite (building the UI first). Each forwards its own args
  // — a path / --test-name-pattern for unit, a spec path / --grep for e2e.
  const test = program
    .command("test")
    .description("Run tests: bare/`unit` = bun test, `e2e` = Playwright");
  test
    .command("unit", { isDefault: true })
    .description("Run the unit suite (bun test --conditions browser)")
    .allowUnknownOption()
    .passThroughOptions()
    .argument("[args...]", "forwarded to bun test")
    .action(async (args: string[]) => {
      await actions.test(args);
    });
  test
    .command("e2e")
    .description("Run the Playwright e2e suite against an isolated daemon (builds the UI first)")
    .allowUnknownOption()
    .passThroughOptions()
    .argument("[args...]", "forwarded to playwright test")
    .action(async (args: string[]) => {
      await actions.testE2e(args);
    });

  program
    .command("setup")
    .description("Install pinned tools, JS deps, e2e Chromium, and register git hooks")
    .action(async () => {
      await actions.setup();
    });

  // `smoke`: bare runs both targets (bin then bundle); each target builds its own
  // artifact first (via the tasks CLI) then smokes it over the wire.
  const smoke = program
    .command("smoke")
    .description("Smoke-test the shipped UI: bare = bin + bundle, or a `bin`/`bundle` target")
    .action(async () => {
      await actions.smoke();
    });
  smoke
    .command("bin")
    .description("Smoke-test the compiled binary: serves the embedded multi-asset UI over the wire")
    .action(async () => {
      await actions.smokeBin();
    });
  smoke
    .command("bundle")
    .description(
      "Smoke-test the run-from-source bundle: prewarm spawns a daemon that serves the UI",
    )
    .action(async () => {
      await actions.smokeBundle();
    });

  // `preflight`: the pre-push gate. Its --json output flags are real commander
  // options (not passthrough): `-v` counts up (`-vv` → 2) and `--task` is
  // repeatable. The action funnels the parsed flags into a JsonArgs and hands
  // them to runPreflightCli (the gate orchestrator in scripts/preflight.ts).
  program
    .command("preflight")
    .description("Pre-push gate (check-only): lint, unit + e2e tests, and build, run concurrently")
    .option(
      "--json",
      "Emit machine-readable JSON (two NDJSON docs on stdout) instead of the live display",
    )
    .option(
      "-v, --verbose",
      "Raise --json detail: -v full failure output + passing snippets, -vv all full",
      (_value, prev: number) => prev + 1,
      0,
    )
    .option("--grep <pattern>", "In --json mode, keep only output lines matching this regex")
    .option(
      "--task <name>",
      "In --json mode, scope output to the named task(s); repeatable",
      (value, prev: string[]) => [...prev, value],
      [] as string[],
    )
    .action(async (opts) => {
      // Commander types a no-arg flag carrying a count reducer as `number | true`;
      // the reducer plus the `0` default make it always a number at runtime.
      const verbosity = typeof opts.verbose === "number" ? opts.verbose : 0;
      const args: JsonArgs = { json: opts.json ?? false, verbosity, tasks: opts.task };
      // A truthy check (not `!== undefined`): an empty `--grep=` means no filter,
      // not a match-everything `new RegExp("")`.
      if (opts.grep) args.grep = opts.grep;
      await actions.preflight(args);
    });

  // The release pipeline mounts as a nested subcommand group with its own
  // JSON-on-stdout error discipline (see ./release/command.ts). addCommand (not command)
  // keeps the group's own configureOutput instead of inheriting this CLI's.
  program.addCommand(buildReleaseCommand());

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

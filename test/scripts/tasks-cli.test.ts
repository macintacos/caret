import { describe, expect, test } from "bun:test";
import { buildBinCompileCommand } from "../../scripts/build/build-bin.ts";
import { buildUiCommand } from "../../scripts/build/build-ui.ts";
import { buildInstallCommand } from "../../scripts/build/build.ts";
import { buildBundleCommand } from "../../scripts/build/build-bundle.ts";
import type { RunDevOptions } from "../../scripts/dev/run.ts";
import { formatCommand } from "../../scripts/lint/format.ts";
import { lintCommand } from "../../scripts/lint/lint.ts";
import { setupCommands } from "../../scripts/setup/setup.ts";
import { type TaskActions, buildProgram } from "../../scripts/tasks/cli.ts";
import { e2eCommand } from "../../scripts/test/e2e.ts";
import { testCommand } from "../../scripts/test/test.ts";

// The actions are injectable, so these drive the real commander tree (parsing,
// defaults, coercion, passthrough) and capture what it would hand each run
// function — without spawning vite/hk/bun. This pins the task→CLI contract:
// `mise run <task> <flags>` forwards to the matching subcommand.
async function parseDevArgs(args: string[]): Promise<RunDevOptions> {
  let captured: RunDevOptions | undefined;
  const program = buildProgram({
    dev: async (opts) => {
      captured = opts;
    },
  });
  await program.parseAsync(["dev", ...args], { from: "user" });
  if (!captured) throw new Error("dev action was not invoked");
  return captured;
}

describe("tasks CLI: dev command", () => {
  test("defaults: num-versions 3, notify false", async () => {
    expect(await parseDevArgs([])).toEqual({ numVersions: 3, notify: false });
  });

  test("parses --num-versions", async () => {
    expect(await parseDevArgs(["--num-versions", "5"])).toEqual({ numVersions: 5, notify: false });
  });

  test("parses --notify", async () => {
    expect(await parseDevArgs(["--notify"])).toEqual({ numVersions: 3, notify: true });
  });

  test("parses both flags together, in any order", async () => {
    expect(await parseDevArgs(["--notify", "--num-versions", "7"])).toEqual({
      numVersions: 7,
      notify: true,
    });
  });
});

// Capture the raw argv a passthrough subcommand hands its run function. These
// tasks forward `"$@"` verbatim to an external tool (vite, hk, bun), so
// commander must pass operands AND flags through untouched (passThroughOptions).
async function parsePassthrough(
  command: string,
  actionKey: keyof TaskActions,
  args: string[],
): Promise<string[]> {
  let captured: string[] | undefined;
  const overrides = {
    [actionKey]: async (a: string[]) => {
      captured = a;
    },
  } as Partial<TaskActions>;
  const program = buildProgram(overrides);
  await program.parseAsync([command, ...args], { from: "user" });
  if (captured === undefined) throw new Error(`${command} action was not invoked`);
  return captured;
}

describe("tasks CLI: passthrough forwarding", () => {
  const cases: Array<[string, keyof TaskActions]> = [
    ["build-ui", "buildUi"],
    ["lint", "lint"],
    ["format", "format"],
    ["test", "test"],
    ["test-e2e", "testE2e"],
  ];
  for (const [command, key] of cases) {
    test(`${command}: no args forwards []`, async () => {
      expect(await parsePassthrough(command, key, [])).toEqual([]);
    });
    test(`${command}: forwards positionals and flags untouched`, async () => {
      expect(await parsePassthrough(command, key, ["some/path", "--flag", "-x"])).toEqual([
        "some/path",
        "--flag",
        "-x",
      ]);
    });
  }
});

// Each task's exact command line — the behavior-preservation contract carried
// over from the former bash task bodies.
describe("tasks CLI: task command lines", () => {
  test("build-ui runs bunx vite build with forwarded args", () => {
    expect(buildUiCommand([])).toEqual(["bunx", "vite", "build"]);
    expect(buildUiCommand(["--minify"])).toEqual(["bunx", "vite", "build", "--minify"]);
  });

  test("lint runs hk check --all", () => {
    expect(lintCommand([])).toEqual(["hk", "check", "--all"]);
    expect(lintCommand(["src"])).toEqual(["hk", "check", "--all", "src"]);
  });

  test("format runs hk fix --all --no-stage", () => {
    expect(formatCommand([])).toEqual(["hk", "fix", "--all", "--no-stage"]);
    expect(formatCommand(["src"])).toEqual(["hk", "fix", "--all", "--no-stage", "src"]);
  });

  test("test runs bun test --conditions browser", () => {
    expect(testCommand([])).toEqual(["bun", "test", "--conditions", "browser"]);
    expect(testCommand(["--test-name-pattern", "x"])).toEqual([
      "bun",
      "test",
      "--conditions",
      "browser",
      "--test-name-pattern",
      "x",
    ]);
  });
});

// `build` carries a real --install flag (not passthrough): parse it explicitly.
async function parseBuildArgs(args: string[]): Promise<{ install: boolean }> {
  let captured: { install: boolean } | undefined;
  const program = buildProgram({
    build: async (opts) => {
      captured = opts;
    },
  });
  await program.parseAsync(["build", ...args], { from: "user" });
  if (!captured) throw new Error("build action was not invoked");
  return captured;
}

describe("tasks CLI: build command", () => {
  test("no flag: install false", async () => {
    expect(await parseBuildArgs([])).toEqual({ install: false });
  });

  test("--install: install true", async () => {
    expect(await parseBuildArgs(["--install"])).toEqual({ install: true });
  });

  test("build-bin subcommand invokes its action", async () => {
    let called = false;
    await buildProgram({
      buildBin: async () => {
        called = true;
      },
    }).parseAsync(["build-bin"], { from: "user" });
    expect(called).toBe(true);
  });

  test("build-bundle subcommand invokes its action", async () => {
    let called = false;
    await buildProgram({
      buildBundle: async () => {
        called = true;
      },
    }).parseAsync(["build-bundle"], { from: "user" });
    expect(called).toBe(true);
  });
});

describe("tasks CLI: build pipeline command lines", () => {
  test("build-bin bakes the commit into the compile via --define", () => {
    expect(buildBinCompileCommand("abc123")).toEqual([
      "bun",
      "build",
      "--compile",
      "--sourcemap",
      '--define=process.env.CARET_BUILD_COMMIT="abc123"',
      "--outfile",
      "bin/caret-native",
      "src/cli.ts",
    ]);
  });

  test("build-bundle runs a non-compile bun build into dist/", () => {
    expect(buildBundleCommand()).toEqual([
      "bun",
      "build",
      "--target=bun",
      "--outdir",
      "dist",
      "src/cli.ts",
    ]);
  });

  test("build --install forwards to install.sh --from-local; plain build does not", () => {
    expect(buildInstallCommand({ install: true })).toEqual(["scripts/install.sh", "--from-local"]);
    expect(buildInstallCommand({ install: false })).toBeNull();
  });

  test("test-e2e runs bunx playwright test with forwarded args", () => {
    expect(e2eCommand([])).toEqual(["bunx", "playwright", "test"]);
    expect(e2eCommand(["--grep", "smoke"])).toEqual([
      "bunx",
      "playwright",
      "test",
      "--grep",
      "smoke",
    ]);
  });

  test("setup installs tools, JS deps, then the e2e Chromium in order", () => {
    expect(setupCommands()).toEqual([
      ["mise", "install"],
      ["bun", "install"],
      ["bunx", "playwright", "install", "chromium"],
    ]);
  });
});

describe("tasks CLI: setup command", () => {
  test("setup subcommand invokes its action", async () => {
    let called = false;
    await buildProgram({
      setup: async () => {
        called = true;
      },
    }).parseAsync(["setup"], { from: "user" });
    expect(called).toBe(true);
  });
});

describe("tasks CLI: smoke commands", () => {
  test("smoke-bin subcommand invokes its action", async () => {
    let called = false;
    await buildProgram({
      smokeBin: async () => {
        called = true;
      },
    }).parseAsync(["smoke-bin"], { from: "user" });
    expect(called).toBe(true);
  });

  test("smoke-bundle subcommand invokes its action", async () => {
    let called = false;
    await buildProgram({
      smokeBundle: async () => {
        called = true;
      },
    }).parseAsync(["smoke-bundle"], { from: "user" });
    expect(called).toBe(true);
  });
});

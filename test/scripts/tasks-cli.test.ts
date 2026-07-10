import { describe, expect, test } from "bun:test";
import type { JsonArgs } from "../../scripts/preflight.ts";
import {
  buildBinArtifacts,
  buildBinCompileCommand,
  buildBundleCommand,
  buildInstallCommand,
  buildUiCommand,
  ensureUi,
  shouldBuildUi,
} from "../../scripts/tasks/build.ts";
import { type TaskActions, buildProgram } from "../../scripts/tasks/cli.ts";
import type { RunDevOptions } from "../../scripts/tasks/dev/run.ts";
import { formatCommand } from "../../scripts/tasks/format.ts";
import { lintCommand } from "../../scripts/tasks/lint.ts";
import { setupCommands } from "../../scripts/tasks/setup.ts";
import { smokePlan } from "../../scripts/tasks/smoke.ts";
import { e2eCommand, testCommand } from "../../scripts/tasks/test.ts";

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
  commandPath: string[],
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
  await program.parseAsync([...commandPath, ...args], { from: "user" });
  if (captured === undefined) throw new Error(`${commandPath.join(" ")} action was not invoked`);
  return captured;
}

describe("tasks CLI: passthrough forwarding", () => {
  // The `ui`/`unit`/`e2e` targets are positional subcommands of their group
  // (`mise run build ui`), and bare `test` defaults to the unit target — all must
  // forward their raw argv (EXC-738/739).
  const cases: Array<[string[], keyof TaskActions]> = [
    [["build", "ui"], "buildUi"],
    [["lint"], "lint"],
    [["format"], "format"],
    [["test"], "test"],
    [["test", "unit"], "test"],
    [["test", "e2e"], "testE2e"],
  ];
  for (const [commandPath, key] of cases) {
    const label = commandPath.join(" ");
    test(`${label}: no args forwards []`, async () => {
      expect(await parsePassthrough(commandPath, key, [])).toEqual([]);
    });
    test(`${label}: forwards positionals and flags untouched`, async () => {
      expect(await parsePassthrough(commandPath, key, ["some/path", "--flag", "-x"])).toEqual([
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
  test("build ui runs bunx vite build with forwarded args", () => {
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

  test("build bin subcommand invokes its action", async () => {
    let called = false;
    await buildProgram({
      buildBin: async () => {
        called = true;
      },
    }).parseAsync(["build", "bin"], { from: "user" });
    expect(called).toBe(true);
  });

  test("build bundle subcommand invokes its action", async () => {
    let called = false;
    await buildProgram({
      buildBundle: async () => {
        called = true;
      },
    }).parseAsync(["build", "bundle"], { from: "user" });
    expect(called).toBe(true);
  });
});

describe("tasks CLI: build pipeline command lines", () => {
  // The UI-first ordering that a mise `depends` edge once carried now lives in
  // build.ts: `build bin`/`build bundle`/`test e2e` build the UI first UNLESS
  // CARET_SKIP_BUILD_UI is set, which is how the preflight gate keeps the UI
  // built exactly once (scripts/preflight.ts spawns the dependents with it set).
  test("shouldBuildUi is true by default, false only when CARET_SKIP_BUILD_UI is set", () => {
    expect(shouldBuildUi({})).toBe(true);
    expect(shouldBuildUi({ CARET_SKIP_BUILD_UI: "1" })).toBe(false);
  });

  test("build bin bakes the commit into the compile via --define", () => {
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

  test("build bundle runs a non-compile bun build into dist/", () => {
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

  test("test e2e runs bunx playwright test with forwarded args", () => {
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
  test("bare smoke invokes the umbrella action", async () => {
    let called = false;
    await buildProgram({
      smoke: async () => {
        called = true;
      },
    }).parseAsync(["smoke"], { from: "user" });
    expect(called).toBe(true);
  });

  test("smoke bin subcommand invokes its action", async () => {
    let called = false;
    await buildProgram({
      smokeBin: async () => {
        called = true;
      },
    }).parseAsync(["smoke", "bin"], { from: "user" });
    expect(called).toBe(true);
  });

  test("smoke bundle subcommand invokes its action", async () => {
    let called = false;
    await buildProgram({
      smokeBundle: async () => {
        called = true;
      },
    }).parseAsync(["smoke", "bundle"], { from: "user" });
    expect(called).toBe(true);
  });
});

// The release pipeline is mounted as a nested subcommand group (EXC-736), so
// `mise run release <sub>` forwards to `caret-tasks release <sub>`. Its parsing
// and stdout-JSON error discipline are exercised as a subprocess in
// release-cli.test.ts; this pins the structural mount at the unit level.
describe("tasks CLI: release subcommand group", () => {
  test("registers a release group with the four release subcommands", () => {
    const release = buildProgram().commands.find((c) => c.name() === "release");
    expect(release).toBeDefined();
    expect(release?.commands.map((c) => c.name()).sort()).toEqual([
      "baseline",
      "compute",
      "finalize",
      "prepare",
    ]);
  });
});

// The preflight gate is a first-class subcommand (EXC-737): `mise run preflight`
// forwards to `caret-tasks preflight`, and commander parses --json/-v/--grep/
// --task directly — the interface the mise `usage` spec used to carry via
// usage_* env vars. This pins the parse → JsonArgs contract the preflight action
// receives, without running the real gate (the injected action just captures).
async function parsePreflightArgs(args: string[]): Promise<JsonArgs> {
  let captured: JsonArgs | undefined;
  const program = buildProgram({
    preflight: async (a) => {
      captured = a;
    },
  });
  await program.parseAsync(["preflight", ...args], { from: "user" });
  if (captured === undefined) throw new Error("preflight action was not invoked");
  return captured;
}

describe("tasks CLI: preflight command", () => {
  test("registers a preflight subcommand", () => {
    expect(buildProgram().commands.map((c) => c.name())).toContain("preflight");
  });

  test("bare invocation: json off, verbosity 0, no grep, no tasks", async () => {
    expect(await parsePreflightArgs([])).toEqual({ json: false, verbosity: 0, tasks: [] });
  });

  test("parses --json, counts -vv, reads --grep, collects repeatable --task", async () => {
    expect(
      await parsePreflightArgs([
        "--json",
        "-vv",
        "--grep",
        "err.*",
        "--task",
        "lint",
        "--task",
        "test",
      ]),
    ).toEqual({ json: true, verbosity: 2, grep: "err.*", tasks: ["lint", "test"] });
  });

  test("also accepts the separate -v -v and the =value forms", async () => {
    expect(
      await parsePreflightArgs([
        "--json",
        "-v",
        "-v",
        "--grep=err.*",
        "--task=lint",
        "--task=test",
      ]),
    ).toEqual({ json: true, verbosity: 2, grep: "err.*", tasks: ["lint", "test"] });
  });

  test("an empty --grep= is treated as no filter, not a match-everything pattern", async () => {
    expect(await parsePreflightArgs(["--json", "--grep="])).toEqual({
      json: true,
      verbosity: 0,
      tasks: [],
    });
  });
});

// --- orchestration ordering + the CARET_SKIP_BUILD_UI skip (EXC-738/739/740) ---
// The UI-first ordering + build-once dedupe that replaced the deleted `#MISE
// depends` edges now live in the run functions, not mise. Inject a capturing
// runner to pin the command SEQUENCE (not just each command string): the UI is
// built before the artifact that needs it, and skipped when the caller (the
// preflight gate) already built it.

/** A `runForward` stand-in that records each spawn instead of running it. */
function capturingRun() {
  const calls: Array<{ cmd: string[]; env: Record<string, string> | undefined }> = [];
  const run = async (
    cmd: string[],
    opts: { cwd?: string; env?: Record<string, string> } = {},
  ): Promise<number> => {
    calls.push({ cmd, env: opts.env });
    return 0;
  };
  return { calls, run };
}

/** Set CARET_SKIP_BUILD_UI for the duration of `fn`, restoring the prior value. */
async function withSkipUi(fn: () => Promise<void>): Promise<void> {
  const prev = process.env.CARET_SKIP_BUILD_UI;
  process.env.CARET_SKIP_BUILD_UI = "1";
  try {
    await fn();
  } finally {
    if (prev === undefined) delete process.env.CARET_SKIP_BUILD_UI;
    else process.env.CARET_SKIP_BUILD_UI = prev;
  }
}

describe("build bin: UI-first ordering + skip", () => {
  test("builds the UI before compiling the binary", async () => {
    const { calls, run } = capturingRun();
    expect(await buildBinArtifacts(run)).toBe(0);
    // First spawn is the Vite UI build; the compile follows it.
    expect(calls[0]?.cmd).toEqual(["bunx", "vite", "build"]);
    const compileAt = calls.findIndex((c) => c.cmd.includes("--compile"));
    expect(compileAt).toBeGreaterThan(0);
  });

  test("skips the UI build when CARET_SKIP_BUILD_UI is set", async () => {
    await withSkipUi(async () => {
      const { calls, run } = capturingRun();
      expect(await buildBinArtifacts(run)).toBe(0);
      // No Vite build at all; the first spawn is the manifest regen (a compile
      // prerequisite), so the already-built ui/dist is reused as-is.
      expect(calls.some((c) => c.cmd.includes("vite"))).toBe(false);
      expect(calls[0]?.cmd).toEqual(["bun", "scripts/generate-ui-manifest.ts"]);
    });
  });
});

describe("ensureUi: the shared skip contract", () => {
  test("returns 0 without building when CARET_SKIP_BUILD_UI is set", async () => {
    // No runner injected: if the skip failed, it would spawn a real Vite build
    // and hang/fail in the test env. Returning 0 proves the short-circuit.
    await withSkipUi(async () => {
      expect(await ensureUi()).toBe(0);
    });
  });
});

describe("smoke umbrella: build the UI once, skip it in each target", () => {
  test("builds the UI once, then runs bin + bundle with CARET_SKIP_BUILD_UI=1", async () => {
    const { calls, run } = capturingRun();
    expect(await smokePlan(run)).toBe(0);
    expect(calls.map((c) => c.cmd)).toEqual([
      ["bun", "scripts/tasks/cli.ts", "build", "ui"],
      ["bun", "scripts/tasks/cli.ts", "smoke", "bin"],
      ["bun", "scripts/tasks/cli.ts", "smoke", "bundle"],
    ]);
    // build ui carries no skip; both targets inherit it so they don't rebuild.
    expect(calls[0]?.env?.CARET_SKIP_BUILD_UI).toBeUndefined();
    expect(calls[1]?.env?.CARET_SKIP_BUILD_UI).toBe("1");
    expect(calls[2]?.env?.CARET_SKIP_BUILD_UI).toBe("1");
  });

  test("stops at the first failing target", async () => {
    const calls: string[][] = [];
    const run = async (cmd: string[]): Promise<number> => {
      calls.push(cmd);
      return cmd.includes("bin") ? 1 : 0; // build ui ok, smoke bin fails
    };
    expect(await smokePlan(run)).toBe(1);
    expect(calls).toEqual([
      ["bun", "scripts/tasks/cli.ts", "build", "ui"],
      ["bun", "scripts/tasks/cli.ts", "smoke", "bin"],
    ]); // bundle never runs
  });
});

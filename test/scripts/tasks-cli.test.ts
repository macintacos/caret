import { describe, expect, test } from "bun:test";

import type { JsonArgs } from "@scripts/preflight.ts";
import {
  buildBinArtifacts,
  buildBinCompileCommand,
  buildBundleCommand,
  buildInstallCommand,
  buildUiCommand,
  ensureBin,
  ensureUi,
  shouldBuildBin,
  shouldBuildUi,
} from "@/tasks/build.ts";
import { caretCommand } from "@/tasks/caret.ts";
import { buildProgram, type TaskActions } from "@/tasks/cli.ts";
import type { RunDevOptions } from "@/tasks/dev/run.ts";
import { formatCommand } from "@/tasks/format.ts";
import { lintCommand } from "@/tasks/lint.ts";
import { setupCommands } from "@/tasks/setup.ts";
import { smokePlan } from "@/tasks/smoke.ts";
import { e2eCommand, testCommand } from "@/tasks/test.ts";

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
  test("defaults: num-versions 4, notify false, persist false, fresh false", async () => {
    expect(await parseDevArgs([])).toEqual({
      numVersions: 4,
      notify: false,
      persist: false,
      fresh: false,
    });
  });

  test("parses --num-versions", async () => {
    expect(await parseDevArgs(["--num-versions", "5"])).toEqual({
      numVersions: 5,
      notify: false,
      persist: false,
      fresh: false,
    });
  });

  test("parses --notify", async () => {
    expect(await parseDevArgs(["--notify"])).toEqual({
      numVersions: 4,
      notify: true,
      persist: false,
      fresh: false,
    });
  });

  test("parses both flags together, in any order", async () => {
    expect(await parseDevArgs(["--notify", "--num-versions", "7"])).toEqual({
      numVersions: 7,
      notify: true,
      persist: false,
      fresh: false,
    });
  });

  test("parses --port, --state-dir, and --persist", async () => {
    expect(await parseDevArgs(["--port", "40000", "--state-dir", "/tmp/x", "--persist"])).toEqual({
      numVersions: 4,
      notify: false,
      port: 40000,
      stateDir: "/tmp/x",
      persist: true,
      fresh: false,
    });
  });

  test("parses --fresh", async () => {
    expect(await parseDevArgs(["--fresh"])).toEqual({
      numVersions: 4,
      notify: false,
      persist: false,
      fresh: true,
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
    [["caret"], "caret"],
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

  test("caret forwards a leading --help instead of answering it", async () => {
    // Every other passthrough keeps commander's built-in help: `mise run lint --help`
    // describing the forwarder is useful. Here the forwarder is the whole task, so
    // the help worth printing is caret's. passThroughOptions only forwards options
    // once an operand has been seen, so a LEADING --help needs helpOption(false) to
    // reach the tool; `caret install --help` already passes through on its own.
    expect(await parsePassthrough(["caret"], "caret", ["--help"])).toEqual(["--help"]);
    expect(await parsePassthrough(["caret"], "caret", ["-h"])).toEqual(["-h"]);
  });

  test("caret runs the CLI from source, never a built artifact", () => {
    // `bin/caret` execs `bin/caret-native` when a build produced one, so it can lag
    // the working tree. Running `src/cli.ts` is what makes this task match the
    // checkout, and is the whole reason it exists.
    expect(caretCommand([])).toEqual(["bun", "run", "src/cli.ts"]);
    expect(caretCommand(["install", "--dry-run"])).toEqual([
      "bun",
      "run",
      "src/cli.ts",
      "install",
      "--dry-run",
    ]);
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

  // The same contract one artifact up: the preflight gate compiles the binary as
  // its own task, then spawns `smoke` with CARET_SKIP_BUILD_BIN=1 so the smoke
  // targets reuse bin/caret-native instead of paying a second compile.
  test("shouldBuildBin is true by default, false only when CARET_SKIP_BUILD_BIN is set", () => {
    expect(shouldBuildBin({})).toBe(true);
    expect(shouldBuildBin({ CARET_SKIP_BUILD_BIN: "1" })).toBe(false);
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

  test("build --install forwards to the just-built caret; plain build does not", () => {
    expect(buildInstallCommand({ install: true })).toEqual([
      "bin/caret",
      "install",
      "--from-local",
    ]);
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

  // The palette generator sits after `bun install` because it runs through bun;
  // emitting the gitignored partial here is what makes the raw `bun test`
  // CONTRIBUTING.md documents work. On a fresh clone scripts/bootstrap.sh emits
  // it instead, which is why the bootstrapped branch below can skip it.
  test("setup runs the full four-step list when the bootstrap did not install", () => {
    expect(setupCommands({})).toEqual([
      ["mise", "install"],
      ["bun", "install"],
      ["bun", "ui/generate-palette-css.ts"],
      ["bunx", "playwright", "install", "chromium"],
    ]);
  });

  // scripts/bootstrap.sh runs those first three itself on a cold checkout and
  // exports CARET_BOOTSTRAPPED, so `mise run setup` on a fresh clone is left with
  // the one step the bootstrap deliberately skips.
  test("setup runs only the Chromium step when the bootstrap marker is set", () => {
    expect(setupCommands({ CARET_BOOTSTRAPPED: "1" })).toEqual([
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

/** Set `key` to "1" for the duration of `fn`, restoring the prior value. */
async function withEnv(key: string, fn: () => Promise<void>): Promise<void> {
  const prev = process.env[key];
  process.env[key] = "1";
  try {
    await fn();
  } finally {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
}

const withSkipUi = (fn: () => Promise<void>): Promise<void> => withEnv("CARET_SKIP_BUILD_UI", fn);
const withSkipBin = (fn: () => Promise<void>): Promise<void> => withEnv("CARET_SKIP_BUILD_BIN", fn);

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

  // `cp -R ui/dist bin/ui` copies INTO an existing bin/ui rather than replacing it,
  // so the second build onward lands the real tree at bin/ui/dist/ and strands the
  // FIRST build's index.html + assets/ at the top level. The beside-the-binary
  // fallback enumerates that top level, so it would serve a months-old index whose
  // hashed asset URLs resolve to nothing — worse than having no fallback at all.
  // Clearing the directory first is what keeps the copy idempotent.
  test("clears the beside-the-binary UI tree before copying, so it can't nest", async () => {
    const { calls, run } = capturingRun();
    expect(await buildBinArtifacts(run)).toBe(0);
    const rmAt = calls.findIndex((c) => c.cmd[0] === "rm" && c.cmd.includes("bin/ui"));
    const cpAt = calls.findIndex((c) => c.cmd[0] === "cp");
    expect(rmAt).toBeGreaterThanOrEqual(0);
    expect(cpAt).toBeGreaterThan(rmAt);
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

describe("ensureBin: the shared skip contract", () => {
  test("returns 0 without compiling when CARET_SKIP_BUILD_BIN is set", async () => {
    // The runner throws rather than being omitted: a real `build bin` also exits
    // 0, so an injected-nothing version of this test would PASS on a broken skip
    // while spawning a compile that rewrites src/ui-manifest.generated.ts,
    // bin/caret-native, and bin/ui from inside the unit suite. Reaching the
    // runner at all is the failure.
    await withSkipBin(async () => {
      expect(
        await ensureBin(() => {
          throw new Error("ensureBin spawned a build despite CARET_SKIP_BUILD_BIN");
        }),
      ).toBe(0);
    });
  });

  test("forwards to the tasks CLI's build bin when the skip is absent", async () => {
    const { calls, run } = capturingRun();
    expect(await ensureBin(run)).toBe(0);
    expect(calls.map((c) => c.cmd)).toEqual([["bun", "scripts/tasks/cli.ts", "build", "bin"]]);
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

  // Under the preflight gate the UI is already built, so the umbrella's own
  // leading `build ui` has to honour the same skip its targets inherit —
  // otherwise an in-gate smoke kicks a second full Vite build.
  test("skips its leading UI build when CARET_SKIP_BUILD_UI is set", async () => {
    await withSkipUi(async () => {
      const { calls, run } = capturingRun();
      expect(await smokePlan(run)).toBe(0);
      expect(calls.map((c) => c.cmd)).toEqual([
        ["bun", "scripts/tasks/cli.ts", "smoke", "bin"],
        ["bun", "scripts/tasks/cli.ts", "smoke", "bundle"],
      ]);
    });
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

// Drives the preflight orchestrator's task DAG through an injected fake
// spawner — no real mise tasks run. Asserts the scheduling contract from
// EXC-462: lint/test/build-ui start immediately, dependents wait on build-ui
// and dedupe it via MISE_TASK_SKIP, failures don't hide other results, and
// the summary surfaces failed output plus the `mise run format` hint. Also
// covers the `--json` mode (EXC-471): arg parsing (parseJsonArgs) and the
// report builders — the lean default (status + line counts), the -v/-vv
// verbosity ladder, --grep line filtering, --task scoping, and the error doc.
import { join } from "node:path";
import { expect, test } from "bun:test";
import {
  type SpawnOutcome,
  type SpawnTask,
  buildErrorReport,
  buildResultReport,
  buildStartReport,
  parseJsonArgs,
  parseJsonEnv,
  resolveJsonArgs,
  runPreflight,
} from "../../scripts/preflight.ts";
import { waitFor } from "../support/poll.ts";

const ALL_TASKS = ["build-bin", "build-ui", "lint", "test", "test-e2e"];

/** Fake spawner that resolves immediately from a per-task plan (default: pass). */
function fakeSpawner(plan?: Record<string, SpawnOutcome>) {
  const calls: Array<{ name: string; env: Record<string, string> | undefined }> = [];
  const spawnTask: SpawnTask = async (name, env, _onLine) => {
    calls.push({ name, env });
    return plan?.[name] ?? { exitCode: 0, output: `${name} ok` };
  };
  return { calls, spawnTask };
}

/** Fake spawner whose tasks hang until released, for asserting start order. */
function gatedSpawner() {
  const calls: string[] = [];
  const gates = new Map<string, (outcome: SpawnOutcome) => void>();
  const spawnTask: SpawnTask = (name, _env, _onLine) =>
    new Promise<SpawnOutcome>((resolve) => {
      calls.push(name);
      gates.set(name, resolve);
    });
  const release = (name: string, outcome: SpawnOutcome = { exitCode: 0, output: "" }) => {
    const gate = gates.get(name);
    if (!gate) throw new Error(`no gate for ${name}`);
    gate(outcome);
  };
  return { calls, release, spawnTask };
}

/** Resolve once `cond` holds (throws on timeout); the 1000ms budget keeps the
 * start-order assertions snappy. */
function waitForCond(cond: () => boolean, ms = 1000): Promise<true> {
  return waitFor(() => (cond() ? true : undefined), ms);
}

test("all tasks pass: exit 0, every task reported passed, build-ui spawned once", async () => {
  const { calls, spawnTask } = fakeSpawner();
  const r = await runPreflight({ spawnTask, renderer: "silent" });

  expect(r.exitCode).toBe(0);
  expect([...r.results.keys()].sort()).toEqual(ALL_TASKS);
  for (const result of r.results.values()) expect(result.status).toBe("passed");
  expect(calls.filter((c) => c.name === "build-ui")).toHaveLength(1);
  for (const name of ALL_TASKS) expect(r.summary).toContain(name);
});

test("lint, test, build-ui start immediately; dependents wait for build-ui", async () => {
  const s = gatedSpawner();
  const run = runPreflight({ spawnTask: s.spawnTask, renderer: "silent" });

  await waitForCond(() => s.calls.length === 3);
  await Bun.sleep(20); // would catch eagerly-spawned dependents
  expect([...s.calls].sort()).toEqual(["build-ui", "lint", "test"]);

  s.release("build-ui");
  await waitForCond(() => s.calls.length === 5);
  expect(s.calls).toContain("test-e2e");
  expect(s.calls).toContain("build-bin");

  for (const name of ["lint", "test", "test-e2e", "build-bin"]) s.release(name);
  const r = await run;
  expect(r.exitCode).toBe(0);
});

test("dependents get MISE_TASK_SKIP=build-ui; immediate tasks do not", async () => {
  const { calls, spawnTask } = fakeSpawner();
  await runPreflight({ spawnTask, renderer: "silent" });

  const envByName = new Map(calls.map((c) => [c.name, c.env]));
  expect(envByName.get("test-e2e")?.MISE_TASK_SKIP).toBe("build-ui");
  expect(envByName.get("build-bin")?.MISE_TASK_SKIP).toBe("build-ui");
  for (const name of ["lint", "test", "build-ui"]) {
    expect(envByName.get(name)?.MISE_TASK_SKIP).toBeUndefined();
  }
});

test("lint failure doesn't stop the others, exits 1, surfaces output and the format hint", async () => {
  const { calls, spawnTask } = fakeSpawner({
    lint: { exitCode: 1, output: "biome: src/x.ts needs formatting" },
  });
  const r = await runPreflight({ spawnTask, renderer: "silent" });

  expect(r.exitCode).toBe(1);
  expect(calls.map((c) => c.name).sort()).toEqual(ALL_TASKS);
  expect(r.results.get("lint")?.status).toBe("failed");
  expect(r.results.get("test")?.status).toBe("passed");
  expect(r.results.get("build-bin")?.status).toBe("passed");
  expect(r.summary).toContain("biome: src/x.ts needs formatting");
  expect(r.summary).toContain("mise run format");
});

test("the mise task files declare exactly the DAG preflight hard-codes", async () => {
  // Pins the MISE_TASK_SKIP contract AND guards against DAG growth: the
  // orchestrator hard-codes build-ui as the dependents' only shared dependency
  // (scripts/preflight.ts), rather than deriving the DAG from `mise tasks
  // --json` (decision recorded in EXC-506's PR). These assertions are the
  // lockstep edit that keeps that hard-coding honest — if a preflight task's
  // `depends` ever changes, this fails so the DAG gets updated alongside it.
  const dependsOf = async (name: string): Promise<string[]> => {
    const script = await Bun.file(join(import.meta.dir, "../../.mise/tasks", name)).text();
    const m = script.match(/^#MISE depends=(\[.*\])$/m);
    return m?.[1] ? (JSON.parse(m[1]) as string[]) : [];
  };
  // The two dependents depend on exactly build-ui (the edge preflight skips).
  expect(await dependsOf("test-e2e")).toEqual(["build-ui"]);
  expect(await dependsOf("build-bin")).toEqual(["build-ui"]);
  // The three immediate tasks declare no dependencies — any new edge here (a
  // task preflight runs concurrently growing a dependency) must trip this.
  for (const name of ["lint", "test", "build-ui"]) {
    expect(await dependsOf(name)).toEqual([]);
  }
});

test("build-ui failure skips its dependents and reports them as skipped", async () => {
  const { calls, spawnTask } = fakeSpawner({
    "build-ui": { exitCode: 1, output: "vite exploded" },
  });
  const r = await runPreflight({ spawnTask, renderer: "silent" });

  expect(r.exitCode).toBe(1);
  const names = calls.map((c) => c.name);
  expect(names).not.toContain("test-e2e");
  expect(names).not.toContain("build-bin");
  expect(r.results.get("build-ui")?.status).toBe("failed");
  expect(r.results.get("test-e2e")?.status).toBe("skipped");
  expect(r.results.get("build-bin")?.status).toBe("skipped");
  expect(r.summary).toContain("vite exploded");
});

// --json arg parsing (EXC-471) ----------------------------------------------

test("parseJsonArgs: --json sets json; absent leaves it false", () => {
  expect(parseJsonArgs(["bun", "preflight.ts", "--json"]).json).toBe(true);
  expect(parseJsonArgs(["bun", "preflight.ts"]).json).toBe(false);
});

test("parseJsonArgs: -v counts verbosity; -vv and repeated -v accumulate", () => {
  expect(parseJsonArgs(["bun", "p", "--json"]).verbosity).toBe(0);
  expect(parseJsonArgs(["bun", "p", "--json", "-v"]).verbosity).toBe(1);
  expect(parseJsonArgs(["bun", "p", "--json", "-vv"]).verbosity).toBe(2);
  expect(parseJsonArgs(["bun", "p", "--json", "-v", "-v"]).verbosity).toBe(2);
});

test("parseJsonArgs: --grep reads the next arg or the = form", () => {
  expect(parseJsonArgs(["bun", "p", "--json", "--grep", "err.*"]).grep).toBe("err.*");
  expect(parseJsonArgs(["bun", "p", "--json", "--grep=err.*"]).grep).toBe("err.*");
});

test("parseJsonArgs: --task is repeatable and accepts the = form", () => {
  expect(parseJsonArgs(["bun", "p", "--json", "--task", "test", "--task=lint"]).tasks).toEqual([
    "test",
    "lint",
  ]);
});

test("parseJsonArgs: an empty or missing --grep value is treated as no filter", () => {
  expect(parseJsonArgs(["bun", "p", "--json", "--grep="]).grep).toBeUndefined();
  expect(parseJsonArgs(["bun", "p", "--json", "--grep"]).grep).toBeUndefined();
});

test("parseJsonEnv: reads mise's usage_* vars (count, repeatable --task)", () => {
  const env = {
    usage_json: "true",
    usage_verbose: "2",
    usage_grep: "err",
    usage_task: "lint test",
  };
  expect(parseJsonEnv(env)).toEqual({
    json: true,
    verbosity: 2,
    grep: "err",
    tasks: ["lint", "test"],
  });
});

test("parseJsonEnv: unset vars default sensibly", () => {
  expect(parseJsonEnv({})).toEqual({ json: false, verbosity: 0, tasks: [] });
  expect(parseJsonEnv({ usage_json: "true", usage_task: "test" })).toEqual({
    json: true,
    verbosity: 0,
    tasks: ["test"],
  });
});

test("resolveJsonArgs: uses env when usage_json is set (mise spec path)", () => {
  // Under the mise usage spec the flags arrive as env vars and argv is empty.
  expect(resolveJsonArgs([], { usage_json: "true", usage_verbose: "1", usage_grep: "x" })).toEqual({
    json: true,
    verbosity: 1,
    grep: "x",
    tasks: [],
  });
});

test("resolveJsonArgs: parses argv when usage_json is absent (direct invocation)", () => {
  expect(resolveJsonArgs(["bun", "p", "--json", "-v"], {})).toEqual({
    json: true,
    verbosity: 1,
    tasks: [],
  });
});

// --json report builders (EXC-471) ------------------------------------------

test("buildStartReport echoes the parsed filters and lists planned tasks", () => {
  const start = buildStartReport({ json: true, verbosity: 2, grep: "err", tasks: ["test"] });
  expect(start.event).toBe("start");
  expect(start.schemaVersion).toBe(1);
  expect(start.tasks).toEqual(["lint", "test", "build-ui", "test-e2e", "build-bin"]);
  expect(start.filters).toEqual({ verbosity: 2, grep: "err", tasks: ["test"] });
});

test("buildStartReport: unset filters render as null/zero", () => {
  const start = buildStartReport({ json: true, verbosity: 0, tasks: [] });
  expect(start.filters).toEqual({ verbosity: 0, grep: null, tasks: null });
});

test("buildResultReport level 0: passing tasks carry status only", async () => {
  const { spawnTask } = fakeSpawner();
  const r = await runPreflight({ spawnTask, renderer: "silent" });
  const report = buildResultReport(r.results);

  expect(report.event).toBe("result");
  expect(report.schemaVersion).toBe(1);
  expect(report.ok).toBe(true);
  expect(report.tasks.map((t) => t.name)).toEqual([
    "lint",
    "test",
    "build-ui",
    "test-e2e",
    "build-bin",
  ]);
  for (const t of report.tasks) {
    expect(t.status).toBe("passed");
    expect(t.output).toBeUndefined();
    expect(t.totalLines).toBeUndefined();
    expect(t.truncated).toBeUndefined();
  }
});

test("buildResultReport level 0: a small failed output is shown in full (with lint hint)", async () => {
  const { spawnTask } = fakeSpawner({
    lint: { exitCode: 1, output: "boom: bad format" },
  });
  const r = await runPreflight({ spawnTask, renderer: "silent" });
  const report = buildResultReport(r.results);

  expect(report.ok).toBe(false);
  const lint = report.tasks.find((t) => t.name === "lint");
  expect(lint?.status).toBe("failed");
  // Failures show their output by default — small ones in full, untruncated.
  expect(lint?.output).toContain("boom: bad format");
  expect(lint?.output).toContain("mise run format");
  expect(lint?.truncated).toBeUndefined();
  expect(lint?.totalLines).toBeUndefined();
});

test("buildResultReport level 0: a large failed output is truncated to a tail", async () => {
  const big = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n");
  const { spawnTask } = fakeSpawner({ test: { exitCode: 1, output: big } });
  const r = await runPreflight({ spawnTask, renderer: "silent" });
  const report = buildResultReport(r.results);

  const test = report.tasks.find((t) => t.name === "test");
  expect(test?.status).toBe("failed");
  expect(test?.truncated).toBe(true);
  expect(test?.totalLines).toBe(30);
  const outLines = (test?.output ?? "").split("\n");
  expect(outLines).toHaveLength(20); // bounded tail
  expect(outLines[0]).toBe("line 11"); // last 20 of 30 → lines 11..30
  expect(outLines[19]).toBe("line 30");
});

test("buildResultReport -v: failures become full output, passing tasks gain a snippet", async () => {
  const big = Array.from({ length: 30 }, (_, i) => `fail ${i + 1}`).join("\n");
  const { spawnTask } = fakeSpawner({
    lint: { exitCode: 1, output: big },
    test: { exitCode: 0, output: "test detail" },
  });
  const r = await runPreflight({ spawnTask, renderer: "silent" });
  const report = buildResultReport(r.results, { verbosity: 1 });

  const lint = report.tasks.find((t) => t.name === "lint");
  const test = report.tasks.find((t) => t.name === "test");
  // -v turns the failure up to full, untruncated.
  expect(lint?.output).toContain("fail 1");
  expect(lint?.output).toContain("fail 30");
  expect(lint?.truncated).toBeUndefined();
  // -v also surfaces passing tasks (short → shown in full).
  expect(test?.status).toBe("passed");
  expect(test?.output).toContain("test detail");
});

test("buildResultReport -vv: passing tasks carry their output too", async () => {
  const { spawnTask } = fakeSpawner({
    test: { exitCode: 0, output: "ran 42 tests" },
  });
  const r = await runPreflight({ spawnTask, renderer: "silent" });
  const report = buildResultReport(r.results, { verbosity: 2 });

  const test = report.tasks.find((t) => t.name === "test");
  expect(test?.status).toBe("passed");
  expect(test?.output).toContain("ran 42 tests");
});

test("buildResultReport --grep: reduces output to matching lines with counts", async () => {
  const { spawnTask } = fakeSpawner({
    test: { exitCode: 1, output: "line a\nerror x\nline b\nerror y" },
  });
  const r = await runPreflight({ spawnTask, renderer: "silent" });
  const report = buildResultReport(r.results, { grep: /error/ });

  const test = report.tasks.find((t) => t.name === "test");
  expect(test?.output).toBe("error x\nerror y");
  expect(test?.matchedLines).toBe(2);
  expect(test?.totalLines).toBe(4);
});

test("buildResultReport --grep with no matches: matchedLines 0, no output text", async () => {
  const { spawnTask } = fakeSpawner({
    test: { exitCode: 1, output: "line a\nline b" },
  });
  const r = await runPreflight({ spawnTask, renderer: "silent" });
  const report = buildResultReport(r.results, { grep: /nope/ });

  const test = report.tasks.find((t) => t.name === "test");
  expect(test?.matchedLines).toBe(0);
  expect(test?.output).toBeUndefined();
  expect(test?.totalLines).toBe(2);
});

test("buildResultReport --task: scope alone surfaces the named task's output", async () => {
  const { spawnTask } = fakeSpawner({
    lint: { exitCode: 1, output: "lint boom" },
    test: { exitCode: 1, output: "test boom" },
  });
  const r = await runPreflight({ spawnTask, renderer: "silent" });
  // No verbosity: --task alone shows the named task in full.
  const report = buildResultReport(r.results, { tasks: ["test"] });

  const test = report.tasks.find((t) => t.name === "test");
  const lint = report.tasks.find((t) => t.name === "lint");
  expect(test?.output).toContain("test boom");
  expect(lint?.output).toBeUndefined();
  expect(lint?.totalLines).toBeUndefined();
});

test("buildResultReport --task: out-of-scope tasks stay quiet even at -vv", async () => {
  const { spawnTask } = fakeSpawner({
    lint: { exitCode: 0, output: "lint chatter" },
    test: { exitCode: 0, output: "test chatter" },
  });
  const r = await runPreflight({ spawnTask, renderer: "silent" });
  const report = buildResultReport(r.results, { tasks: ["test"], verbosity: 2 });

  const test = report.tasks.find((t) => t.name === "test");
  const lint = report.tasks.find((t) => t.name === "lint");
  expect(test?.output).toContain("test chatter"); // named + passing → shown
  expect(lint?.output).toBeUndefined(); // out of scope → quiet despite -vv
});

test("buildResultReport --grep: surfaces matching lines from a passing task too", async () => {
  const { spawnTask } = fakeSpawner({
    test: { exitCode: 0, output: "ok line\nwarn: deprecated api\nok line 2" },
  });
  const r = await runPreflight({ spawnTask, renderer: "silent" });
  const report = buildResultReport(r.results, { grep: /warn/ });

  const test = report.tasks.find((t) => t.name === "test");
  expect(test?.status).toBe("passed");
  expect(test?.output).toBe("warn: deprecated api");
  expect(test?.matchedLines).toBe(1);
});

test("buildResultReport: --grep composes within --task scope", async () => {
  const { spawnTask } = fakeSpawner({
    lint: { exitCode: 1, output: "lint error one\nlint clean" },
    test: { exitCode: 1, output: "test error two\ntest clean" },
  });
  const r = await runPreflight({ spawnTask, renderer: "silent" });
  const report = buildResultReport(r.results, { grep: /error/, tasks: ["test"] });

  const test = report.tasks.find((t) => t.name === "test");
  const lint = report.tasks.find((t) => t.name === "lint");
  expect(test?.output).toBe("test error two");
  expect(test?.matchedLines).toBe(1);
  // lint is out of scope, so --grep is not applied to it.
  expect(lint?.output).toBeUndefined();
  expect(lint?.matchedLines).toBeUndefined();
});

test("buildErrorReport: shape for an invalid --grep pattern", () => {
  const err = buildErrorReport("invalid --grep pattern: [");
  expect(err).toEqual({
    event: "error",
    schemaVersion: 1,
    message: "invalid --grep pattern: [",
  });
});

// runCli entrypoint (EXC-471) — exercised as a subprocess, like release-cli.test.ts.

test("runCli: an invalid --grep pattern emits an error doc on stdout and exits 2", async () => {
  const proc = Bun.spawn([process.execPath, "scripts/preflight.ts", "--json", "--grep", "["], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exit] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);

  expect(exit).toBe(2);
  expect(JSON.parse(stdout.trim())).toEqual({
    event: "error",
    schemaVersion: 1,
    message: "invalid --grep pattern: [",
  });
});

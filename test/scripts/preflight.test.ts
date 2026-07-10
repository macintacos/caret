// Drives the preflight orchestrator's task DAG through an injected fake
// spawner — no real mise tasks run. Asserts the scheduling contract from
// EXC-462: lint/test/`build ui` start immediately, dependents wait on `build ui`
// and dedupe it via CARET_SKIP_BUILD_UI, failures don't hide other results, and
// the summary surfaces failed output plus the `mise run format` hint. Also
// covers the `--json` mode (EXC-471): arg parsing (parseJsonArgs) and the
// report builders — the lean default (status + line counts), the -v/-vv
// verbosity ladder, --grep line filtering, --task scoping, and the error doc.

import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildErrorReport,
  buildResultReport,
  buildStartReport,
  createProcessGroupController,
  parseJsonArgs,
  parseJsonEnv,
  resolveJsonArgs,
  runPreflight,
  type SpawnOutcome,
  type SpawnTask,
  withoutMiseUsageVars,
} from "../../scripts/preflight.ts";
import { waitFor } from "../support/poll.ts";

const ALL_TASKS = ["build bin", "build ui", "lint", "test", "test e2e"];

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

test("all tasks pass: exit 0, every task reported passed, build ui spawned once", async () => {
  const { calls, spawnTask } = fakeSpawner();
  const r = await runPreflight({ spawnTask, renderer: "silent" });

  expect(r.exitCode).toBe(0);
  expect([...r.results.keys()].sort()).toEqual(ALL_TASKS);
  for (const result of r.results.values()) expect(result.status).toBe("passed");
  expect(calls.filter((c) => c.name === "build ui")).toHaveLength(1);
  for (const name of ALL_TASKS) expect(r.summary).toContain(name);
});

test("lint, test, build ui start immediately; dependents wait for build ui", async () => {
  const s = gatedSpawner();
  const run = runPreflight({ spawnTask: s.spawnTask, renderer: "silent" });

  await waitForCond(() => s.calls.length === 3);
  await Bun.sleep(20); // would catch eagerly-spawned dependents
  expect([...s.calls].sort()).toEqual(["build ui", "lint", "test"]);

  s.release("build ui");
  await waitForCond(() => s.calls.length === 5);
  expect(s.calls).toContain("test e2e");
  expect(s.calls).toContain("build bin");

  for (const name of ["lint", "test", "test e2e", "build bin"]) s.release(name);
  const r = await run;
  expect(r.exitCode).toBe(0);
});

test("dependents get CARET_SKIP_BUILD_UI=1; immediate tasks do not", async () => {
  const { calls, spawnTask } = fakeSpawner();
  await runPreflight({ spawnTask, renderer: "silent" });

  const envByName = new Map(calls.map((c) => [c.name, c.env]));
  expect(envByName.get("test e2e")?.CARET_SKIP_BUILD_UI).toBe("1");
  expect(envByName.get("build bin")?.CARET_SKIP_BUILD_UI).toBe("1");
  for (const name of ["lint", "test", "build ui"]) {
    expect(envByName.get(name)?.CARET_SKIP_BUILD_UI).toBeUndefined();
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
  expect(r.results.get("build bin")?.status).toBe("passed");
  expect(r.summary).toContain("biome: src/x.ts needs formatting");
  expect(r.summary).toContain("mise run format");
});

test("preflight's task groups map to real mise task files (consolidated, EXC-738)", async () => {
  // The orchestrator hard-codes its task set (IMMEDIATE/DEPENDENT) and spawns
  // each as `mise run <words…>`, whose FIRST word is the mise task file. The
  // UI-first ordering + skip that a mise `depends` edge once carried now live in
  // the tasks CLI (CARET_SKIP_BUILD_UI, asserted above and in tasks-cli.test.ts),
  // so there are no `depends` edges left to lockstep-check. This instead guards
  // the rename: `build ui`/`test e2e`/`build bin` must resolve to the `build` and
  // `test` group files, and the old per-variant files must be gone.
  const taskFile = (name: string): string => join(import.meta.dir, "../../.mise/tasks", name);
  const firstWords = [...new Set(ALL_TASKS.map((t) => t.split(" ", 1)[0] ?? t))];
  for (const group of firstWords) expect(existsSync(taskFile(group))).toBe(true);
  for (const gone of ["build-ui", "build-bin", "build-bundle", "test-e2e"]) {
    expect(existsSync(taskFile(gone))).toBe(false);
  }
});

test("the consolidated group task files declare no `#MISE depends` edge (concurrent-UI-build guard, EXC-738)", () => {
  // preflight builds the UI exactly once: it runs `build ui` itself and spawns
  // the dependents with CARET_SKIP_BUILD_UI=1. A `#MISE depends` edge on
  // build/test/smoke would run its dependency REGARDLESS of that env var,
  // re-introducing a second concurrent Vite build that races on ui/dist (the
  // exact regression the removed mise-depends lockstep assertion once tripped).
  // Guard against anyone adding one back.
  const taskFile = (name: string): string => join(import.meta.dir, "../../.mise/tasks", name);
  for (const group of ["build", "test", "smoke"]) {
    expect(readFileSync(taskFile(group), "utf8")).not.toContain("#MISE depends");
  }
});

test("every `.mise/tasks/*` forwarder to the tasks CLI sets `#MISE raw_args=true` (EXC-741)", () => {
  // Each forwarder execs `bun scripts/tasks/cli.ts <name> "$@"`, and the CLI owns
  // every flag and `--help`. `#MISE raw_args=true` makes mise pass arguments —
  // including a bare `--help` — straight through instead of intercepting them, so
  // `mise run <task> --help` reaches the CLI's real help. Guard that no forwarder
  // loses the directive. preflight is excluded on purpose: it is a TOML task in
  // mise.toml that needs mise's own usage spec (EXC-737), so it has no file here.
  const tasksDir = join(import.meta.dir, "../../.mise/tasks");
  const forwarders = readdirSync(tasksDir, { withFileTypes: true })
    // Skip any namespaced-task subdirectory (mise supports `foo:bar` dirs) so the
    // readFileSync below can't hit EISDIR; only plain task files can be forwarders.
    .filter((entry) => entry.isFile())
    .map((entry) => ({ name: entry.name, body: readFileSync(join(tasksDir, entry.name), "utf8") }))
    .filter((task) => task.body.includes("scripts/tasks/cli.ts"));
  // Guard against a glob/path bug making the loop vacuously pass.
  expect(forwarders.length).toBeGreaterThanOrEqual(8);
  for (const task of forwarders) {
    expect(task.body).toContain("#MISE raw_args=true");
  }
});

test("build ui failure skips its dependents and reports them as skipped", async () => {
  const { calls, spawnTask } = fakeSpawner({
    "build ui": { exitCode: 1, output: "vite exploded" },
  });
  const r = await runPreflight({ spawnTask, renderer: "silent" });

  expect(r.exitCode).toBe(1);
  const names = calls.map((c) => c.name);
  expect(names).not.toContain("test e2e");
  expect(names).not.toContain("build bin");
  expect(r.results.get("build ui")?.status).toBe("failed");
  expect(r.results.get("test e2e")?.status).toBe("skipped");
  expect(r.results.get("build bin")?.status).toBe("skipped");
  expect(r.summary).toContain("vite exploded");
});

// Process-group teardown + fail-fast (EXC-587) ------------------------------

// The falsifiable orphan test: a child spawned through the controller is its
// own process-group leader, so killAll reaps the WHOLE subtree — the child AND
// the `sleep` grandchild it forks — leaving nothing parented to launchd. This
// exercises the real teardown path without running the heavy task graph (the
// very thing that orphans processes), so it is fast and deterministic.
test("createProcessGroupController.killAll reaps a child and its grandchildren", async () => {
  const controller = createProcessGroupController(500);
  // bash forks a `sleep` grandchild, prints its PID, then waits — so the group
  // has two live members when we tear it down.
  const child = controller.spawn("bash", ["-c", "sleep 30 & echo $!; wait"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const grandPid = await new Promise<string>((resolve) => {
    let buf = "";
    child.stdout?.on("data", (c: Buffer) => {
      buf += c.toString();
      const nl = buf.indexOf("\n");
      if (nl !== -1) resolve(buf.slice(0, nl).trim());
    });
  });

  const alive = (pid: string | number) => Bun.spawnSync(["ps", "-p", String(pid)]).exitCode === 0;
  expect(alive(child.pid as number)).toBe(true);
  expect(alive(grandPid)).toBe(true);

  await controller.killAll();

  expect(alive(child.pid as number)).toBe(false);
  expect(alive(grandPid)).toBe(false);
  expect(controller.size).toBe(0);
});

// A failed spawn (binary off PATH, EMFILE) emits an async 'error' event, not a
// throw. The controller must absorb it so an unhandled 'error' can't crash the
// orchestrator, and the child must still self-clean from the registry. Without
// the controller's 'error' handler this test crashes the whole runner.
test("createProcessGroupController tolerates a failed spawn without crashing", async () => {
  const controller = createProcessGroupController(200);
  controller.spawn("caret-no-such-binary-xyz", ["x"], { stdio: ["ignore", "pipe", "pipe"] });
  await Bun.sleep(50); // let the async 'error' + 'close' fire
  expect(controller.size).toBe(0); // 'close' fired → registry self-cleaned, no crash

  // reap on a child that already errored must resolve, never reject (it is
  // awaited fire-and-forget on the abort path).
  const child = controller.spawn("caret-no-such-binary-xyz", ["x"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  await controller.reap(child); // would throw here if reap rejected
});

// Fail-fast: the first failing task aborts in-flight siblings, which are
// recorded `skipped` (not `failed`) so genuine failures stay honest. Fakes
// that complete normally never set `aborted`, which is why the report-all
// tests above stay green; this fake honors the abort signal to prove the path.
test("a failed task aborts in-flight siblings that honor the signal (recorded skipped)", async () => {
  const spawnTask: SpawnTask = (name, _env, _onLine, signal) =>
    new Promise<SpawnOutcome>((resolve) => {
      if (name === "lint") return resolve({ exitCode: 1, output: "lint boom" });
      if (name === "build ui") return resolve({ exitCode: 0, output: "" });
      // test, test e2e, build bin: stay in-flight until fail-fast aborts them.
      const abort = () => resolve({ exitCode: 143, output: "", aborted: true });
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    });
  const r = await runPreflight({ spawnTask, renderer: "silent" });

  expect(r.exitCode).toBe(1);
  expect(r.results.get("lint")?.status).toBe("failed");
  expect(r.results.get("test")?.status).toBe("skipped");
  expect(r.results.get("test e2e")?.status).toBe("skipped");
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

// Nested-task env sanitizing — the fork-bomb guard (see withoutMiseUsageVars).
// mise leaks the parent invocation's usage_* flag vars into nested `mise run`
// children (verified), so without stripping them a `mise run preflight --json`
// → `mise run test` → `bun test` → this file's `preflight --grep [` subprocess
// would read the leaked usage_json, ignore its argv, skip the invalid-grep
// exit(2), and recursively run the whole task graph.
test("withoutMiseUsageVars: drops every usage_* key, keeps the rest, applies extra", () => {
  expect(
    withoutMiseUsageVars(
      {
        PATH: "/bin",
        HOME: "/h",
        usage_json: "true",
        usage_verbose: "2",
        usage_grep: "[",
        usage_task: "test",
      },
      { CARET_SKIP_BUILD_UI: "1" },
    ),
  ).toEqual({ PATH: "/bin", HOME: "/h", CARET_SKIP_BUILD_UI: "1" });
});

test("withoutMiseUsageVars: extra wins over a kept key; undefined values are dropped", () => {
  expect(withoutMiseUsageVars({ FOO: "old", BAR: undefined }, { FOO: "new" })).toEqual({
    FOO: "new",
  });
});

// --json report builders (EXC-471) ------------------------------------------

test("buildStartReport echoes the parsed filters and lists planned tasks", () => {
  const start = buildStartReport({ json: true, verbosity: 2, grep: "err", tasks: ["test"] });
  expect(start.event).toBe("start");
  expect(start.schemaVersion).toBe(1);
  expect(start.tasks).toEqual(["lint", "test", "build ui", "test e2e", "build bin"]);
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
    "build ui",
    "test e2e",
    "build bin",
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

// A cold `bun` subprocess spawn (process start + the script's import graph)
// can take several seconds when the full suite runs its files concurrently on
// a busy machine, so this test gets a generous timeout rather than bun's 5s
// default — well clear of the spawn's worst case without masking a real hang.
const SUBPROCESS_SPAWN_TIMEOUT_MS = 30_000;

test(
  "runCli: an invalid --grep pattern emits an error doc on stdout and exits 2",
  async () => {
    // Hermetic env: strip any ambient usage_* so the spawned preflight parses
    // OUR `--grep [` argv, not a usage_json leaked from an outer `mise run
    // preflight --json`. Belt-and-suspenders with the spawnMiseTask fix — if
    // either were missing and this ran under that umbrella, the spawned preflight
    // would ignore the argv, run the real task graph, and fork-bomb the box.
    const proc = Bun.spawn([process.execPath, "scripts/preflight.ts", "--json", "--grep", "["], {
      env: withoutMiseUsageVars(process.env),
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
  },
  SUBPROCESS_SPAWN_TIMEOUT_MS,
);

// Drives the preflight orchestrator's task DAG through an injected fake
// spawner — no real mise tasks run. Asserts the scheduling contract from
// EXC-462: lint/test/build-ui start immediately, dependents wait on build-ui
// and dedupe it via MISE_TASK_SKIP, failures don't hide other results, and
// the summary surfaces failed output plus the `mise run format` hint.
import { join } from "node:path";
import { expect, test } from "bun:test";
import { type SpawnOutcome, type SpawnTask, runPreflight } from "../../scripts/preflight.ts";
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

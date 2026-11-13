// Pins the PR workflow's shape: the eight preflight tasks as separate least-privilege
// checks, each running its own `mise run` entry point, with every action ref locked.
import { expect, test } from "bun:test";

import { selectTasks } from "@scripts/preflight.ts";

type Step = { uses?: string; run?: string; with?: Record<string, unknown> };
type Job = {
  name: string;
  "runs-on": string;
  permissions: unknown;
  "timeout-minutes": unknown;
  if?: unknown;
  needs?: string | string[];
  strategy?: { matrix: { shard: number[] } };
  steps: Step[];
};

const ciYaml = await Bun.file(".github/workflows/ci.yml").text();
const workflow = Bun.YAML.parse(ciYaml) as {
  on: Record<string, { branches?: string[] }>;
  permissions: unknown;
  jobs: Record<string, Job>;
};
const jobs = Object.values(workflow.jobs ?? {});
const jobByName = (name: string) => jobs.find((job) => job.name === name);
const steps = jobs.flatMap((job) => job.steps);
const shardJob = workflow.jobs["test-e2e-shard"];
const e2eGate = jobByName("test e2e");

// CI is the local gate plus the one suite the local gate leaves out.
const TASKS = [...selectTasks(null).tasks, "test e2e"];

test("runs on pull requests and pushes to main only", () => {
  expect(Object.keys(workflow.on).sort()).toEqual(["pull_request", "push"]);
  expect(workflow.on.pull_request?.branches).toEqual(["main"]);
  expect(workflow.on.push?.branches).toEqual(["main"]);
});

test("never runs with the base repository's secrets", () => {
  expect(ciYaml).not.toContain("pull_request_target");
  expect(ciYaml).not.toContain("secrets.");
});

test("grants no top-level permissions", () => {
  expect(workflow.permissions).toEqual({});
});

test("has one required check per preflight task, and the e2e shards are not one", () => {
  const checks = jobs.filter((job) => job !== shardJob);
  expect(checks.map((job) => job.name).sort()).toEqual([...TASKS].sort());
  expect(TASKS).not.toContain(shardJob?.name);
});

test("every job is read-only, time-boxed, and unconditional but the e2e gate", () => {
  for (const job of jobs) {
    expect(job["runs-on"]).toBe("ubuntu-latest");
    expect(typeof job["timeout-minutes"]).toBe("number");
    if (job === e2eGate) continue;
    expect(job.permissions).toEqual({ contents: "read" });
    expect(job.if).toBeUndefined();
  }
  expect(e2eGate?.permissions).toEqual({});
  expect(e2eGate?.if).toBe("always()");
  expect(e2eGate?.needs).toBe("test-e2e-shard");
});

test("checkout never persists the token", () => {
  const checkouts = steps.filter((step) => step.uses?.startsWith("actions/checkout@"));
  expect(checkouts.length).toBe(TASKS.length);
  for (const step of checkouts) expect(step.with?.["persist-credentials"]).toBe(false);
});

test("jobs that consume build output wait for the job that builds it", () => {
  const idOf = (name: string) =>
    Object.entries(workflow.jobs).find(([, job]) => job.name === name)?.[0];
  expect(shardJob?.needs).toBe(idOf("build ui"));
  const expected: Record<string, string | undefined> = {
    "test e2e": "test-e2e-shard",
    "build bin": idOf("build ui"),
    smoke: idOf("build bin"),
  };
  for (const name of TASKS) expect(jobByName(name)?.needs).toBe(expected[name]);
});

test("each job runs its task's entry point", () => {
  for (const name of TASKS) {
    if (name === "test e2e") continue;
    const runs = jobByName(name)?.steps.map((step) => step.run ?? "") ?? [];
    expect(runs).toContain(`mise run ${name}`);
  }
});

test("the e2e shards together run the whole suite", () => {
  const shards = shardJob?.strategy?.matrix.shard ?? [];
  const run = shardJob?.steps.find((step) => step.run?.startsWith("mise run test e2e"))?.run;
  expect(run).toContain(`--shard=\${{ matrix.shard }}/${shards.length}`);
  expect(shards).toEqual(shards.map((_, i) => i + 1));
});

test("installs the same claude-code version as the publish workflow", async () => {
  const publishYaml = await Bun.file(".github/workflows/publish.yml").text();
  const claudeCodePin = /claude-code@[\w.-]+/;
  expect(ciYaml.match(claudeCodePin)?.[0]).toBe(publishYaml.match(claudeCodePin)?.[0]);
});

test("every action ref is in the actions lockfile", async () => {
  const lock = await Bun.file(".github/workflows/actions.lock").text();
  const refs = steps.flatMap((step) => (step.uses ? [step.uses.split(" ")[0] ?? ""] : []));
  expect(refs.length).toBeGreaterThan(0);
  for (const ref of refs) {
    const [repo, tag] = ref.split("@");
    expect(lock).toContain(`${repo?.split("/").slice(0, 2).join("/")}@${tag}`);
  }
});

test("mise is version-pinned and exactly one job saves its cache", () => {
  const mise = steps.filter((step) => step.uses?.startsWith("jdx/mise-action@"));
  expect(mise.length).toBe(TASKS.length);
  for (const step of mise) expect(step.with?.version).toBeDefined();
  expect(mise.filter((step) => step.with?.cache_save !== false).length).toBe(1);
});

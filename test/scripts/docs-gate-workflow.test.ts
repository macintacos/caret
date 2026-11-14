// Pins the docs-gate workflow's shape: a read-only pull_request check that pipes the PR's
// changed paths and labels into scripts/docs-gate.ts, with every action ref locked.
import { expect, test } from "bun:test";

type Step = {
  uses?: string;
  run?: string;
  shell?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
};

const gateYaml = await Bun.file(".github/workflows/docs-gate.yml").text();
const workflow = Bun.YAML.parse(gateYaml) as {
  on: { pull_request: { types: string[]; branches: string[] } };
  permissions: unknown;
  jobs: Record<string, { permissions?: unknown; steps: Step[] }>;
};
const jobs = Object.values(workflow.jobs);
const steps = jobs.flatMap((job) => job.steps);
const lock = Bun.YAML.parse(await Bun.file(".github/workflows/actions.lock").text()) as {
  workflows: Record<string, string[]>;
};

test("runs on pull requests against main, re-running on label changes", () => {
  expect(Object.keys(workflow.on)).toEqual(["pull_request"]);
  expect([...workflow.on.pull_request.types].sort()).toEqual([
    "labeled",
    "opened",
    "reopened",
    "synchronize",
    "unlabeled",
  ]);
  expect(workflow.on.pull_request.branches).toEqual(["main"]);
});

test("never runs with a write token", () => {
  expect(gateYaml).not.toContain("pull_request_target");
  expect(gateYaml).not.toContain("secrets.");
  expect(workflow.permissions).toEqual({ contents: "read", "pull-requests": "read" });
  expect(jobs.some((job) => job.permissions !== undefined)).toBe(false);
  const checkouts = steps.filter((step) => step.uses?.startsWith("actions/checkout@"));
  expect(checkouts.length).toBeGreaterThan(0);
  for (const step of checkouts) expect(step.with?.["persist-credentials"]).toBe(false);
});

test("pipes the PR's files and labels into the gate", () => {
  const gateStep = steps.find((step) => step.run?.includes("| bun scripts/docs-gate.ts"));
  expect(gateStep?.env?.PR_LABELS).toContain("github.event.pull_request.labels.*.name");
  expect(gateStep?.shell).toBe("bash");
});

test("every action ref is locked for this workflow", () => {
  const lockedRefs = lock.workflows[".github/workflows/docs-gate.yml"] ?? [];
  const refs = steps.flatMap((step) => (step.uses ? [step.uses] : []));
  expect(refs.length).toBeGreaterThan(0);
  for (const ref of refs) {
    const [repo, tag] = ref.split("@");
    expect(lockedRefs).toContain(`${repo?.split("/").slice(0, 2).join("/")}@${tag}`);
  }
});

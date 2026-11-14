// Pins the docs deploy workflow's trigger and its trust boundary: only the deploy job may
// touch Pages or mint an OIDC token, and every action is pinned by SHA.
import { expect, test } from "bun:test";

type Step = { uses?: string };
type Job = { permissions?: Record<string, string>; steps: Step[] };

const workflow = Bun.YAML.parse(await Bun.file(".github/workflows/docs.yml").text()) as {
  on: unknown;
  permissions: unknown;
  jobs: Record<string, Job>;
};

test("deploys on version tags and on manual dispatch", () => {
  expect(workflow.on).toEqual({ push: { tags: ["v*"] }, workflow_dispatch: null });
});

test("only the deploy job can write to Pages or mint an OIDC token", () => {
  expect(workflow.permissions).toEqual({});

  const privileged = Object.entries(workflow.jobs)
    .filter(
      ([, job]) => job.permissions?.pages === "write" || job.permissions?.["id-token"] === "write",
    )
    .map(([id]) => id);
  expect(privileged).toEqual(["deploy"]);

  expect(workflow.jobs.deploy?.permissions).toEqual({ pages: "write", "id-token": "write" });
  const deployUses = workflow.jobs.deploy?.steps.map((step) => step.uses ?? "") ?? [];
  expect(deployUses.some((uses) => uses.startsWith("actions/checkout@"))).toBe(false);
});

test("every action is pinned to a commit SHA", () => {
  const uses = Object.values(workflow.jobs).flatMap((job) =>
    job.steps.flatMap((step) => (step.uses ? [step.uses] : [])),
  );
  expect(uses.length).toBeGreaterThan(0);
  for (const ref of uses) expect(ref).toMatch(/@[0-9a-f]{40}$/);
});

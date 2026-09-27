// Pins the strings `finalize` uses to find the publish run and its stage id
// against the workflow file itself, so a rename fails here instead of mid-release.
import { expect, test } from "bun:test";

import { PUBLISH_WORKFLOW, STAGE_ID_ANNOTATION, STAGE_JOB } from "@/tasks/release/github.ts";

const workflow = Bun.YAML.parse(await Bun.file(`.github/workflows/${PUBLISH_WORKFLOW}`).text()) as {
  on: unknown;
  jobs: Record<string, { name?: string; steps: { run?: string }[] }>;
};

test("the publish workflow runs on version tag pushes only", () => {
  expect(workflow.on).toEqual({ push: { tags: ["v*"] } });
});

test("the stage job keeps its id as its display name", () => {
  const job = workflow.jobs[STAGE_JOB];
  expect(job).toBeDefined();
  expect(job?.name).toBeUndefined();
});

test("the stage job annotates the stage id under the title finalize reads", () => {
  const runs = workflow.jobs[STAGE_JOB]?.steps.map((step) => step.run ?? "") ?? [];
  expect(runs.some((script) => script.includes(`title=${STAGE_ID_ANNOTATION}::`))).toBe(true);
});

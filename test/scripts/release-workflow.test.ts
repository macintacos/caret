// Pins the publish workflow's shape: the strings `finalize` uses to find the run and its
// stage id, and the macOS job that builds the menubar app the package ships.
import { expect, test } from "bun:test";

import pkg from "@root/package.json" with { type: "json" };
import { PUBLISH_WORKFLOW, STAGE_ID_ANNOTATION, STAGE_JOB } from "@/tasks/release/github.ts";

type Step = { uses?: string; run?: string; with?: Record<string, unknown> };
type Job = {
  name?: string;
  "runs-on": string;
  needs?: string | string[];
  if?: string;
  "continue-on-error"?: unknown;
  permissions?: unknown;
  env?: Record<string, string>;
  steps: Step[];
};

const workflow = Bun.YAML.parse(await Bun.file(`.github/workflows/${PUBLISH_WORKFLOW}`).text()) as {
  on: unknown;
  jobs: Record<string, Job>;
};
const prCheck = Bun.YAML.parse(await Bun.file(".github/workflows/menubar.yml").text()) as {
  jobs: { menubar: Job };
};
const { menubar, build } = workflow.jobs;
const runs = (job: Job | undefined) => job?.steps.map((step) => step.run ?? "") ?? [];

test("the publish workflow runs on version tag pushes only", () => {
  expect(workflow.on).toEqual({ push: { tags: ["v*"] } });
});

test("the stage job keeps its id as its display name", () => {
  const job = workflow.jobs[STAGE_JOB];
  expect(job).toBeDefined();
  expect(job?.name).toBeUndefined();
});

test("the stage job annotates the stage id under the title finalize reads", () => {
  const scripts = runs(workflow.jobs[STAGE_JOB]);
  expect(scripts.some((script) => script.includes(`title=${STAGE_ID_ANNOTATION}::`))).toBe(true);
});

test("builds the menubar app on the image and Xcode the menubar PR check pins", () => {
  expect(menubar?.["runs-on"]).toBe(prCheck.jobs.menubar["runs-on"]);
  expect(menubar?.env?.DEVELOPER_DIR).toBe(prCheck.jobs.menubar.env?.DEVELOPER_DIR);
  expect(runs(menubar)).toContain("mise run build menubar");
});

test("checks the app is universal and signed, then tars it for the build job", () => {
  const steps = runs(menubar);
  const built = steps.indexOf("mise run build menubar");
  const check = steps.findIndex((run) => run.includes("codesign --verify --deep --strict"));
  const tarred = steps.findIndex((run) => run.includes("-czf caret-menubar.app.tgz"));
  const upload =
    menubar?.steps.findIndex((step) => step.uses?.startsWith("actions/upload-artifact@")) ?? -1;
  expect(check).toBeGreaterThan(built);
  expect(steps[check]).toContain("-verify_arch arm64");
  expect(steps[check]).toContain("-verify_arch x86_64");
  expect(tarred).toBeGreaterThan(check);
  expect(steps[tarred]).toContain("--no-mac-metadata");
  expect(upload).toBeGreaterThan(tarred);
});

test("the release fails when the menubar job fails", () => {
  expect([build?.needs].flat()).toContain("menubar");
  expect(menubar?.if).toBeUndefined();
  expect(menubar?.["continue-on-error"]).toBeUndefined();
});

test("the menubar job reads only, with no credentials and no cache", () => {
  expect(menubar?.permissions).toEqual({ contents: "read" });
  const using = (prefix: string) =>
    menubar?.steps.filter((step) => step.uses?.startsWith(prefix)) ?? [];
  const checkouts = using("actions/checkout@");
  const mises = using("jdx/mise-action@");
  expect(checkouts).toHaveLength(1);
  expect(mises).toHaveLength(1);
  for (const step of checkouts) expect(step.with?.["persist-credentials"]).toBe(false);
  for (const step of mises) expect(step.with?.cache).toBe(false);
});

test("every action in the publish workflow is pinned to a commit SHA, and none is a cache", () => {
  const refs = Object.values(workflow.jobs).flatMap((job) =>
    job.steps.flatMap((step) => (step.uses ? [step.uses] : [])),
  );
  expect(refs.length).toBeGreaterThan(0);
  for (const ref of refs) {
    expect(ref).toMatch(/@[0-9a-f]{40}$/);
    expect(ref.startsWith("actions/cache@")).toBe(false);
  }
});

test("the build job unpacks the app before npm pack, then fails the release without it", () => {
  const steps = runs(build);
  const download =
    build?.steps.findIndex((step) => step.uses?.startsWith("actions/download-artifact@")) ?? -1;
  const unpack = steps.findIndex(
    (run) => run.startsWith("tar -xzf") && run.includes("caret-menubar.app.tgz"),
  );
  const pack = steps.indexOf("npm pack --ignore-scripts");
  const check = steps.findIndex(
    (run) => run.includes("test -x") && run.includes("caret-menubar.app"),
  );
  expect(download).toBeGreaterThanOrEqual(0);
  expect(unpack).toBeGreaterThan(download);
  expect(pack).toBeGreaterThan(unpack);
  expect(check).toBeGreaterThan(pack);
  expect(steps[check]).toContain("_CodeSignature/CodeResources");
});

test("the build job downloads the artifact and file the menubar job uploads", () => {
  const upload = menubar?.steps.find((step) => step.uses?.startsWith("actions/upload-artifact@"));
  const download = build?.steps.find((step) => step.uses?.startsWith("actions/download-artifact@"));
  const name = upload?.with?.name;
  expect(typeof name === "string" && name.length > 0).toBe(true);
  expect(download?.with?.name).toBe(name);
  const unpack = runs(build).find((run) => run.startsWith("tar -xzf"));
  expect(unpack).toContain(String(upload?.with?.path));
});

test("package.json ships the menubar app", () => {
  expect(pkg.files).toContain("bin/caret-menubar.app");
});

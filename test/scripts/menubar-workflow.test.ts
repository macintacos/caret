// Pins the menubar workflow's shape: a read-only pull_request check that builds and tests
// the macOS menubar app on a pinned Xcode, only when a PR touches the app, its build or test
// task, or this workflow, with every action ref locked.
import { expect, test } from "bun:test";

type Step = {
  id?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
};
type Job = {
  "runs-on": string;
  needs?: string;
  if?: string;
  permissions?: unknown;
  env?: Record<string, string>;
  steps: Step[];
};

const yaml = await Bun.file(".github/workflows/menubar.yml").text();
const workflow = Bun.YAML.parse(yaml) as {
  on: { pull_request: { branches: string[] } };
  permissions: unknown;
  jobs: { changes: Job; menubar: Job };
};
const { changes, menubar } = workflow.jobs;
const lock = Bun.YAML.parse(await Bun.file(".github/workflows/actions.lock").text()) as {
  workflows: Record<string, string[]>;
};

test("runs on pull requests against main only", () => {
  expect(Object.keys(workflow.on)).toEqual(["pull_request"]);
  expect(workflow.on.pull_request.branches).toEqual(["main"]);
});

test("never runs with a write token", () => {
  expect(yaml).not.toContain("pull_request_target");
  expect(yaml).not.toContain("secrets.");
  expect(workflow.permissions).toEqual({});
  expect(changes.permissions).toEqual({ "pull-requests": "read" });
  expect(menubar.permissions).toEqual({ contents: "read" });
  const checkouts = menubar.steps.filter((step) => step.uses?.startsWith("actions/checkout@"));
  expect(checkouts.length).toBeGreaterThan(0);
  for (const step of checkouts) expect(step.with?.["persist-credentials"]).toBe(false);
});

test("builds only when the app, its build or test task, or this workflow changed", () => {
  expect(menubar.needs).toBe("changes");
  expect(menubar.if?.match(/^\$\{\{ (.*) \}\}$/)?.[1]).toBe(
    "!cancelled() && needs.changes.outputs.menubar != 'false'",
  );
  const run = changes.steps.find((step) => step.id === "paths")?.run ?? "";
  const pattern = run.match(/grep -qE '([^']+)'/)?.[1];
  expect(pattern).toBeDefined();
  const touches = new RegExp(pattern ?? "$^");
  for (const path of [
    "menubar/Package.swift",
    "menubar/Sources/CaretMenubar/main.swift",
    "scripts/tasks/build.ts",
    ".mise/tasks/build",
    "scripts/tasks/test.ts",
    ".mise/tasks/test",
    ".github/workflows/menubar.yml",
  ]) {
    expect(touches.test(path)).toBe(true);
  }
  for (const path of [
    "src/cli.ts",
    "scripts/tasks/cli.ts",
    "docs/DEVELOPMENT.md",
    ".github/workflows/ci.yml",
  ]) {
    expect(touches.test(path)).toBe(false);
  }
});

test("builds and tests on macOS with a pinned Xcode", () => {
  expect(menubar["runs-on"]).toBe("macos-26");
  expect(menubar.env?.DEVELOPER_DIR).toMatch(
    /^\/Applications\/Xcode_[\d.]+\.app\/Contents\/Developer$/,
  );
  const runs = menubar.steps.map((step) => step.run);
  expect(runs).toContain("mise run build menubar");
  expect(runs).toContain("mise run test swift");
  expect(runs).toContain("swift format lint --strict --recursive menubar");
});

test("checks the assembled bundle launches its declared executable", () => {
  const runs = menubar.steps.map((step) => step.run ?? "");
  const build = runs.indexOf("mise run build menubar");
  const check = runs.findIndex((run) => run.includes("CFBundleExecutable"));
  expect(check).toBeGreaterThan(build);
  expect(runs[check]).toContain("plutil -lint");
  expect(runs[check]).toContain("test -x");
});

test("every action ref is locked for this workflow", () => {
  const lockedRefs = lock.workflows[".github/workflows/menubar.yml"] ?? [];
  const refs = menubar.steps.flatMap((step) => (step.uses ? [step.uses] : []));
  expect(refs.length).toBeGreaterThan(0);
  for (const ref of refs) {
    const [repo, tag] = ref.split("@");
    expect(lockedRefs).toContain(`${repo?.split("/").slice(0, 2).join("/")}@${tag}`);
  }
});

test("checks the bundle is universal, signed, and built for macOS 13, after the launchable check", () => {
  const runs = menubar.steps.map((step) => step.run ?? "");
  const launchable = runs.findIndex((run) => run.includes("CFBundleExecutable"));
  const universal = runs.findIndex((run) => run.includes("-verify_arch"));
  const floor = runs.findIndex((run) => run.includes("vtool -show-build"));
  expect(universal).toBeGreaterThan(launchable);
  expect(floor).toBeGreaterThan(launchable);
  expect(runs[universal]).toContain(
    "lipo bin/caret-menubar.app/Contents/MacOS/CaretMenubar -verify_arch arm64",
  );
  expect(runs[universal]).toContain(
    "lipo bin/caret-menubar.app/Contents/MacOS/CaretMenubar -verify_arch x86_64",
  );
  expect(runs[universal]).toContain("codesign --verify --deep --strict bin/caret-menubar.app");
  expect(runs[floor]).toContain("minos");
  expect(runs[floor]).toContain("13.0");
});

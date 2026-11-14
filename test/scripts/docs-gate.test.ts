import { describe, expect, test } from "bun:test";

import {
  docsGateReport,
  excludedFromSite,
  SKIP_LABEL,
  userVisibleSurface,
} from "@scripts/docs-gate.ts";

const excluded = excludedFromSite(await Bun.file("zensical.toml").text());

describe("docsGateReport", () => {
  test("fails a user-visible change with no page change", () => {
    const report = docsGateReport(["src/cli.ts"], [], excluded);
    expect(report).toContain("src/cli.ts (CLI commands");
    expect(report).toContain("docs-not-needed");
  });

  test("passes once a published page changes too", () => {
    expect(docsGateReport(["src/cli.ts", "docs/how-to/install.md"], [], excluded)).toBeNull();
  });

  test("fails when the only pages changed are ones the site excludes", () => {
    const changed = [
      "src/config/settings.ts",
      "docs/DEVELOPMENT.md",
      "docs/agents/settings-rules.md",
    ];
    expect(docsGateReport(changed, [], excluded)).not.toBeNull();
  });

  test("passes a change no user sees, a dependency-only bump among them", () => {
    const changed = [
      "package.json",
      "bun.lock",
      "mise.lock",
      "scripts/preflight.ts",
      "src/cli.test.ts",
      "ui/src/lib/foo.svelte.test.ts",
    ];
    expect(docsGateReport(changed, [], excluded)).toBeNull();
  });

  test("fails empty input, labelled or not", () => {
    expect(docsGateReport([], [], excluded)).toContain("no changed paths");
    expect(docsGateReport([], [SKIP_LABEL], excluded)).toContain("no changed paths");
  });

  test("passes once docs-not-needed is added after a failing run", () => {
    expect(docsGateReport(["ui/src/App.svelte"], [], excluded)).not.toBeNull();
    expect(docsGateReport(["ui/src/App.svelte"], ["bug", SKIP_LABEL], excluded)).toBeNull();
  });

  test("a published asset is not a page", () => {
    expect(
      docsGateReport(["src/theme/schema.ts", "docs/theme.schema.json"], [], excluded),
    ).not.toBeNull();
  });
});

describe("userVisibleSurface", () => {
  test("counts CLI help text and caret install output", () => {
    expect(userVisibleSurface("src/cli.ts")).not.toBeNull();
    expect(userVisibleSurface("src/commands/install/claude.ts")).not.toBeNull();
    expect(userVisibleSurface("src/adapters/pi/install.ts")).not.toBeNull();
    expect(userVisibleSurface("src/adapters/pi/host.ts")).toBeNull();
    expect(userVisibleSurface("src/daemon/server.ts")).toBeNull();
  });
});

describe("excludedFromSite", () => {
  test("reads zensical.toml", () => {
    expect(excluded("docs/agents/settings-rules.md")).toBe(true);
    expect(excluded("docs/DEVELOPMENT.md")).toBe(true);
    expect(excluded("docs/how-to/install.md")).toBe(false);
    expect(excluded("docs/reference/glossary.md")).toBe(false);
  });

  test("throws on a pattern it cannot read", () => {
    expect(() => excludedFromSite('[project]\nexclude_docs = """\n*.draft.md\n"""\n')).toThrow(
      "*.draft.md",
    );
  });
});

describe("the entry point", () => {
  async function run(labels: string): Promise<{ code: number; stdout: string }> {
    const proc = Bun.spawn(["bun", "scripts/docs-gate.ts"], {
      stdin: new TextEncoder().encode("src/cli.ts\n"),
      stdout: "pipe",
      env: { ...process.env, PR_LABELS: labels },
    });
    const stdout = await new Response(proc.stdout).text();
    return { code: await proc.exited, stdout };
  }

  test("fails with a workflow error annotation", async () => {
    const { code, stdout } = await run("[]");
    expect(code).toBe(1);
    expect(stdout).toContain("::error::docs gate:");
  });

  test("passes silently with the skip label", async () => {
    const { code, stdout } = await run('["docs-not-needed"]');
    expect(code).toBe(0);
    expect(stdout).toBe("");
  });
});

type GateStep = {
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
};

const gateYaml = await Bun.file(".github/workflows/docs-gate.yml")
  .text()
  .catch(() => "");
const gateWorkflow = (Bun.YAML.parse(gateYaml) ?? {}) as {
  on?: { pull_request?: { types?: string[]; branches?: string[] } };
  permissions?: unknown;
  jobs?: Record<string, { permissions?: unknown; steps: GateStep[] }>;
};
const gateJobs = Object.values(gateWorkflow.jobs ?? {});
const gateSteps = gateJobs.flatMap((job) => job.steps);
const actionsLock = await Bun.file(".github/workflows/actions.lock").text();

describe("docs-gate.yml", () => {
  test("runs on pull requests against main, re-running on label changes", () => {
    expect(Object.keys(gateWorkflow.on ?? {})).toEqual(["pull_request"]);
    expect([...(gateWorkflow.on?.pull_request?.types ?? [])].sort()).toEqual([
      "labeled",
      "opened",
      "reopened",
      "synchronize",
      "unlabeled",
    ]);
    expect(gateWorkflow.on?.pull_request?.branches).toEqual(["main"]);
  });

  test("never runs with a write token", () => {
    expect(gateYaml).not.toContain("pull_request_target");
    expect(gateYaml).not.toContain("secrets.");
    expect(gateWorkflow.permissions).toEqual({ contents: "read", "pull-requests": "read" });
    expect(gateJobs.some((job) => job.permissions !== undefined)).toBe(false);
    const checkouts = gateSteps.filter((step) => step.uses?.startsWith("actions/checkout@"));
    expect(checkouts.length).toBeGreaterThan(0);
    for (const step of checkouts) expect(step.with?.["persist-credentials"]).toBe(false);
  });

  test("pipes the PR's files and labels into the gate", () => {
    const gate = gateSteps.find((step) => step.run?.includes("| bun scripts/docs-gate.ts"));
    expect(gate?.env?.PR_LABELS).toContain("github.event.pull_request.labels.*.name");
  });

  test("every action ref is locked for this workflow", () => {
    expect(actionsLock).toContain("'.github/workflows/docs-gate.yml':");
    const refs = gateSteps.flatMap((step) => (step.uses ? [step.uses.split(" ")[0] ?? ""] : []));
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      const [repo, tag] = ref.split("@");
      expect(actionsLock).toContain(`${repo?.split("/").slice(0, 2).join("/")}@${tag}`);
    }
  });
});

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

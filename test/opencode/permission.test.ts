// OpenCode v2 gives a plugin no way to raise a permission ask, so caret evaluates the
// agent's edit rules itself before writing a plan back to `path`, and refuses unless
// every rule OpenCode would check evaluates to allow.

import { describe, expect, test } from "bun:test";

import {
  editChecks,
  editPermitted,
  evaluate,
  type Rule,
  wildcardMatch,
} from "@opencode/permission.ts";

const HOME = "/home/u";
const PROJECT = { directory: "/work/app", projectDirectory: "/work/app" };

describe("wildcardMatch", () => {
  test("* crosses path separators", () => {
    expect(wildcardMatch(`${HOME}/.opencode/plan/a/b.md`, `${HOME}/.opencode/plan/*`)).toBe(true);
  });

  test('a trailing " *" also matches the bare command', () => {
    expect(wildcardMatch("git", "git *")).toBe(true);
    expect(wildcardMatch("git status", "git *")).toBe(true);
    expect(wildcardMatch("gitx", "git *")).toBe(false);
  });

  test("regex metacharacters in a pattern are literal", () => {
    expect(wildcardMatch("a.md", "a.md")).toBe(true);
    expect(wildcardMatch("axmd", "a.md")).toBe(false);
  });
});

describe("evaluate", () => {
  test("the last matching rule wins", () => {
    const rules: Rule[] = [
      { action: "edit", resource: "*", effect: "deny" },
      { action: "edit", resource: "*.md", effect: "allow" },
    ];
    expect(evaluate("edit", "x.md", rules).effect).toBe("allow");
    expect(evaluate("edit", "x.ts", rules).effect).toBe("deny");
  });

  test("no matching rule asks", () => {
    expect(evaluate("edit", "x.md", []).effect).toBe("ask");
  });

  test("a later ruleset outranks an earlier one", () => {
    const agent: Rule[] = [{ action: "edit", resource: "*", effect: "allow" }];
    const session: Rule[] = [{ action: "edit", resource: "*", effect: "deny" }];
    expect(evaluate("edit", "x.md", agent, session).effect).toBe("deny");
  });
});

describe("editChecks", () => {
  test("a path inside the project is checked as a relative edit", () => {
    expect(editChecks("/work/app/docs/plan.md", PROJECT)).toEqual([
      { action: "edit", resource: "docs/plan.md" },
    ]);
  });

  test("a path inside the project root but outside the directory is still internal", () => {
    expect(
      editChecks("/work/app/other/plan.md", {
        directory: "/work/app/pkg",
        projectDirectory: "/work/app",
      }),
    ).toEqual([{ action: "edit", resource: "../other/plan.md" }]);
  });

  test("a path outside the project is an absolute edit plus its external directory", () => {
    expect(editChecks("/notes/plan.md", PROJECT)).toEqual([
      { action: "edit", resource: "/notes/plan.md" },
      { action: "external_directory", resource: "/notes/*" },
    ]);
  });

  test("a project at the filesystem root does not make every path internal", () => {
    expect(
      editChecks("/notes/plan.md", { directory: "/work", projectDirectory: "/" }),
    ).toHaveLength(2);
  });
});

describe("editPermitted", () => {
  const allowAll: Rule[] = [{ action: "*", resource: "*", effect: "allow" }];

  test("ask and deny both refuse", () => {
    for (const effect of ["ask", "deny"] as const) {
      const rules: Rule[] = [...allowAll, { action: "edit", resource: "*", effect }];
      expect(editPermitted("/work/app/plan.md", PROJECT, { agent: rules, session: [] })).toBe(
        false,
      );
    }
  });

  const planAgent: Rule[] = [
    { action: "edit", resource: "*", effect: "deny" },
    { action: "edit", resource: `${HOME}/.opencode/plan/*`, effect: "allow" },
    { action: "external_directory", resource: `${HOME}/.opencode/plan/*`, effect: "allow" },
  ];

  test("v2's plan agent may write in its plan dir", () => {
    expect(
      editPermitted(`${HOME}/.opencode/plan/x.md`, PROJECT, { agent: planAgent, session: [] }),
    ).toBe(true);
  });

  test("v2's plan agent may not write elsewhere", () => {
    expect(editPermitted("/work/app/plan.md", PROJECT, { agent: planAgent, session: [] })).toBe(
      false,
    );
    expect(editPermitted("/notes/plan.md", PROJECT, { agent: planAgent, session: [] })).toBe(false);
  });

  const stockAgent: Rule[] = [
    { action: "*", resource: "*", effect: "allow" },
    { action: "external_directory", resource: "*", effect: "ask" },
  ];

  test("stock agent rules permit an in-project file", () => {
    expect(editPermitted("/work/app/plan.md", PROJECT, { agent: stockAgent, session: [] })).toBe(
      true,
    );
  });

  test("stock agent rules refuse an out-of-project file", () => {
    expect(editPermitted("/notes/plan.md", PROJECT, { agent: stockAgent, session: [] })).toBe(
      false,
    );
  });

  test("session rules outrank agent rules", () => {
    const session: Rule[] = [{ action: "edit", resource: "*", effect: "deny" }];
    expect(
      editPermitted("/work/app/plan.md", PROJECT, { agent: stockAgent, session: session }),
    ).toBe(false);
  });
});

// The resources `editChecks` forms — the same ones OpenCode v2 checks before its own tools
// edit a file — for caret to `permission.assert` before writing a plan back to `path`.

import { describe, expect, test } from "bun:test";

import { editChecks } from "@oc/permission.ts";

const PROJECT = { directory: "/work/app", projectDirectory: "/work/app" };

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

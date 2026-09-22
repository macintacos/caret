// Standing gate for the test/core boundary in `doc/agents/test-layout.md`: a core
// suite injects an agent's capabilities rather than importing the Claude adapter
// or spelling its PermissionRequest wire shape.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..");

const CLAUDE_ADAPTER = "@/adapters/claude";
const WIRE_SHAPE = "hookSpecificOutput";

/**
 * What in `source` breaks the boundary: a `from`, side-effect, or dynamic import
 * of the Claude adapter, or the Claude wire shape's key. Raw source is scanned,
 * so a mention in a comment fails too — reword the prose.
 *
 * The regex is byte-identical to the ones in import-conventions.test.ts and
 * dependency-placement.test.ts; harden all three or none.
 */
function boundaryViolations(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(/(?<!@)\b(?:from|import)\s*\(?\s*"([^"]+)"/g)) {
    const spec = match[1];
    if (spec?.startsWith(CLAUDE_ADAPTER)) found.push(spec);
  }
  if (source.includes(WIRE_SHAPE)) found.push(WIRE_SHAPE);
  return found;
}

test("no test/core suite imports the Claude adapter or names its wire shape", () => {
  const violations: string[] = [];
  for (const found of new Bun.Glob("**/*.ts").scanSync({ cwd: join(REPO_ROOT, "test/core") })) {
    const repoPath = `test/core/${found}`;
    const source = readFileSync(join(REPO_ROOT, repoPath), "utf-8");
    for (const hit of boundaryViolations(source)) violations.push(`${repoPath}: ${hit}`);
  }
  expect(violations).toEqual([]);
});

test("the rule reads side-effect and dynamic imports as well as the from form", () => {
  const spec = `${CLAUDE_ADAPTER}/approve.ts`;
  expect(boundaryViolations(`import { X } from "${spec}";`)).toEqual([spec]);
  expect(boundaryViolations(`import "${spec}";`)).toEqual([spec]);
  expect(boundaryViolations(`await import("${spec}")`)).toEqual([spec]);
  expect(boundaryViolations(`import { Y } from "@/adapters/adapter.ts";`)).toEqual([]);
});

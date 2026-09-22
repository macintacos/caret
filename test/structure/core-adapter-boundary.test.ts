// Standing gate for the test/core boundary in `doc/agents/test-layout.md`: a core
// suite injects an agent's capabilities rather than importing an adapter, and spells
// none of the Claude vocabulary the rule lists.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { importSpecifiers } from "@test/support/import-specifiers.ts";

const REPO_ROOT = join(import.meta.dir, "..", "..");

const ADAPTERS = "@/adapters/";
/** The `AgentAdapter` interface is core vocabulary, not an adapter. */
const ADAPTER_INTERFACE = "@/adapters/adapter.ts";
/** The registry-contract suites exist to name every agent, so they may import the
 * registries that do. */
const REGISTRY_SUITES = new Set([
  "test/core/adapters/adapter.test.ts",
  "test/core/commands/install/targets.test.ts",
]);
/** The PermissionRequest wire key, the Claude mode tokens, and the plugin id. */
const CLAUDE_VOCABULARY = ["hookSpecificOutput", "acceptEdits", '"auto"', "caret@caret"];

/**
 * What in `source` breaks the boundary: an import of an adapter module (unless
 * `mayImportRegistries`), or a Claude vocabulary literal. Raw source is scanned, so
 * a mention in a comment fails too — reword the prose.
 */
function boundaryViolations(source: string, mayImportRegistries = false): string[] {
  const imports = mayImportRegistries
    ? []
    : importSpecifiers(source).filter((s) => s.startsWith(ADAPTERS) && s !== ADAPTER_INTERFACE);
  return [...imports, ...CLAUDE_VOCABULARY.filter((word) => source.includes(word))];
}

test("no test/core suite imports an adapter or spells Claude vocabulary", () => {
  const violations: string[] = [];
  for (const found of new Bun.Glob("**/*.ts").scanSync({ cwd: join(REPO_ROOT, "test/core") })) {
    const repoPath = `test/core/${found}`;
    const source = readFileSync(join(REPO_ROOT, repoPath), "utf-8");
    for (const hit of boundaryViolations(source, REGISTRY_SUITES.has(repoPath))) {
      violations.push(`${repoPath}: ${hit}`);
    }
  }
  expect(violations).toEqual([]);
});

test("the rule reads every import form and exempts only the adapter interface", () => {
  const spec = "@/adapters/opencode/paths.ts";
  expect(boundaryViolations(`import { X } from "${spec}";`)).toEqual([spec]);
  expect(boundaryViolations(`import "${spec}";`)).toEqual([spec]);
  expect(boundaryViolations(`await import("${spec}")`)).toEqual([spec]);
  expect(boundaryViolations(`import type { A } from "${ADAPTER_INTERFACE}";`)).toEqual([]);
  expect(boundaryViolations(`import { Y } from "${spec}";`, true)).toEqual([]);
});

test("the rule catches each Claude vocabulary literal", () => {
  for (const word of CLAUDE_VOCABULARY) {
    expect(boundaryViolations(`const x = { v: ${word} };`)).toEqual([word]);
  }
});

// Standing gate for the e2e conventions that a parser can decide (EXC-1054).
// `doc/agents/browser-testing.md` states the rules; this suite is what makes the
// mechanical subset falsifiable, so drift reds `bun test` on the push that adds
// it rather than waiting for a reviewer to notice.
//
// Four rules, each of which holds at zero violations today:
//
//   1. no `waitForTimeout` call anywhere under test/e2e/ — a fixed sleep is
//      either slower than it needs to be or races the window it waits on;
//   2. no file under test/e2e/ named *.test.ts or *.spec.ts — `bun test`
//      collects both suffixes repo-wide and would crash on a Playwright spec;
//   3. no *value* import of @playwright/test in a spec — `test` and `expect`
//      come from support/fixtures.ts, which is what stops a spec standing up a
//      daemon of its own (a bare `import type` is fine and is what all of them
//      currently do);
//   4. no non-zero `retries` — a retry hides the contention the budgets exist
//      to absorb, and it is the rule most likely to be reached for at 2am.
//
// Decided from the TypeScript AST rather than from text, and that is what keeps
// the suite ALLOWLIST-FREE. A parser sees calls and imports; it never sees the
// comment above, the rule file that names the same APIs, or a spec's own note
// about why it does not sleep — so no rule here needs an exception for prose
// that merely mentions it. Where a rule WOULD need an exception for real code
// (the `waitForFunction((t) => performance.now() > t + N, t0)` construct, whose
// eleven call sites split into one legitimate app-clock wait and ten fixed
// sleeps; the four per-call `toPass` budgets in file-refs.e2e.ts that raise
// above the config) the rule needs judgment, so it stays prose in
// browser-testing.md instead of shipping here with a list to append to.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";

// The suite sits at test/structure/, two levels below the repo root; resolving
// against import.meta.dir reads the real tree regardless of the runner's cwd.
const REPO_ROOT = join(import.meta.dir, "..", "..");

const E2E_DIR = "test/e2e";
const CONFIG = "playwright.config.ts";

/** Repo-relative paths the walk reads: the Playwright config plus every module
 * under test/e2e/, specs and shared harness alike. */
function scannedPaths(): string[] {
  const glob = new Bun.Glob("**/*.ts");
  const found = [...glob.scanSync({ cwd: join(REPO_ROOT, E2E_DIR) })].map((f) => `${E2E_DIR}/${f}`);
  return [CONFIG, ...found.sort()];
}

/** The line a node starts on, 1-based, so a violation names somewhere to look. */
function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

/** Whether an import declaration pulls in anything that exists at runtime.
 *
 * `import type { Page }` and `import { type Page }` bind only types and are
 * erased, so neither reaches Playwright's own `test`. A default binding, a
 * namespace binding, any named element without its own `type` modifier, and a
 * bare side-effect import all do. */
function bindsValue(decl: ts.ImportDeclaration): boolean {
  const clause = decl.importClause;
  if (!clause) return true;
  if (clause.isTypeOnly) return false;
  if (clause.name) return true;
  const bindings = clause.namedBindings;
  if (bindings && ts.isNamedImports(bindings)) {
    return bindings.elements.some((element) => !element.isTypeOnly);
  }
  return true;
}

/**
 * Every gated violation in `source`, as `<line>: <rule>` strings.
 *
 * `path` decides which rules apply, because two of them are about a spec's
 * relationship to the harness rather than about the code in isolation: the
 * import rule governs specs only (support/fixtures.ts legitimately imports
 * `test as base` to extend it), and the `retries` rule governs the config and
 * the specs, the only two places Playwright reads the knob from. The
 * `waitForTimeout` ban applies everywhere the suite runs, harness included.
 */
function offences(source: string, path: string): string[] {
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const isSpec = path.endsWith(".e2e.ts");
  const isConfig = path === CONFIG;
  const found: string[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "waitForTimeout"
    ) {
      found.push(`${lineOf(sf, node)}: waitForTimeout`);
    }

    if ((isSpec || isConfig) && ts.isPropertyAssignment(node)) {
      const name =
        ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : "";
      const zero = ts.isNumericLiteral(node.initializer) && Number(node.initializer.text) === 0;
      if (name === "retries" && !zero) found.push(`${lineOf(sf, node)}: non-zero retries`);
    }

    if (
      isSpec &&
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === "@playwright/test" &&
      bindsValue(node)
    ) {
      found.push(`${lineOf(sf, node)}: @playwright/test value import`);
    }

    node.forEachChild(visit);
  };

  visit(sf);
  return found;
}

test("no Playwright spec or harness module breaks a gated e2e convention", () => {
  const violations: string[] = [];
  for (const path of scannedPaths()) {
    const source = readFileSync(join(REPO_ROOT, path), "utf-8");
    for (const offence of offences(source, path)) violations.push(`${path}:${offence}`);
  }
  expect(violations).toEqual([]);
});

test("no file under test/e2e/ carries a suffix bun test would collect", () => {
  const glob = new Bun.Glob("**/*.{test,spec}.ts");
  expect([...glob.scanSync({ cwd: join(REPO_ROOT, E2E_DIR) })]).toEqual([]);
});

// The cases below fix the detector's own behaviour. They are the half of the
// gate a tree walk cannot prove: a walk over a clean tree passes just as
// readily when the rule is broken, so without these a silent false negative
// would never surface. The sources are literals rather than files because the
// walk above only reads test/e2e/ and the config — this file is never one of
// its inputs, so a violating fixture here cannot red the tree walk.

test("the waitForTimeout rule reads calls, not the prose that names them", () => {
  expect(offences("await page.waitForTimeout(500);", "a.e2e.ts")).toEqual(["1: waitForTimeout"]);
  expect(offences("await this.page.waitForTimeout(1);", "support/x.ts")).toEqual([
    "1: waitForTimeout",
  ]);
  const prose = '// never page.waitForTimeout here\nconst name = "page.waitForTimeout";';
  expect(offences(prose, "a.e2e.ts")).toEqual([]);
});

test("the retries rule accepts zero, rejects anything else, and skips the harness", () => {
  expect(offences("export default { retries: 0 };", CONFIG)).toEqual([]);
  expect(offences("export default { retries: 2 };", CONFIG)).toEqual(["1: non-zero retries"]);
  expect(offences("test.describe.configure({ retries: 1 });", "a.e2e.ts")).toEqual([
    "1: non-zero retries",
  ]);
  expect(offences("const opts = { retries: 3 };", "support/x.ts")).toEqual([]);
});

test("the harness rule separates a value import of @playwright/test from a type one", () => {
  const decl = (clause: string) => `import ${clause} from "@playwright/test";`;
  const offence = ["1: @playwright/test value import"];

  expect(offences(decl("type { Page }"), "a.e2e.ts")).toEqual([]);
  expect(offences(decl("{ type Page, type Locator }"), "a.e2e.ts")).toEqual([]);
  expect(offences(decl("{ test, expect }"), "a.e2e.ts")).toEqual(offence);
  expect(offences(decl("{ type Page, expect }"), "a.e2e.ts")).toEqual(offence);
  expect(offences(decl("* as pw"), "a.e2e.ts")).toEqual(offence);
  expect(offences(decl("base"), "a.e2e.ts")).toEqual(offence);
  expect(offences('import "@playwright/test";', "a.e2e.ts")).toEqual(offence);

  // The harness is where extending Playwright's own `test` belongs.
  expect(offences(decl("{ test as base }"), "support/fixtures.ts")).toEqual([]);
  // A value import of anything else is not this rule's business.
  expect(offences('import { join } from "node:path";', "a.e2e.ts")).toEqual([]);
});

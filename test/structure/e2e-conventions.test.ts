// Standing gate for the e2e conventions that a parser can decide (EXC-1054).
// `doc/agents/browser-testing.md` states the rules; this suite is what makes the
// mechanical subset falsifiable, so drift reds `bun test` on the push that adds
// it rather than waiting for a reviewer to notice.
//
// Four rules, each of which holds at zero violations today:
//
//   1. no `waitForTimeout` call anywhere under test/e2e/ — a fixed sleep is
//      either slower than it needs to be or races the window it waits on;
//   2. no file under test/e2e/ named for a unit suffix — `bun test` collects
//      *.test.ts, *_test.ts, *.spec.ts and *_spec.ts repo-wide and would crash
//      on a Playwright spec swept in under any of them;
//   3. no *value* import of @playwright/test anywhere under test/e2e/ except
//      support/fixtures.ts — `test` and `expect` come from there, which is what
//      stops a spec standing up a daemon of its own (a bare `import type` is
//      fine and is what every other module currently does);
//   4. no non-zero `retries` — a retry hides the contention the budgets exist
//      to absorb, and it is the rule most likely to be reached for at 2am.
//
// Decided from the TypeScript AST rather than from text, and that is what keeps
// the suite ALLOWLIST-FREE. A parser sees calls and imports; it never sees a
// comment or a string literal that merely names one of these APIs — so no rule
// here needs an exception carved for prose, and the fixtures.ts header that
// explains the sleep rule is simply not a violation. Where a rule WOULD need an
// exception for real code (the `waitForFunction((t) => performance.now() > t +
// N, t0)` construct, whose eleven call sites split into one legitimate
// app-clock wait and ten fixed sleeps; the five per-call `toPass` budgets in
// file-refs.e2e.ts that raise above the config) the rule needs judgment, so it
// stays prose in browser-testing.md instead of shipping here with a list to
// append to.
//
// What it deliberately does not catch: a banned call reached indirectly —
// `page["waitForTimeout"](5)`, a destructured `const { waitForTimeout } = page`,
// a `.bind()`. Those are adversarial rather than drift, and this gate defends
// against the second only.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Resolves to TypeScript 6, which is why this walk needs no port even though the tree
// type-checks with 7: 7.x moves the API behind ./unstable/* and exposes no standalone
// parse. That makes this import half the reason `typescript` stays installed at ^6 —
// see package.json's `held` block, and port this file before collapsing to one major.
import ts from "typescript";

// From import.meta.dir, not cwd, so the suite reads the real tree wherever it runs.
const REPO_ROOT = join(import.meta.dir, "..", "..");

const E2E_DIR = "test/e2e";
const CONFIG = "playwright.config.ts";
const FIXTURES = `${E2E_DIR}/support/fixtures.ts`;
const PLAYWRIGHT = "@playwright/test";

/**
 * The two scanned modules that construct Playwright's own runner: the config
 * calls `defineConfig`, and `fixtures.ts` extends `test as base` and re-exports
 * `expect`.
 *
 * Not an allowlist — this set *is* the import rule's subject. The rule says
 * Playwright's values enter the tree at exactly one module, which cannot be
 * stated without naming that module; an allowlist entry would instead excuse a
 * file from a rule that still applies to it.
 */
const PLAYWRIGHT_BOUNDARY = new Set([CONFIG, FIXTURES]);

// Nothing below reads `.parent`, so the parse skips building those links.
const NO_PARENT_NODES = false;

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

function isPlaywrightModule(specifier: ts.Expression | undefined): boolean {
  return specifier !== undefined && ts.isStringLiteral(specifier) && specifier.text === PLAYWRIGHT;
}

/**
 * Whether a node pulls something from `@playwright/test` that exists at runtime.
 *
 * Three specifier-bearing forms carry a value, and a rule reading only the first
 * would leave the other two unpoliced — the same reasoning
 * `import-conventions.test.ts` records for its own walk. `import type { Page }`
 * and `import { type Page }` bind only types and are erased, as is
 * `import("@playwright/test").Page` in type position, which is an
 * `ImportTypeNode` rather than a call and so never reaches here.
 */
function importsPlaywrightValue(node: ts.Node): boolean {
  if (ts.isImportDeclaration(node) && isPlaywrightModule(node.moduleSpecifier)) {
    const clause = node.importClause;
    if (!clause) return true; // bare side-effect import
    if (clause.isTypeOnly) return false;
    if (clause.name) return true; // default binding
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      return bindings.elements.some((element) => !element.isTypeOnly);
    }
    return true; // namespace binding
  }

  if (ts.isExportDeclaration(node) && isPlaywrightModule(node.moduleSpecifier)) {
    if (node.isTypeOnly) return false;
    const clause = node.exportClause;
    if (clause && ts.isNamedExports(clause)) {
      return clause.elements.some((element) => !element.isTypeOnly);
    }
    return true; // `export * from`
  }

  return (
    ts.isCallExpression(node) &&
    node.expression.kind === ts.SyntaxKind.ImportKeyword &&
    isPlaywrightModule(node.arguments[0])
  );
}

/** The trailing identifier of a call's callee — `configure` for
 * `test.describe.configure(…)`, `defineConfig` for a bare call. */
function calleeName(call: ts.CallExpression): string {
  const target = call.expression;
  if (ts.isIdentifier(target)) return target.text;
  if (ts.isPropertyAccessExpression(target)) return target.name.text;
  return "";
}

const RETRIES_READERS = new Set(["defineConfig", "configure"]);

/**
 * The object literals Playwright actually reads run options from.
 *
 * Anchoring the `retries` rule here, rather than at every object literal in the
 * file, is what keeps it allowlist-free: `retries` is an ordinary English word,
 * so an unrelated `{ retries: 3 }` — in a `page.evaluate` payload, say — would
 * otherwise be the gate's first false positive and its first exception. Both
 * config shapes are covered, since `export default defineConfig({…})` matches as
 * a call and `export default {…}` as an export assignment.
 */
function optionObjects(node: ts.Node): ts.ObjectLiteralExpression[] {
  if (ts.isCallExpression(node) && RETRIES_READERS.has(calleeName(node))) {
    return node.arguments.filter((arg) => ts.isObjectLiteralExpression(arg));
  }
  if (ts.isExportAssignment(node) && ts.isObjectLiteralExpression(node.expression)) {
    return [node.expression];
  }
  return [];
}

/**
 * Every gated violation in `source`, as `<line>: <rule>` strings.
 *
 * `path` decides which rules apply, because two of them are about a module's
 * relationship to the harness rather than about the code in isolation: the
 * import rule governs every scanned module except the two that construct
 * Playwright's own runner — the config, which calls `defineConfig`, and
 * `fixtures.ts`, which extends `test as base` and re-exports `expect` — and the
 * `retries` rule governs the config and the specs, the only two places in
 * committed source Playwright reads the knob from; a `--retries` flag on the
 * command line is a third, and out of a source gate's reach. The
 * `waitForTimeout` ban applies everywhere the suite runs, harness included.
 *
 * A `retries` that is not a literal `0` is reported even where it might resolve
 * to zero — a shorthand `{ retries }`, or an initializer read from the
 * environment. That is deliberate: the knob is meant to be a visible literal,
 * and indirection on it is precisely what this rule exists to catch.
 */
function offences(source: string, path: string): string[] {
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, NO_PARENT_NODES);
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

    if (isSpec || isConfig) {
      for (const options of optionObjects(node)) {
        for (const property of options.properties) {
          const name = property.name;
          if (!name || !(ts.isIdentifier(name) || ts.isStringLiteral(name))) continue;
          if (name.text !== "retries") continue;
          const zero =
            ts.isPropertyAssignment(property) &&
            ts.isNumericLiteral(property.initializer) &&
            Number(property.initializer.text) === 0;
          if (!zero) found.push(`${lineOf(sf, property)}: non-zero retries`);
        }
      }
    }

    if (!PLAYWRIGHT_BOUNDARY.has(path) && importsPlaywrightValue(node)) {
      found.push(`${lineOf(sf, node)}: ${PLAYWRIGHT} value import`);
    }

    node.forEachChild(visit);
  };

  visit(sf);
  return found;
}

test("no Playwright spec or harness module breaks a gated e2e convention", () => {
  const paths = scannedPaths();
  // Without this the walk below goes vacuous if the specs ever move: an empty
  // scan passes every assertion while covering nothing. Same guard, and the
  // same reason, as mise-task-bootstrap.test.ts.
  expect(paths.length).toBeGreaterThan(10);

  const violations: string[] = [];
  for (const path of paths) {
    const source = readFileSync(join(REPO_ROOT, path), "utf-8");
    for (const offence of offences(source, path)) violations.push(`${path}:${offence}`);
  }
  expect(violations).toEqual([]);
});

test("no file under test/e2e/ carries a suffix bun test would collect", () => {
  // Bun collects all four spellings, not just the dotted pair, so the glob has
  // to be wider than the two names browser-testing.md calls out by example.
  const glob = new Bun.Glob("**/*{.,_}{test,spec}.{ts,tsx}");
  expect([...glob.scanSync({ cwd: join(REPO_ROOT, E2E_DIR) })]).toEqual([]);
});

// The cases below pin the detector's own behaviour. They are the half of the
// gate a tree walk cannot prove: a walk over a clean tree passes just as readily
// when the rule is broken, so without these a silent false negative would never
// surface. The sources are literals rather than files because the walk above
// only reads test/e2e/ and the config — this file is never one of its inputs, so
// a violating fixture here cannot red the tree walk.

test("the waitForTimeout rule reads calls, not the prose that names them", () => {
  expect(offences("await page.waitForTimeout(500);", "a.e2e.ts")).toEqual(["1: waitForTimeout"]);
  expect(offences("await this.page.waitForTimeout(1);", "support/x.ts")).toEqual([
    "1: waitForTimeout",
  ]);
  expect(offences("await page?.waitForTimeout(1);", "a.e2e.ts")).toEqual(["1: waitForTimeout"]);
  const prose = '// never page.waitForTimeout here\nconst name = "page.waitForTimeout";';
  expect(offences(prose, "a.e2e.ts")).toEqual([]);
});

test("the retries rule reads the options Playwright reads, in either config shape", () => {
  const offence = ["1: non-zero retries"];

  expect(offences("export default defineConfig({ retries: 0 });", CONFIG)).toEqual([]);
  expect(offences("export default defineConfig({ retries: 2 });", CONFIG)).toEqual(offence);
  expect(offences("export default { retries: 0 };", CONFIG)).toEqual([]);
  expect(offences("export default { retries: 3 };", CONFIG)).toEqual(offence);
  expect(offences("test.describe.configure({ retries: 1 });", "a.e2e.ts")).toEqual(offence);

  // Indirection is the thing the rule is for, so it reds even though a reader
  // cannot tell what the value is: `workers` already takes this shape.
  expect(offences("export default defineConfig({ retries });", CONFIG)).toEqual(offence);
  expect(offences("export default defineConfig({ retries: envRetries });", CONFIG)).toEqual(
    offence,
  );

  // A `retries` key Playwright never reads is not this rule's business — the
  // false positive that would have forced the gate's first allowlist entry.
  expect(offences("await page.evaluate(() => ({ retries: 3 }));", "a.e2e.ts")).toEqual([]);
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

  // The re-export and dynamic forms carry values too.
  expect(offences('export { test } from "@playwright/test";', "a.e2e.ts")).toEqual(offence);
  expect(offences('export * from "@playwright/test";', "a.e2e.ts")).toEqual(offence);
  expect(offences('export type { Page } from "@playwright/test";', "a.e2e.ts")).toEqual([]);
  expect(offences('const { test } = await import("@playwright/test");', "a.e2e.ts")).toEqual(
    offence,
  );
  // …but the same syntax in type position is erased, and 15 specs write it.
  expect(offences('let p: import("@playwright/test").Page;', "a.e2e.ts")).toEqual([]);

  // fixtures.ts is the boundary: extending Playwright's own `test` belongs
  // there and nowhere else under test/e2e/, so a sibling harness module reaching
  // for a value is the same offence a spec's would be.
  expect(offences(decl("{ test as base }"), FIXTURES)).toEqual([]);
  expect(offences(decl("{ expect }"), "test/e2e/support/source-view.ts")).toEqual(offence);
  // The config constructs the runner, so its own value import is not drift.
  expect(offences(decl("{ defineConfig, devices }"), CONFIG)).toEqual([]);
  // A value import of anything else is not this rule's business.
  expect(offences('import { join } from "node:path";', "a.e2e.ts")).toEqual([]);
});

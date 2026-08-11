// Standing gate for the one shiki convention a parser can decide (EXC-1056).
// `doc/agents/browser-testing.md` states the rule; this suite is what makes it
// falsifiable, so drift reds `bun test` on the push that adds it.
//
// The rule, in two halves. Every shiki tokenize call in caret's own source carries
// `tokenizeTimeLimit`; and outside a `*.test.ts` it carries a literal `0`, or the
// spread of `CARET_TOKENIZE_OPTIONS` (ui/src/lib/diffview/shiki-bundle.ts) that
// supplies one. A test may starve the tokenizer deliberately — that is how the
// mechanism below is pinned at all — so the value half reads the path's CATEGORY,
// the way `e2e-conventions.test.ts` reads `isSpec`/`isConfig`. A category is not an
// allowlist: nothing here is a filename anyone appends to.
//
// shiki's default is 500ms of WALL CLOCK, enforced inside vscode-textmate's scan
// loop — spend it and the line is abandoned where it stands, its remainder returned
// as one token wearing whatever scope was in force, with nothing thrown and nothing
// logged. A call that omits the option is therefore not a slow call but a silently
// wrong one, on exactly the runs where a host is busy: it reddened
// `mise run preflight` at random for weeks, and it half-highlights a reviewer's code
// on a loaded machine.
//
// Gated rather than left as prose because it needs no allowlist and no judgment:
// the option belongs on every one of these calls, with no case where omitting it is
// right. Decided from the TypeScript AST, so a comment or a string that merely names
// `codeToHast` is not a violation and needs no carve-out — the same discipline
// `e2e-conventions.test.ts` records at length.
//
// Deliberately NOT covered: `.svelte` files, which the `**/*.ts` glob does not see and
// none of which tokenizes today; and `@pierre/diffs`, which keeps its own private
// highlighter and takes the default. The second is a standing finding rather than a
// rule — it is not caret's source, so no gate over this tree can reach it.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";

// The suite sits at test/structure/, two levels below the repo root; resolving
// against import.meta.dir reads the real tree regardless of the runner's cwd.
const REPO_ROOT = join(import.meta.dir, "..", "..");

/** The two program source roots. shiki lives in the browser program today; `src/`
 * is scanned anyway so the rule holds if it ever reaches the node one. */
const ROOTS = ["src", "ui/src"];

/** shiki's tokenize entry points — everything that reaches `tokenizeTimeLimit`.
 * `codeToHtml` and `codeToHast` route through `codeToTokens`, so they carry the
 * budget just as directly as the three that name tokens outright. */
const TOKENIZE_CALLS = new Set([
  "codeToTokens",
  "codeToTokensBase",
  "codeToTokensWithThemes",
  "codeToHast",
  "codeToHtml",
]);

/** The named options object the rule is satisfied by spreading. */
const OPTIONS_CONST = "CARET_TOKENIZE_OPTIONS";

const OPTION = "tokenizeTimeLimit";

// Nothing below reads `.parent`, so the parse skips building those links.
const NO_PARENT_NODES = false;

/** Repo-relative paths the walk reads: every `.ts` under either source root. */
function scannedPaths(): string[] {
  const glob = new Bun.Glob("**/*.ts");
  return ROOTS.flatMap((root) =>
    [...glob.scanSync({ cwd: join(REPO_ROOT, root) })].map((f) => `${root}/${f}`).sort(),
  );
}

/** The line a node starts on, 1-based, so a violation names somewhere to look. */
function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

/** The trailing identifier of a call's callee — `codeToHast` for `hl.codeToHast(…)`
 * and for a bare `codeToHast(…)` alike. */
function calleeName(call: ts.CallExpression): string {
  const target = call.expression;
  if (ts.isIdentifier(target)) return target.text;
  if (ts.isPropertyAccessExpression(target)) return target.name.text;
  return "";
}

/**
 * Whether an options argument carries the budget, and whether that budget is zero.
 *
 * Two spellings satisfy the first: the property written out, and a spread of the
 * named constant. A spread is not statically resolvable from one file's AST, so the
 * constant is matched BY NAME — which is the point rather than a compromise. The
 * option is meant to be visible at the call site, so `hl.codeToHast(code, opts)`
 * with the options built elsewhere reads as a violation, exactly as an indirected
 * `retries` does in the e2e gate. For the same reason a shorthand `{ tokenizeTimeLimit }`
 * counts as present but never as zero.
 */
function budgetOf(options: ts.ObjectLiteralExpression): { present: boolean; zero: boolean } {
  let present = false;
  let zero = false;
  for (const property of options.properties) {
    if (ts.isSpreadAssignment(property)) {
      if (ts.isIdentifier(property.expression) && property.expression.text === OPTIONS_CONST) {
        present = true;
        zero = true;
      }
      continue;
    }
    const name = property.name;
    if (!name || !(ts.isIdentifier(name) || ts.isStringLiteral(name))) continue;
    if (name.text !== OPTION) continue;
    present = true;
    if (
      ts.isPropertyAssignment(property) &&
      ts.isNumericLiteral(property.initializer) &&
      Number(property.initializer.text) === 0
    ) {
      zero = true;
    }
  }
  return { present, zero };
}

/**
 * Every tokenize call in `source`, and which of them break either half of the rule.
 *
 * `path` decides whether the value half applies: a `*.test.ts` may starve the
 * tokenizer on purpose, and the pin that proves the mechanism does exactly that.
 */
function scan(source: string, path: string): { calls: number; violations: string[] } {
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, NO_PARENT_NODES);
  const isTest = path.endsWith(".test.ts");
  let calls = 0;
  const violations: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && TOKENIZE_CALLS.has(calleeName(node))) {
      calls++;
      // The options are the LAST object literal in the argument list — index 1 on a
      // highlighter method, index 2 on the module-level `shiki/core` form
      // shiki-bundle.ts re-exports (`codeToHast(primitive, code, options)`). A call
      // with no object literal at all cannot be shown to carry the budget.
      const options = node.arguments.findLast((arg) => ts.isObjectLiteralExpression(arg));
      const budget = options ? budgetOf(options) : { present: false, zero: false };
      if (!budget.present) {
        violations.push(`${lineOf(sf, node)}: ${calleeName(node)} without ${OPTION}`);
      } else if (!budget.zero && !isTest) {
        violations.push(`${lineOf(sf, node)}: ${calleeName(node)} with a non-zero ${OPTION}`);
      }
    }
    node.forEachChild(visit);
  };

  visit(sf);
  return { calls, violations };
}

test("every shiki tokenize call in caret's source carries the budget", () => {
  const paths = scannedPaths();
  // Without this the walk goes vacuous if the roots ever move: an empty scan
  // passes every assertion while covering nothing. Same guard, and the same
  // reason, as mise-task-bootstrap.test.ts.
  expect(paths.length).toBeGreaterThan(100);

  let calls = 0;
  const violations: string[] = [];
  for (const path of paths) {
    const result = scan(readFileSync(join(REPO_ROOT, path), "utf-8"), path);
    calls += result.calls;
    for (const violation of result.violations) violations.push(`${path}:${violation}`);
  }

  expect(violations).toEqual([]);
  // The second non-vacuity guard, and the one that actually binds: a clean tree
  // and a tree the walk never recognised a call in are the same green otherwise.
  expect(calls).toBeGreaterThan(0);
});

// The cases below pin the detector's own behaviour — the half a tree walk cannot
// prove, since a walk over a clean tree passes just as readily when the rule is
// broken. The sources are literals rather than files because the walk above reads
// only src/ and ui/src/, so a violating fixture here cannot red it.

test("the rule accepts either spelling of the budget", () => {
  expect(scan("hl.codeToHast(c, { lang, theme, ...CARET_TOKENIZE_OPTIONS });", "a.ts")).toEqual({
    calls: 1,
    violations: [],
  });
  expect(scan("hl.codeToTokensBase(c, { lang, tokenizeTimeLimit: 0 });", "a.ts")).toEqual({
    calls: 1,
    violations: [],
  });
});

test("the rule finds the options wherever shiki's signature puts them", () => {
  // The module-level `shiki/core` form shiki-bundle.ts re-exports takes the primitive
  // first, so its options sit at index 2. Reading `arguments[1]` would red this.
  expect(scan("codeToHast(internal, c, { lang, ...CARET_TOKENIZE_OPTIONS });", "a.ts")).toEqual({
    calls: 1,
    violations: [],
  });
  expect(scan("codeToTokensBase(internal, c, { lang });", "a.ts")).toEqual({
    calls: 1,
    violations: ["1: codeToTokensBase without tokenizeTimeLimit"],
  });
});

test("a non-zero budget is a violation in production and the point in a test", () => {
  // Present but finite is the same bug at a different threshold — outside a test.
  expect(scan("hl.codeToTokensBase(c, { lang, tokenizeTimeLimit: 500 });", "a.ts")).toEqual({
    calls: 1,
    violations: ["1: codeToTokensBase with a non-zero tokenizeTimeLimit"],
  });
  // Shorthand and indirection read as present, never as zero: the value is meant to
  // be a visible literal, exactly as the e2e gate requires of `retries`.
  expect(scan("hl.codeToHtml(c, { lang, tokenizeTimeLimit });", "a.ts")).toEqual({
    calls: 1,
    violations: ["1: codeToHtml with a non-zero tokenizeTimeLimit"],
  });
  // Starving the tokenizer on purpose is how the mechanism is pinned, so a suite may.
  expect(scan("hl.codeToTokensBase(c, { lang, tokenizeTimeLimit: 1 });", "a.test.ts")).toEqual({
    calls: 1,
    violations: [],
  });
  // The presence half still binds there.
  expect(scan("hl.codeToTokensBase(c, { lang });", "a.test.ts")).toEqual({
    calls: 1,
    violations: ["1: codeToTokensBase without tokenizeTimeLimit"],
  });
});

test("the rule reads calls, not the prose or the spread that names them", () => {
  expect(scan('// always pass codeToHast the options\nconst x = "codeToHtml";', "a.ts")).toEqual({
    calls: 0,
    violations: [],
  });
  // A spread of something else is not the constant, however plausible its name.
  expect(scan("hl.codeToHtml(c, { lang, ...otherOptions });", "a.ts")).toEqual({
    calls: 1,
    violations: ["1: codeToHtml without tokenizeTimeLimit"],
  });
});

test("the rule reds an omitted budget on every entry point", () => {
  for (const name of TOKENIZE_CALLS) {
    expect(scan(`hl.${name}(c, { lang, theme });`, "a.ts")).toEqual({
      calls: 1,
      violations: [`1: ${name} without tokenizeTimeLimit`],
    });
  }
});

test("the rule reds options it cannot see, which is what keeps it visible at the call site", () => {
  expect(scan("hl.codeToHast(c, options);", "a.ts")).toEqual({
    calls: 1,
    violations: ["1: codeToHast without tokenizeTimeLimit"],
  });
  expect(scan("hl.codeToHtml(c);", "a.ts")).toEqual({
    calls: 1,
    violations: ["1: codeToHtml without tokenizeTimeLimit"],
  });
});

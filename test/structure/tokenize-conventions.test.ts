// Standing gate for the one shiki convention a parser can decide (EXC-1056).
// `doc/agents/browser-testing.md` states the rule; this suite is what makes it
// falsifiable, so drift reds `bun test` on the push that adds it.
//
// The rule: every shiki tokenize call in caret's own source carries
// `tokenizeTimeLimit`, which in practice means spreading `CARET_TOKENIZE_OPTIONS`
// (ui/src/lib/diffview/shiki-bundle.ts). shiki's default is 500ms of WALL CLOCK,
// enforced inside vscode-textmate's scan loop — spend it and the line is abandoned
// where it stands, its remainder returned as one token wearing whatever scope was
// in force, with nothing thrown and nothing logged. A call that omits the option is
// therefore not a slow call but a silently wrong one, on exactly the runs where a
// host is busy: it reddened `mise run preflight` at random for weeks, and it
// half-highlights a reviewer's code on a loaded machine.
//
// Gated rather than left as prose because it needs no allowlist and no judgment:
// the option belongs on every one of these calls, with no case where omitting it is
// right. Decided from the TypeScript AST, so a comment or a string that merely names
// `codeToHast` is not a violation and needs no carve-out — the same discipline
// `e2e-conventions.test.ts` records at length.
//
// Deliberately NOT covered: `@pierre/diffs`, which keeps its own private highlighter
// and takes the default. That is a standing finding rather than a rule — it is not
// caret's source, so no gate over this tree can reach it.
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
 * Whether an options argument carries the budget.
 *
 * Two spellings satisfy it: the property written out, and a spread of the named
 * constant. A spread is not statically resolvable from one file's AST, so the
 * constant is matched BY NAME — which is the point rather than a compromise. The
 * option is meant to be visible at the call site, so `hl.codeToHast(code, opts)`
 * with the options built elsewhere reads as a violation, exactly as an indirected
 * `retries` does in the e2e gate.
 */
function carriesBudget(options: ts.ObjectLiteralExpression): boolean {
  return options.properties.some((property) => {
    if (ts.isSpreadAssignment(property)) {
      return ts.isIdentifier(property.expression) && property.expression.text === OPTIONS_CONST;
    }
    const name = property.name;
    if (!name || !(ts.isIdentifier(name) || ts.isStringLiteral(name))) return false;
    return name.text === OPTION;
  });
}

/** Every tokenize call in `source`, and which of them omit the budget. */
function scan(source: string, path: string): { calls: number; violations: string[] } {
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, NO_PARENT_NODES);
  let calls = 0;
  const violations: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && TOKENIZE_CALLS.has(calleeName(node))) {
      calls++;
      // The options object is the second argument on every one of these; a call
      // with no object literal there cannot be shown to carry the budget.
      const options = node.arguments[1];
      const ok =
        options !== undefined && ts.isObjectLiteralExpression(options) && carriesBudget(options);
      if (!ok) violations.push(`${lineOf(sf, node)}: ${calleeName(node)} without ${OPTION}`);
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

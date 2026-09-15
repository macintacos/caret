// Standing gate for the shared test helpers: a value export under test/support,
// test/e2e/support or ui/support that nothing imports reds here, and so does a module
// there that nothing references at all. `doc/agents/test-layout.md` § test/support/ states
// the rule this keeps falsifiable.
//
// Imports are read from the TypeScript AST, as e2e-conventions.test.ts reads them, so a
// comment or a string that names a helper is never mistaken for a use. Type-only exports
// are exempt: a support module exports the types its exported signatures name, whether or
// not a caller names one yet. A module wired in without an import counts as referenced — a
// `bunfig.toml` preload, or a `new URL("./x.ts", import.meta.url)` path, which is how
// fixtures.ts hands daemon-entry.ts to its spawn.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

// The 6.x compiler API as a parsing library, as e2e-conventions.test.ts imports it — see
// the note there before collapsing `typescript` to one major.
import ts from "typescript";

// From import.meta.dir, not cwd, so the suite reads the real tree wherever it runs.
const REPO_ROOT = join(import.meta.dir, "..", "..");

const SUPPORT_DIRS = ["test/support", "test/e2e/support", "ui/support"];

/** The `.ts` trees a support import can come from. `.svelte` files are not read, so an
 * import from one reds as unused — a loud miss, never a silent one. A support module's own
 * `*.test.ts` counts as an importer. */
const IMPORTER_DIRS = ["test", "ui/src", "ui/support", "scripts", "src", "opencode"];

/** The aliases a support module is imported through, as `tsconfig.json` maps them. */
const ALIASES: ReadonlyArray<readonly [string, string]> = [
  ["@test/", "test/"],
  ["@ui/", "ui/"],
];

/** Stands in for every export of a module reached as a whole. */
const WHOLE = "*";

// Nothing below reads `.parent`, so the parse skips building those links.
const NO_PARENT_NODES = false;

function parse(path: string, source: string): ts.SourceFile {
  return ts.createSourceFile(path, source, ts.ScriptTarget.Latest, NO_PARENT_NODES);
}

function hasModifier(statement: ts.Statement, kind: ts.SyntaxKind): boolean {
  return (
    ts.canHaveModifiers(statement) &&
    (ts.getModifiers(statement) ?? []).some((modifier) => modifier.kind === kind)
  );
}

/** The names a top-level statement exports that exist at runtime. */
function valueExportNames(statement: ts.Statement): string[] {
  if (ts.isExportAssignment(statement)) return ["default"];
  if (ts.isExportDeclaration(statement)) {
    const clause = statement.exportClause;
    if (statement.isTypeOnly || !clause || !ts.isNamedExports(clause)) return [];
    return clause.elements.filter((e) => !e.isTypeOnly).map((e) => e.name.text);
  }
  if (
    !hasModifier(statement, ts.SyntaxKind.ExportKeyword) ||
    hasModifier(statement, ts.SyntaxKind.DeclareKeyword)
  ) {
    return [];
  }
  if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) return ["default"];
  if (
    (ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isEnumDeclaration(statement)) &&
    statement.name
  ) {
    return [statement.name.text];
  }
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.flatMap((d) =>
      ts.isIdentifier(d.name) ? [d.name.text] : [],
    );
  }
  return [];
}

/** A module an import names, and what it takes from it: export names, or WHOLE. */
interface Reference {
  specifier: string;
  names: string[];
}

function valueNames(elements: ts.NodeArray<ts.ImportSpecifier | ts.ExportSpecifier>): string[] {
  return elements.filter((e) => !e.isTypeOnly).map((e) => (e.propertyName ?? e.name).text);
}

function referenceIn(node: ts.Node): Reference | null {
  if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
    const specifier = node.moduleSpecifier.text;
    const clause = node.importClause;
    if (!clause || clause.isTypeOnly) return { specifier, names: [] };
    const bindings = clause.namedBindings;
    const names = clause.name ? ["default"] : [];
    if (bindings && ts.isNamespaceImport(bindings)) names.push(WHOLE);
    if (bindings && ts.isNamedImports(bindings)) names.push(...valueNames(bindings.elements));
    return { specifier, names };
  }
  if (
    ts.isExportDeclaration(node) &&
    node.moduleSpecifier &&
    ts.isStringLiteral(node.moduleSpecifier)
  ) {
    const specifier = node.moduleSpecifier.text;
    if (node.isTypeOnly) return { specifier, names: [] };
    const clause = node.exportClause;
    return {
      specifier,
      names: clause && ts.isNamedExports(clause) ? valueNames(clause.elements) : [WHOLE],
    };
  }
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    return wholeModule(node.arguments[0]);
  }
  if (
    ts.isNewExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "URL"
  ) {
    const [path, base] = node.arguments ?? [];
    const fromThisModule =
      base &&
      ts.isPropertyAccessExpression(base) &&
      ts.isMetaProperty(base.expression) &&
      base.name.text === "url";
    return fromThisModule ? wholeModule(path) : null;
  }
  return null;
}

/** A dynamic import or a file URL takes the whole module its literal names. */
function wholeModule(argument: ts.Expression | undefined): Reference | null {
  return argument && ts.isStringLiteral(argument)
    ? { specifier: argument.text, names: [WHOLE] }
    : null;
}

function referencesIn(path: string, source: string): Reference[] {
  const found: Reference[] = [];
  const visit = (node: ts.Node): void => {
    const reference = referenceIn(node);
    if (reference) found.push(reference);
    node.forEachChild(visit);
  };
  visit(parse(path, source));
  return found;
}

/** The repo path `specifier` names from the module at `importer`, or null when it names a
 * package rather than a repo file. */
function resolveSpecifier(importer: string, specifier: string): string | null {
  const alias = ALIASES.find(([prefix]) => specifier.startsWith(prefix));
  let path: string;
  if (alias) path = alias[1] + specifier.slice(alias[0].length);
  else if (specifier.startsWith(".")) path = normalize(join(dirname(importer), specifier));
  else return null;
  return path.endsWith(".ts") ? path : `${path}.ts`;
}

/** Every value export in `modules` nothing in `importers` uses, as `<path>: <name>`, and
 * every module nothing references or preloads, as `<path>`. */
function unusedSupport(
  modules: ReadonlyMap<string, string>,
  importers: ReadonlyMap<string, string>,
  preloads: readonly string[],
): string[] {
  const used = new Map<string, Set<string>>(preloads.map((p) => [normalize(p), new Set([WHOLE])]));
  for (const [path, source] of importers) {
    for (const { specifier, names } of referencesIn(path, source)) {
      const target = resolveSpecifier(path, specifier);
      if (target === null || !modules.has(target)) continue;
      const set = used.get(target) ?? new Set<string>();
      for (const name of names) set.add(name);
      used.set(target, set);
    }
  }

  const found: string[] = [];
  for (const [path, source] of modules) {
    const names = used.get(path);
    if (!names) found.push(path);
    else if (!names.has(WHOLE)) {
      const unused = parse(path, source)
        .statements.flatMap(valueExportNames)
        .filter((name) => !names.has(name));
      found.push(...unused.map((name) => `${path}: ${name}`));
    }
  }
  return found;
}

/** Every `pattern` match under `dir`, keyed by repo-relative path. */
function readTree(dir: string, pattern: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const rel of new Bun.Glob(pattern).scanSync({ cwd: join(REPO_ROOT, dir) })) {
    const path = dir === "" ? rel : `${dir}/${rel}`;
    files.set(path, readFileSync(join(REPO_ROOT, path), "utf-8"));
  }
  return files;
}

test("every shared test helper is imported by something", () => {
  const modules = new Map(
    SUPPORT_DIRS.flatMap((dir) => [...readTree(dir, "**/*.ts")]).filter(
      ([path]) => !path.endsWith(".test.ts"),
    ),
  );
  const importers = new Map([
    ...IMPORTER_DIRS.flatMap((dir) => [...readTree(dir, "**/*.ts")]),
    ...readTree("", "*.ts"),
    ...readTree("ui", "*.ts"),
  ]);
  // Without these the walk goes vacuous if a directory moves: an empty scan passes the
  // assertion below while covering nothing.
  expect(modules.size).toBeGreaterThan(30);
  expect(importers.size).toBeGreaterThan(300);

  const bunfig = Bun.TOML.parse(readFileSync(join(REPO_ROOT, "bunfig.toml"), "utf-8")) as {
    test?: { preload?: string[] };
  };
  expect(unusedSupport(modules, importers, bunfig.test?.preload ?? [])).toEqual([]);
});

// The cases below pin the detector itself, which the tree walk cannot: a walk over a clean
// tree passes just as readily when the detector is broken. The sources are literals, so no
// case here can red the walk above.

const files = (entries: Record<string, string>) => new Map(Object.entries(entries));

test("reports a value export nothing imports, and not one something does", () => {
  const modules = files({
    "test/support/poll.ts": "export function until() {}\nexport const orphan = 1;",
  });
  const importers = files({
    "test/core/a.test.ts": 'import { until } from "@test/support/poll.ts";',
  });
  expect(unusedSupport(modules, importers, [])).toEqual(["test/support/poll.ts: orphan"]);
});

test("exempts type-only exports, and a type-only import uses no value", () => {
  const modules = files({
    "ui/support/mount.ts":
      "export interface Mounted {}\nexport type Props = {};\nexport function render() {}",
  });
  const importers = files({
    "ui/src/a.test.ts": 'import { type Mounted, type render } from "@ui/support/mount.ts";',
  });
  expect(unusedSupport(modules, importers, [])).toEqual(["ui/support/mount.ts: render"]);
});

test("counts every export of a module reached as a whole", () => {
  const modules = files({ "test/support/poll.ts": "export function a() {}\nexport const b = 1;" });
  for (const importer of [
    'import * as poll from "@test/support/poll.ts";',
    'export * from "@test/support/poll.ts";',
    'const poll = await import("@test/support/poll.ts");',
  ]) {
    expect(unusedSupport(modules, files({ "test/a.ts": importer }), []), importer).toEqual([]);
  }
});

test("resolves sibling, extensionless, renamed and default imports", () => {
  const modules = files({
    "test/support/env.ts": "export function withEnv() {}",
    "test/e2e/support/fixture-plan.ts": 'export default {};\nexport const FIXTURE_PLAN = "";',
    "ui/support/helpers.ts": "export function until() {}",
  });
  const importers = files({
    "test/support/env.test.ts": 'import { withEnv } from "./env";',
    "test/e2e/support/fixtures.ts": 'import plan, { FIXTURE_PLAN } from "./fixture-plan.ts";',
    "ui/support/routed-fetch.ts": 'export { until as waitFor } from "./helpers.ts";',
  });
  expect(unusedSupport(modules, importers, [])).toEqual([]);
});

test("reports a module nothing references, unless something wires it in without an import", () => {
  const modules = files({
    "ui/support/orphan.ts": "globalThis.x = 1;",
    "test/support/rumdl-preload.ts": 'process.env.X = "1";',
    "test/e2e/support/daemon-entry.ts": "console.log(1);",
  });
  const importers = files({
    "test/e2e/support/fixtures.ts": 'const ENTRY = new URL("./daemon-entry.ts", import.meta.url);',
  });
  expect(unusedSupport(modules, importers, ["./test/support/rumdl-preload.ts"])).toEqual([
    "ui/support/orphan.ts",
  ]);
});

test("a URL resolved against anything but import.meta.url is not a reference", () => {
  const modules = files({ "test/e2e/support/daemon-entry.ts": "console.log(1);" });
  const importers = files({
    "test/e2e/support/fixtures.ts":
      'const ENTRY = new URL("./daemon-entry.ts", "file:///elsewhere/");',
  });
  expect(unusedSupport(modules, importers, [])).toEqual(["test/e2e/support/daemon-entry.ts"]);
});

test("a comment or a string naming a helper is not a use", () => {
  const modules = files({ "test/support/poll.ts": "export function until() {}" });
  const importers = files({
    "test/core/a.test.ts":
      '// import { until } from "@test/support/poll.ts";\nconst spec = "@test/support/poll.ts";',
  });
  expect(unusedSupport(modules, importers, [])).toEqual(["test/support/poll.ts"]);
});

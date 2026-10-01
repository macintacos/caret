import { expect, test } from "bun:test";

import { runtimeImportSpecifiers } from "./import-specifiers";

const ERASED = [
  'import type { A } from "p"',
  'import type {\n  A,\n  B,\n} from "p"',
  'import type A from "p"',
  'import type * as ns from "p"',
  'export type { A } from "p"',
  'export type * from "p"',
];

const SURVIVING = [
  'import { type A } from "p"',
  'import { b, type C } from "p"',
  'import b, { type C } from "p"',
  'import { A } from "p"',
  'import A from "p"',
  'import * as A from "p"',
  'export { A } from "p"',
  'export * from "p"',
  'import "p"',
  'await import("p")',
];

test.each(ERASED)("an import TypeScript erases is not a runtime import: %p", (source) => {
  expect(runtimeImportSpecifiers(source)).toEqual([]);
});

test.each(SURVIVING)("an import that survives compilation is a runtime import: %p", (source) => {
  expect(runtimeImportSpecifiers(source)).toEqual(["p"]);
});

test("an erased import does not hide the runtime import after it", () => {
  expect(runtimeImportSpecifiers('import type { A } from "p";\nimport { b } from "q";')).toEqual([
    "q",
  ]);
});

test("an unclosed `import type {` in a comment does not swallow the next import", () => {
  expect(
    runtimeImportSpecifiers('// `import type {` opens a comment\nimport { b } from "q";'),
  ).toEqual(["q"]);
});

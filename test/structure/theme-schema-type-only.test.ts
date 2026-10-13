// The UI may only take types from the theme file schema: a value import would pull
// zod into the bundle, and the daemon is the one that validates theme files.
import { expect, test } from "bun:test";
import { join } from "node:path";

import { importSpecifiers, runtimeImportSpecifiers } from "@test/support/import-specifiers.ts";

const UI_SRC = join(import.meta.dir, "..", "..", "ui", "src");

const isSchemaSpecifier = (spec: string) => /^@core\/theme\/schema(?:\.ts)?$/.test(spec);

test("the UI imports the theme file schema with top-level `import type` only", async () => {
  let schemaImportCount = 0;
  const runtimeSchemaImports: string[] = [];
  for await (const path of new Bun.Glob("**/*.{ts,svelte}").scan(UI_SRC)) {
    if (path.endsWith(".test.ts")) continue;
    const text = await Bun.file(join(UI_SRC, path)).text();
    schemaImportCount += importSpecifiers(text).filter(isSchemaSpecifier).length;
    runtimeSchemaImports.push(
      ...runtimeImportSpecifiers(text)
        .filter(isSchemaSpecifier)
        .map((spec) => `${path}: ${spec}`),
    );
  }
  expect(schemaImportCount).toBeGreaterThan(0);
  expect(runtimeSchemaImports).toEqual([]);
});

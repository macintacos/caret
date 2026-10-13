// The UI may only take types from the theme file schema: a value import would pull
// zod into the bundle, and the daemon is the one that validates theme files.
import { expect, test } from "bun:test";
import { join } from "node:path";

const UI_SRC = join(import.meta.dir, "..", "..", "ui", "src");

const SCHEMA_IMPORT = /^\s*import\b([^;]*?)\bfrom\s*["']@core\/theme\/schema(?:\.ts)?["']/gm;

test("the UI imports the theme file schema with top-level `import type` only", async () => {
  const imports: string[] = [];
  for await (const path of new Bun.Glob("**/*.{ts,svelte}").scan(UI_SRC)) {
    if (path.endsWith(".test.ts")) continue;
    const text = await Bun.file(join(UI_SRC, path)).text();
    for (const match of text.matchAll(SCHEMA_IMPORT)) {
      imports.push(`${path}: ${match[0].trim()}`);
    }
  }
  expect(imports.length).toBeGreaterThan(0);
  expect(imports.filter((line) => !/:\s*import\s+type\s/.test(line))).toEqual([]);
});

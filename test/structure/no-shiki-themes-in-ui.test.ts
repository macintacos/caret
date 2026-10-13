// ui/vite.config.ts stubs every `@shikijs/themes/*` specifier out of the build. The stub's
// default export is a throwing function, so such an import would build and silently yield
// it in place of a theme — and the bundle budget cannot see it, because the bundle shrinks.
// `shiki/themes/<name>` re-exports `@shikijs/themes/<name>`, so it is stubbed too.
import { expect, test } from "bun:test";
import { join } from "node:path";

import { importSpecifiers } from "@test/support/import-specifiers.ts";

const UI_SRC = join(import.meta.dir, "..", "..", "ui", "src");

const isShikiThemeSpecifier = (spec: string) => /^(?:shiki\/themes\/|@shikijs\/themes)/.test(spec);

test("no UI module imports a shiki-shipped theme", async () => {
  const themeImports: string[] = [];
  let scanned = 0;
  for await (const path of new Bun.Glob("**/*.{ts,svelte}").scan(UI_SRC)) {
    if (path.endsWith(".test.ts")) continue;
    scanned++;
    const text = await Bun.file(join(UI_SRC, path)).text();
    themeImports.push(
      ...importSpecifiers(text)
        .filter(isShikiThemeSpecifier)
        .map((spec) => `${path}: ${spec}`),
    );
  }
  expect(scanned).toBeGreaterThan(0);
  expect(themeImports).toEqual([]);
});

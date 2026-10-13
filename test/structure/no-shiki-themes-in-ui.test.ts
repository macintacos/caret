// ui/vite.config.ts stubs every `@shikijs/themes/*` specifier out of the build, which is
// safe only while no app module imports a shiki theme: the vendor themes live in theme
// files. `shiki/themes/<name>` re-exports `@shikijs/themes/<name>`, so it is stubbed too.
import { expect, test } from "bun:test";
import { join } from "node:path";

import { importSpecifiers } from "@test/support/import-specifiers.ts";

const UI_SRC = join(import.meta.dir, "..", "..", "ui", "src");

const isShikiThemeSpecifier = (spec: string) => /^(?:shiki\/themes\/|@shikijs\/themes)/.test(spec);

test("no UI module imports a shiki-shipped theme", async () => {
  const themeImports: string[] = [];
  for await (const path of new Bun.Glob("**/*.{ts,svelte}").scan(UI_SRC)) {
    if (path.endsWith(".test.ts")) continue;
    const text = await Bun.file(join(UI_SRC, path)).text();
    themeImports.push(
      ...importSpecifiers(text)
        .filter(isShikiThemeSpecifier)
        .map((spec) => `${path}: ${spec}`),
    );
  }
  expect(themeImports).toEqual([]);
});

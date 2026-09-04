import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Test-only reconstituter for the split stylesheet. app.css @imports the ./styles/*
// partials and the Tailwind bundler inlines them at build, so what ships is one flat
// sheet. The CSS-contract suites parse that flat sheet as text, so read it back the
// same way rather than each test reading a single partial — several pin blocks live
// in different partials. One of those, styles/palette.generated.css, is emitted
// rather than committed, so a suite reading this needs the generator to have run
// (`mise run test` does).

const APP_CSS = new URL("../app.css", import.meta.url).pathname;

/** app.css with every `@import "./styles/…"` replaced by the partial's text. */
export function readAppCss(): string {
  const dir = dirname(APP_CSS);
  return readFileSync(APP_CSS, "utf8").replace(/@import\s+"(\.\/styles\/[^"]+)";/g, (_, spec) =>
    readFileSync(join(dir, spec), "utf8"),
  );
}

/** The body of the `:root` block declaring `marker`, or `""` when none does.
 * The sheet carries several — the emitted palette, the hand-written tokens, the
 * shadcn bridge, the width foundation — so a suite finds its block by what it
 * declares rather than by position. `:root` bodies are flat (no nested braces),
 * which is what makes the `[^}]*` capture a safe delimiter. */
export function rootBlock(css: string, marker: string): string {
  for (const m of css.matchAll(/:root\s*\{([^}]*)\}/g)) {
    if (m[1]?.includes(marker)) return m[1];
  }
  return "";
}

/** The body of the sheet's one `@theme inline` block — the shadcn bridge's map onto
 * Tailwind's utility scales — or `""` when it is absent. Flat like a `:root` body, so
 * the same `[^}]*` capture holds. */
export function themeBlock(css: string): string {
  return css.match(/@theme inline\s*\{([^}]*)\}/)?.[1] ?? "";
}

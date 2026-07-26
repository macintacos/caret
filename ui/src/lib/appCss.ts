import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Test-only reconstituter for the split stylesheet. app.css is the entry that
// @imports the ./styles/* partials; the Tailwind bundler inlines them at build,
// so what ships is one flat sheet. The CSS-contract suites (motion, type-scale,
// shadcn-bridge, layout, derived-tokens, css-bridge) parse that flat sheet as
// text, so read it back the same way — inline each local ./styles @import in the
// order app.css lists them — rather than each test reading a single partial
// (several pin blocks that now live in different partials). One of those
// partials, styles/palette.generated.css, is emitted rather than committed, so a
// suite reading this needs the generator to have run — `mise run test` does it.
// Not imported by app code, so it never reaches the browser bundle.

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

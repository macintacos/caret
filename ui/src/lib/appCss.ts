import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Test-only reconstituter for the split stylesheet. app.css is the entry that
// @imports the ./styles/* partials; the Tailwind bundler inlines them at build,
// so what ships is one flat sheet. The CSS-contract suites (theme, motion,
// type-scale, shadcn-bridge, layout, css-bridge) parse that flat sheet as text,
// so read it back the same way — inline each local ./styles @import in the order
// app.css lists them — rather than each test reading a single partial (several
// pin blocks that now live in different partials). Not imported by app code, so
// it never reaches the browser bundle.

const APP_CSS = new URL("../app.css", import.meta.url).pathname;

/** app.css with every `@import "./styles/…"` replaced by the partial's text. */
export function readAppCss(): string {
  const dir = dirname(APP_CSS);
  return readFileSync(APP_CSS, "utf8").replace(/@import\s+"(\.\/styles\/[^"]+)";/g, (_, spec) =>
    readFileSync(join(dir, spec), "utf8"),
  );
}

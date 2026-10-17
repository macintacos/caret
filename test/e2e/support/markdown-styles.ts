// Fixtures the source-view and preview markdown-style specs both paint.
import type { ThemeMarkdown } from "@core/theme/schema.ts";

/** One of each element a theme's markdown styles can paint. */
export const PLAN = `# Styled heading

Prose with \`inline code\` and [a link](https://docs.example.test) beside it.

Some **bold words** and *italic words* here.

- bullet item

1. ordered item

> quoted line of text
`;

/** Every element styled, each with a font style, so a surface shows it honours them all. */
export const STYLES = {
  heading: { color: "#9580ff", fontStyle: ["bold"] },
  code: { color: "#8aff80", fontStyle: ["italic"] },
  link: { color: "#ff80bf", fontStyle: ["bold"] },
  bold: { color: "#ffca80", fontStyle: ["italic"] },
  italic: { color: "#ffff80", fontStyle: ["bold"] },
  listMarker: { color: "#80ffea", fontStyle: ["bold"] },
  quote: { color: "#ffff80", fontStyle: ["italic", "bold"] },
} satisfies ThemeMarkdown;

/** No built-in theme uses it, so a spec can tell when its own theme has painted. */
export const ACCENT = "#00c2a8";

/** A `#rrggbb` hex as the `rgb(…)` a computed color reads back. */
export const rgb = (hex: string) =>
  `rgb(${[1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;

/** One heading per level. One h1 only: the daemon's reflow demotes a plan's second h1. */
export const LEVELS_PLAN = `# Level one

## Level two

### Level three

#### Level four

##### Level five

###### Level six
`;

/** LEVELS_PLAN's heading texts, h1 first. */
export const LEVEL_TEXTS = ["one", "two", "three", "four", "five", "six"].map((n) => `Level ${n}`);

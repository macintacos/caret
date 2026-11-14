// The docs site's stylesheet copies caret's theme hexes by role; this pins each
// copy to the theme file it came from, so a palette change can't leave the site behind.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..");

const SHARED_ROLES = {
  "--md-default-bg-color": "paper",
  "--md-default-fg-color": "ink",
  "--md-default-fg-color--light": "inkSoft",
  "--md-default-fg-color--lighter": "inkFaint",
  "--md-primary-fg-color": "paper",
  "--md-primary-bg-color": "ink",
  "--md-accent-fg-color": "accentBright",
  "--md-accent-bg-color": "accentInk",
  "--md-typeset-a-color": "accent",
} as const;

const SCHEMES = [
  { scheme: "default", theme: "caret-light", codeBg: "sunk" },
  { scheme: "slate", theme: "caret-dark", codeBg: "raised" },
] as const;

const css = readFileSync(join(REPO_ROOT, "docs/stylesheets/caret.css"), "utf8");

for (const { scheme, theme, codeBg } of SCHEMES) {
  test(`the ${scheme} scheme takes its colours from ${theme} by role`, () => {
    const block =
      css.match(new RegExp(`\\[data-md-color-scheme="${scheme}"\\] \\{([^}]*)\\}`))?.[1] ?? "";
    const { palette } = JSON.parse(
      readFileSync(join(REPO_ROOT, `ui/src/lib/themes/${theme}.json`), "utf8"),
    ) as { palette: Record<string, string> };

    for (const [prop, key] of Object.entries(SHARED_ROLES)) {
      expect(block).toContain(`${prop}: ${palette[key]};`);
    }
    expect(block).toContain(`--md-code-bg-color: ${palette[codeBg]};`);
    expect(block).toContain(
      `--md-accent-fg-color--transparent: color-mix(in srgb, ${palette.accent} `,
    );
  });
}

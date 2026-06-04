import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ICON_NAMES } from "./icons.ts";

// The vendored-icon contract (EXC-395): ui/src/icons/ holds ONLY verbatim
// Lucide SVGs, in 1:1 correspondence with ICON_NAMES. These tests gate the
// convention downstream icon tickets follow — they read the files from disk
// on purpose, independent of how the Icon component imports them.
const ICONS_DIR = join(import.meta.dir, "../icons");

describe("vendored icon set", () => {
  test("ICON_NAMES and ui/src/icons/*.svg are in bijection", () => {
    const files = readdirSync(ICONS_DIR);
    // Only verbatim Lucide SVGs live in the directory — nothing else.
    expect(files.filter((f) => !f.endsWith(".svg"))).toEqual([]);
    const stems = files.map((f) => f.replace(/\.svg$/, "")).sort();
    expect(stems).toEqual([...ICON_NAMES].sort());
  });

  test("names are kebab-case (Lucide's naming)", () => {
    for (const name of ICON_NAMES) {
      expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  test.each([...ICON_NAMES])("%s.svg keeps Lucide's verbatim shape", (name) => {
    const svg = readFileSync(join(ICONS_DIR, `${name}.svg`), "utf8");
    // currentColor stroke is what makes theming work (EXC-394 needs it);
    // the 24x24 viewBox + width/height attrs are what Icon.svelte's CSS
    // sizing overrides rely on.
    expect(svg).toContain('stroke="currentColor"');
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain('fill="none"');
    expect(svg).toContain('width="24"');
    expect(svg).toContain('height="24"');
    expect(svg).not.toContain("<script");
  });
});

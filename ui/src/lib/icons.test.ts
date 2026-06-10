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
    // Dotfiles (.DS_Store and friends) are OS artifacts, not part of the set.
    const files = readdirSync(ICONS_DIR).filter((f) => !f.startsWith("."));
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

  // tsc can't catch a mis-wired entry ("check": chevronDown) — all values are
  // plain strings — and bun:test can't compile .svelte, so parse the component
  // source: import identifier ↔ file stem, record key ↔ identifier, and the
  // composition key ↔ stem must be the identity over ICON_NAMES.
  test("Icon.svelte wires every registry name to its own SVG", () => {
    const src = readFileSync(join(import.meta.dir, "../components/Icon.svelte"), "utf8");
    const importPairs = [
      ...src.matchAll(/import (\w+) from "\.\.\/icons\/([a-z0-9-]+)\.svg\?raw"/g),
    ];
    expect(importPairs.length).toBe(ICON_NAMES.length);
    const stemByIdent = new Map(importPairs.map((m) => [m[1], m[2]]));
    const start = src.indexOf("const SVGS");
    const block = src.slice(start, src.indexOf("};", start));
    // Record entries are shorthand (`command,`) or quoted (`"chevron-down": chevronDown,`).
    const entries = [...block.matchAll(/^ {4}(?:"([a-z0-9-]+)": (\w+)|(\w+)),$/gm)].map((m) =>
      m[1] ? [m[1], m[2]] : [m[3], m[3]],
    );
    expect(entries.length).toBe(ICON_NAMES.length);
    for (const [name, ident] of entries) {
      expect(stemByIdent.get(ident)).toBe(name);
    }
    expect(entries.map(([name]) => name).sort()).toEqual([...ICON_NAMES].sort());
  });

  // The licenses table is the one add-an-icon step nothing else gates
  // (docs/agents/icon-rules.md step 4): keep its rows in bijection with the registry.
  test("THIRD_PARTY_LICENSES.md itemizes every vendored icon", () => {
    const doc = readFileSync(join(import.meta.dir, "../../../THIRD_PARTY_LICENSES.md"), "utf8");
    const rows = [...doc.matchAll(/^\| `([a-z0-9-]+)`\s+\|/gm)].map((m) => m[1]);
    expect(rows.sort()).toEqual([...ICON_NAMES].sort());
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

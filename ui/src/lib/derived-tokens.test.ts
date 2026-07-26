import { describe, expect, test } from "bun:test";

import { readAppCss } from "$lib/appCss.ts";
import { THEMES } from "$lib/theme.ts";

// The derived tier (EXC-885): the colors a palette *implies* rather than decides.
// A palette names its surfaces, ink, and accent through lib/themes/recipe.ts; the
// chip fills, the sheer panel, and the neutral hover wash all fall out of that
// choice, so ui/src/styles/derived.css mixes them once and components read
// var(--token) instead of mixing by hand.
//
// This suite pins the two properties that make the tier safe for every palette.
//
// The SELECTOR. A custom property's computed value is its specified value with
// var() already substituted, so a token declared only on :root bakes in :root's
// palette and inherits into every subtree as a literal — it does NOT re-derive
// inside a subtree paintTheme(id, node) painted with a different palette (EXC-884).
// paintTheme stamps data-theme on every target it paints, root or scoped, so
// `:root, [data-theme]` re-derives the whole tier once per painted scope and
// exactly where one exists. A regression to a bare :root would show up only as a
// preview card wearing the app's colors, so it is asserted here instead.
//
// WELL-FORMEDNESS. Every value is a color-mix(in lab, …) whose only inputs are
// palette tokens. theme.test.ts's registry-wide "covers caret-dark's full token
// set" already pins that key set for all nine palettes, so a tier built solely from
// those names derives correctly for every one of them by construction — rather than
// by this suite sampling caret's and hoping.

const appCss = readAppCss();

// The selector is part of the contract, so the block is matched literally rather
// than by scanning for any :root. Its body is flat (no nested braces).
const DERIVED_BLOCK = /:root,\s*\[data-theme\]\s*\{([^}]*)\}/;

const decls = (appCss.match(DERIVED_BLOCK)?.[1] ?? "").replace(/\/\*[\s\S]*?\*\//g, "");

function declaredTokens(body: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const decl of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    tokens[decl[1]!] = decl[2]!.trim();
  }
  return tokens;
}

describe("the derived-token tier", () => {
  const tokens = declaredTokens(decls);

  test("is declared on :root AND [data-theme], so a scoped paint re-derives it", () => {
    expect(appCss).toMatch(DERIVED_BLOCK);
  });

  test("names the four tokens the chrome reads", () => {
    expect(Object.keys(tokens).sort()).toEqual([
      "--chip",
      "--chip-hover",
      "--paper-veil",
      "--wash-ink",
    ]);
  });

  test("derives every one with color-mix(in lab, …)", () => {
    for (const [name, value] of Object.entries(tokens)) {
      expect(value, name).toMatch(/^color-mix\(in lab,/);
    }
  });

  test("uses no hardcoded hex or oklch — the palette is the only input", () => {
    expect(decls).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(decls).not.toContain("oklch");
  });

  test("mixes only palette tokens, so all nine palettes derive the tier", () => {
    const palette = new Set(Object.keys(THEMES["caret-dark"].tokens));
    const referenced = [...new Set([...decls.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]!))];
    expect(referenced.length).toBeGreaterThan(0);
    expect(referenced.filter((name) => !palette.has(name))).toEqual([]);
  });
});

import { describe, expect, test } from "bun:test";

import { readAppCss } from "$lib/appCss.ts";
import { THEMES } from "$lib/theme.ts";

// The derived tier (EXC-885), declared in ui/src/styles/derived.css, which carries
// the tier's own rationale. This suite pins the two properties that make it safe for
// every palette.
//
// The SELECTOR. `:root, [data-theme]` rather than a bare `:root`, so the tier
// re-derives inside a subtree paintTheme(id, node) painted with a different palette
// (EXC-884) instead of inheriting :root's palette as a baked literal. A regression to
// a bare :root would show up only as a preview card wearing the app's colors.
//
// WELL-FORMEDNESS. Every colour is a color-mix(in lab, …) whose only inputs are
// palette tokens, the tier's own, and black, which a dark well steps toward.
// theme.test.ts's registry-wide "covers caret-dark's full token set" already pins
// that key set for every palette, so a tier built solely from those
// names derives correctly for every one by construction — rather than by this suite
// sampling caret's and hoping.

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

// The floating surfaces are box-shadows over the tactile geometry, not colours.
function colours(tokens: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(tokens).filter(([name]) => !name.startsWith("--float-surface-")),
  );
}

// A light value may also be the palette token itself, unmixed.
const LAB_MIX_OR_TOKEN = /^(color-mix\(in lab,|var\(--[\w-]+\)$)/;

describe("the derived-token tier", () => {
  const tokens = declaredTokens(decls);

  test("is declared on :root AND [data-theme], so a scoped paint re-derives it", () => {
    expect(appCss).toMatch(DERIVED_BLOCK);
  });

  test("names the tokens the chrome reads", () => {
    expect(Object.keys(tokens).sort()).toEqual([
      "--attention-wash",
      "--chip",
      "--chip-hover",
      "--code-panel",
      "--danger-face-hover",
      "--field-floor",
      "--float-surface-high",
      "--float-surface-low",
      "--float-surface-mid",
      "--ink-wash",
      "--neutral-face",
      "--neutral-face-down",
      "--neutral-face-hover",
      "--neutral-face-latched",
      "--paper-veil",
      "--well-floor",
    ]);
  });

  // The two well-formedness tests below iterate the block's contents, so both would
  // pass vacuously against a missing block. The test above is what actually catches
  // that, but assert non-emptiness here too so neither reads as a green tick over
  // nothing.
  test("derives every colour with color-mix(in lab, …)", () => {
    expect(Object.keys(tokens).length).toBeGreaterThan(0);
    for (const [name, value] of Object.entries(colours(tokens))) {
      expect(value, name).toMatch(/^color-mix\(in lab,/);
    }
  });

  test("composes each floating surface from its rim, a ring and its lift", () => {
    for (const height of ["low", "mid", "high"]) {
      expect(tokens[`--float-surface-${height}`], height).toMatch(
        new RegExp(
          `^var\\(--float-rim\\), 0 0 0 1px var\\(--rule(-strong)?\\), var\\(--float-${height}\\)$`,
        ),
      );
    }
  });

  test("re-derives its scheme-split tokens for light paper, in the same mix space", () => {
    const light = declaredTokens(
      [...appCss.matchAll(/\[data-theme="light"\]\s*\{([^}]*)\}/g)]
        .map((m) => m[1] ?? "")
        .find((body) => body.includes("--well-floor:")) ?? "",
    );
    expect(Object.keys(light).length).toBeGreaterThan(0);
    for (const [name, value] of Object.entries(light)) {
      expect(Object.keys(tokens), name).toContain(name);
      expect(value, name).toMatch(LAB_MIX_OR_TOKEN);
    }
  });
  test("uses no hardcoded hex or oklch — the palette is the only input", () => {
    expect(decls.trim()).not.toBe("");
    expect(decls).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(decls).not.toContain("oklch");
  });

  test("mixes only palette tokens and its own, so every palette derives the tier", () => {
    const known = new Set([...Object.keys(THEMES["caret-dark"].tokens), ...Object.keys(tokens)]);
    const mixes = Object.values(colours(tokens)).join(";");
    const referenced = [...new Set([...mixes.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]!))];
    expect(referenced.length).toBeGreaterThan(0);
    expect(referenced.filter((name) => !known.has(name))).toEqual([]);
  });
});

import { describe, expect, test } from "bun:test";

import { readAppCss } from "$lib/appCss.ts";

// The caret↔shadcn-svelte bridge lives in exactly one place: the shadcn semantic
// token block (`--background`, `--primary`, `--border`, …) plus the `@theme inline`
// map in ui/src/app.css. EXC-757 seeded it with stock shadcn `neutral` oklch
// literals as a stub; EXC-758 replaces those with live var() references to caret's
// THEMES tokens so shadcn components paint on caret's palette and retint with theme
// switches — the same pattern css-bridge.test.ts pins for the .diffview bridge.
//
// This suite pins the contract: every shadcn semantic var maps to a caret token
// (no hex, no oklch), amber reaches shadcn only through --color-primary (never the
// neutral --color-accent hover wash), fonts and radius are single-sourced from
// caret, and there is no per-scheme [data-theme="dark"] block (scheme lives in the
// caret tokens, which applyTheme() writes inline). A drift fails the unit suite
// rather than only showing as a visual mismatch on a placed shadcn component.

const appCss = readAppCss();

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");

// Every :root block body in the file. The shadcn semantic layer is the block that
// declares --background (caret's own token block declares --paper instead). :root
// bodies are flat (no nested braces), so [^}]* is a safe delimiter here.
function shadcnRootBlock(css: string): string {
  for (const m of css.matchAll(/:root\s*\{([^}]*)\}/g)) {
    if (m[1]!.includes("--background")) return m[1]!;
  }
  return "";
}

function themeInlineBlock(css: string): string {
  return css.match(/@theme inline\s*\{([^}]*)\}/)?.[1] ?? "";
}

// shadcn semantic var → the caret THEMES token it must bridge to.
const EXPECTED: Record<string, string> = {
  "--background": "--paper",
  "--foreground": "--ink",
  "--card": "--paper-raised",
  "--card-foreground": "--ink",
  "--popover": "--paper-raised",
  "--popover-foreground": "--ink",
  "--primary": "--accent",
  "--primary-foreground": "--accent-ink",
  "--secondary": "--paper-raised",
  "--secondary-foreground": "--ink",
  "--muted": "--paper-sunk",
  "--muted-foreground": "--ink-soft",
  "--accent-foreground": "--ink",
  "--destructive": "--danger",
  "--destructive-foreground": "--accent-ink",
  "--border": "--rule",
  "--input": "--rule-strong",
  // --ring is asserted separately: it softens --accent-bright rather than
  // bridging to it bare (see the color-mix test below).
};

describe("the shadcn semantic :root → caret token bridge", () => {
  const block = shadcnRootBlock(appCss);
  const decls = stripComments(block);

  test("the shadcn semantic block exists (declares --background)", () => {
    expect(block).not.toBe("");
  });

  for (const [shadcnVar, caretToken] of Object.entries(EXPECTED)) {
    test(`maps ${shadcnVar} to caret's ${caretToken}`, () => {
      expect(decls).toMatch(new RegExp(`${shadcnVar}:\\s*var\\(${caretToken}\\);`));
    });
  }

  test("softens --ring to a translucent --accent-bright (subtle focus ring, both schemes)", () => {
    // The focus ring reads as a subtle hint, not a loud solid frame. It stays a
    // derivation of caret's --accent-bright (so it flips per scheme), just softened
    // with transparency — caret's global :focus-visible and the diffview share it.
    expect(decls).toMatch(
      /--ring:\s*color-mix\(in oklab,\s*var\(--accent-bright\),\s*transparent \d+%\);/,
    );
  });

  test("uses no hardcoded hex or oklch — every value is a caret token", () => {
    expect(decls).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(decls).not.toContain("oklch");
  });

  test("does NOT declare a bare --accent (that name is caret's amber; collision)", () => {
    // caret owns --accent (amber). Redeclaring it here would clobber caret's amber
    // for the whole app. shadcn's neutral accent lives only as --color-accent in
    // @theme inline (asserted below). --accent-foreground/--accent-ink are distinct
    // names and are allowed.
    expect(decls).not.toMatch(/--accent\s*:/);
  });
});

describe("the shadcn @theme inline map", () => {
  const block = themeInlineBlock(appCss);
  const decls = stripComments(block);

  test("--color-primary rides caret's amber via var(--primary) (→ var(--accent))", () => {
    expect(decls).toMatch(/--color-primary:\s*var\(--primary\);/);
  });

  test("--color-accent is a neutral color-mix, never caret's amber var(--accent)", () => {
    // The one collision: shadcn's --accent is a neutral hover/active wash, not
    // caret amber. Set directly here (not as an --accent property, which would
    // clobber caret's amber) to a neutral grey mixed off paper→ink, flipping per
    // scheme through the operands like the .diffview hover.
    expect(decls).toMatch(/--color-accent:\s*color-mix\(in lab,/);
    expect(decls).not.toMatch(/--color-accent:\s*var\(--accent\)/);
  });

  test("bridges the font stacks so font-sans/font-mono utilities resolve to caret's", () => {
    expect(decls).toMatch(/--font-sans:\s*var\(--font-sans\);/);
    expect(decls).toMatch(/--font-mono:\s*var\(--font-mono\);/);
  });

  test("single-sources the panel radius: --radius-xl references caret's --radius-lg", () => {
    expect(decls).toMatch(/--radius-xl:\s*var\(--radius-lg\);/);
  });

  test("uses no hardcoded hex or oklch", () => {
    expect(decls).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(decls).not.toContain("oklch");
  });
});

describe("scheme lives in caret's tokens, not a per-scheme shadcn block", () => {
  test('no [data-theme="dark"] block redeclares shadcn tokens', () => {
    // caret's tokens are written inline per-scheme by applyTheme() and the static
    // :root fallback is caret-dark, so a var()-bridged shadcn block resolves the
    // right scheme at runtime and dark at first paint. A separate dark override is
    // redundant — its absence is the single-block guarantee (mirrors css-bridge's
    // "no @media inside the rule").
    expect(appCss).not.toMatch(/\[data-theme="dark"\]\s*\{[^}]*--background/);
  });
});

import { describe, expect, test } from "bun:test";
import { join } from "node:path";

// The caret↔@pierre/diffs bridge lives in exactly one place: a single .diffview
// rule in ui/src/app.css that maps caret's design tokens onto the @pierre/diffs
// --diffs-* custom properties and sets the Berkeley Mono font stack. This suite
// pins the contract the acceptance criteria require — exact font stack and the
// absence of hardcoded hex — so a drift fails the unit suite rather than only
// showing as a visual mismatch in the diff view's shadow DOM.

const appCss = await Bun.file(join(import.meta.dir, "../../app.css")).text();

// Extract the body of the single .diffview rule.
function diffviewRule(css: string): string {
  const match = css.match(/\.diffview\s*\{([^}]*)\}/);
  return match?.[1] ?? "";
}

// The rule body with /* … */ comments stripped — comments legitimately mention
// token names, percentages, and #000/@media in prose, so structural assertions
// (no hex color, no nested @media) scan the declarations alone.
function declarations(css: string): string {
  return diffviewRule(css).replace(/\/\*[\s\S]*?\*\//g, "");
}

const FONT_STACK = "'Berkeley Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace";

describe("the .diffview → --diffs-* bridge", () => {
  const rule = diffviewRule(appCss);

  test("sets --diffs-font-family to caret's Berkeley Mono stack", () => {
    expect(rule).toContain(`--diffs-font-family: ${FONT_STACK};`);
  });

  test("maps every color/spacing --diffs-* var from a caret token, never a literal hex", () => {
    // Each required mapping points at a var(--caret-token), so the values flow
    // from app.css's token system and inherit dark mode through the cascade.
    // Only host-overridable vars are mapped — the library reads them on :host,
    // so a host-level token reaches them.
    expect(rule).toMatch(/--diffs-bg:\s*var\(--/);
    expect(rule).toMatch(/--diffs-fg:\s*var\(--/);
    expect(rule).toMatch(/--diffs-fg-number:\s*var\(--/);
    // No hardcoded hex anywhere in the bridge: every value is a var() or a
    // color-mix() literal, carrying no '#'.
    expect(declarations(appCss)).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  // The layered surface system (EXC-603). The library derives buffer / context /
  // context-gutter / separator / per-line-hover from its own light-dark() greys
  // unless these override vars are set. Binding each to caret's paper/ink ramp
  // ties the whole structural surface to caret's grey system. Each override is a
  // color-mix(in lab, …) of a caret token toward the bridge (or a bare var()),
  // so light/dark resolves through the operands flipping — never a nested @media.
  const SURFACE_OVERRIDES = [
    "--diffs-bg-buffer-override",
    "--diffs-bg-context-override",
    "--diffs-bg-context-gutter-override",
    "--diffs-bg-separator-override",
    "--diffs-bg-hover-override",
  ] as const;

  for (const name of SURFACE_OVERRIDES) {
    test(`sets ${name} from a caret token via color-mix(in lab) or var()`, () => {
      // Present in the single .diffview rule…
      const decl = rule.match(new RegExp(`${name}:\\s*([^;]+);`));
      expect(decl).not.toBeNull();
      const value = decl?.[1]?.trim() ?? "";
      // …and var()/color-mix-based, never a raw color literal.
      expect(value).toMatch(/^(var\(--|color-mix\(in lab,)/);
      // lab mixing only — oklch is mangled in the embedding Chrome build.
      expect(value).not.toContain("oklch");
    });
  }

  test("expresses scheme entirely through flipping operands — no @media inside the rule", () => {
    // The flat .diffview rule carries no nested at-rule; light/dark depth comes
    // from the caret operands (--paper-sunk, --ink) flipping across schemes.
    expect(declarations(appCss)).not.toContain("@media");
  });
});

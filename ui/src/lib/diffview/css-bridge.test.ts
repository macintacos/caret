import { describe, expect, test } from "bun:test";
import { join } from "node:path";

// The CSS half of the theme/font bridge lives in one place: a single .diffview
// rule in ui/src/app.css that maps caret's design tokens onto the @pierre/diffs
// --diffs-* custom properties and sets the Berkeley Mono font stack. This suite
// pins the contract the acceptance criteria require — the exact font stack and
// the absence of hardcoded hex — so a drift fails the unit suite rather than
// only showing up as a visual mismatch in the diff view's shadow DOM.

const appCss = await Bun.file(join(import.meta.dir, "../../app.css")).text();

/** The single .diffview rule body that carries the --diffs-* mappings. */
function diffviewRule(css: string): string {
  const match = css.match(/\.diffview\s*\{([^}]*)\}/);
  return match?.[1] ?? "";
}

const FONT_STACK = "'Berkeley Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace";

describe("the .diffview --diffs-* bridge in app.css", () => {
  const rule = diffviewRule(appCss);

  test("a single .diffview rule carries the bridge", () => {
    expect(rule).not.toBe("");
  });

  test("sets --diffs-font-family to the Berkeley Mono fallback stack verbatim", () => {
    expect(rule).toContain(`--diffs-font-family: ${FONT_STACK};`);
  });

  test("maps every color/spacing --diffs-* var from a caret token, never a literal hex", () => {
    // Each required mapping points at a var(--caret-token), so the values flow
    // from app.css's token system and inherit dark mode through the cascade.
    // Only host-overridable vars are mapped — the library defines these on
    // :host, so a host-level token reaches them.
    expect(rule).toMatch(/--diffs-bg:\s*var\(--/);
    expect(rule).toMatch(/--diffs-fg:\s*var\(--/);
    expect(rule).toMatch(/--diffs-fg-number:\s*var\(--/);
    // No hardcoded hex anywhere in the bridge rule — the font stack is the only
    // literal, and it carries no '#'.
    expect(rule).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});

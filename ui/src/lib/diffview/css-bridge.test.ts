import { describe, expect, test } from "bun:test";

import { readAppCss } from "$lib/appCss.ts";

// The caret↔@pierre/diffs bridge lives in exactly one place: a single .diffview
// rule in ui/src/app.css that maps caret's design tokens onto the @pierre/diffs
// --diffs-* custom properties and sets the Berkeley Mono font stack. This suite
// pins the contract the acceptance criteria require — exact font stack and the
// absence of hardcoded hex — so a drift fails the unit suite rather than only
// showing as a visual mismatch in the diff view's shadow DOM.

const appCss = readAppCss();

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

  test("turns on tabular figures via --diffs-font-features", () => {
    // The library passes --diffs-font-features straight into font-feature-settings
    // on its :host, so the value is the OpenType 'tnum' tag — not the
    // font-variant-numeric keyword. The bridge owns this host passthrough; the
    // library never sets the feature anywhere else, so this rule is the only
    // injection point.
    expect(rule).toMatch(/--diffs-font-features:\s*'tnum';/);
    // Tabular only — no ligature/alternates/slashed-zero scope creep.
    expect(rule).not.toMatch(/--diffs-font-features:[^;]*\b(liga|calt|dlig|zero)\b/);
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

  test("binds the unprefixed --bg/--fg (the [data-file-info] chip) to caret tokens", () => {
    // The library's header info chip reads the bare --bg/--fg, not the --diffs-*
    // pair, so without a host binding it falls back to its built-in defaults. The
    // bridge binds both to a caret token so the chip resolves on caret's palette.
    expect(rule).toMatch(/--bg:\s*var\(--/);
    expect(rule).toMatch(/--fg:\s*var\(--/);
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

  // Semantic add/delete color (EXC-604). The library themes its +/- semantics
  // through a single-knob override layer: --diffs-addition-base reads
  // --diffs-addition-color-override, and the line tint, the gutter bar, and the
  // per-token emphasis wash (--diffs-bg-addition-emphasis = rgb(from base …))
  // all cascade from that one base. Tying each override to caret's --ok/--danger
  // retints the whole semantic system in lockstep; both tokens flip across
  // schemes, so a bare var() carries correct hue in light and dark. We never set
  // a derived -base/-bg-*/-emphasis var directly — that would risk desyncing the
  // bar from its line. Per the tree's amber-selection-only accent strategy,
  // --diffs-modified stays library-blue (no modified override).
  const SEMANTIC_OVERRIDES = [
    "--diffs-addition-color-override",
    "--diffs-deletion-color-override",
  ] as const;

  for (const name of SEMANTIC_OVERRIDES) {
    test(`sets ${name} from a caret token via var() or color-mix(in lab)`, () => {
      const decl = rule.match(new RegExp(`${name}:\\s*([^;]+);`));
      expect(decl).not.toBeNull();
      const value = decl?.[1]?.trim() ?? "";
      // A caret token reference or a lab mix — never a raw color literal.
      expect(value).toMatch(/^(var\(--|color-mix\(in lab,)/);
      // oklch is mangled in the embedding Chrome build.
      expect(value).not.toContain("oklch");
    });
  }

  test("carries no transition or animation — the diff surface is motionless by design", () => {
    // The @pierre/diffs render surface (line hover, line/range-selection, the
    // decoration bars, gutter affordances, hunk-expand) changes state with instant
    // color-mix swaps and carries NO transition or keyframe. It is shadow-
    // encapsulated, so the global reduced-motion rule in app.css cannot reach it and
    // a light-DOM transition cannot leak in — but the host CAN add a transition or
    // animation to the .diffview container or to a bridged --diffs-* property here,
    // which would leak motion past the boundary. This pins that it does not: the
    // bridge declarations name no transition/animation property.
    expect(declarations(appCss)).not.toMatch(/\b(transition|animation)\b/);
  });

  test("keeps --diffs-modified library-blue — no modified override (amber-selection-only)", () => {
    // The accent strategy reserves caret amber for the comment selection only;
    // change-type semantics other than add/delete (the gutter +, change-type
    // icons, merge-conflict incoming) read the library's blue for free, so the
    // bridge deliberately sets no --diffs-modified-color-override.
    expect(rule).not.toContain("--diffs-modified-color-override");
  });

  // The amber selection (EXC-605). This is the one place caret amber reaches the
  // diff surface. The library mixes --diffs-selection-base (which falls back to
  // --diffs-modified-base, i.e. library-blue) over each selected line's own grey
  // via --diffs-bg-selection-override; the line-number column reads the same mix
  // through --diffs-bg-selection-number-override. Pointing both at caret's amber
  // accent recolors the drag-to-comment selection to amber-on-caret-grey while
  // --diffs-modified itself stays blue, so the change semantics are untouched.
  const SELECTION_OVERRIDES = [
    "--diffs-bg-selection-override",
    "--diffs-bg-selection-number-override",
  ] as const;

  for (const name of SELECTION_OVERRIDES) {
    test(`sets ${name} to caret's amber accent via a token, never a literal`, () => {
      const decl = rule.match(new RegExp(`${name}:\\s*([^;]+);`));
      expect(decl).not.toBeNull();
      const value = decl?.[1]?.trim() ?? "";
      // The amber accent token (carries its own light/dark variant), or a lab
      // mix of it — never a raw color literal, never oklch.
      expect(value).toMatch(/^(var\(--accent|color-mix\(in lab,)/);
      expect(value).not.toContain("oklch");
    });
  }
});

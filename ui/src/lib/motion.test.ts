import { describe, expect, test } from "bun:test";
import { join } from "node:path";

// caret's motion vocabulary lives in app.css: a small set of functional
// duration/easing tokens for one-shot chrome reveals, plus a single global
// prefers-reduced-motion rule that neutralizes movement for the light-DOM app
// root. This suite pins the substrate the acceptance criteria require — the
// token shape, the ≤200ms functional ceiling, and the global guard — so a drift
// fails the unit suite rather than only showing as motion under reduced-motion.

const uiDir = join(import.meta.dir, "..");
const appCss = await Bun.file(join(uiDir, "app.css")).text();
const composer = await Bun.file(join(uiDir, "components/SourceComposer.svelte")).text();
const dialog = await Bun.file(join(uiDir, "components/RequestChangesDialog.svelte")).text();

// The :root block where the design tokens (including motion) are declared.
function rootBlock(css: string): string {
  const match = css.match(/:root\s*\{([\s\S]*?)\n\}/);
  return match?.[1] ?? "";
}

// Parse a ms/s duration value to milliseconds. Returns NaN for non-time values.
function toMs(value: string): number {
  const v = value.trim();
  if (v.endsWith("ms")) return Number.parseFloat(v);
  if (v.endsWith("s")) return Number.parseFloat(v) * 1000;
  return Number.NaN;
}

describe("motion tokens in app.css", () => {
  const root = rootBlock(appCss);

  test("declares two functional one-shot durations, both ≤200ms", () => {
    const fast = root.match(/--dur-fast:\s*([^;]+);/)?.[1] ?? "";
    const base = root.match(/--dur-base:\s*([^;]+);/)?.[1] ?? "";
    expect(fast).not.toBe("");
    expect(base).not.toBe("");
    // Functional reveal durations stay snappy — the AC caps them at 200ms.
    expect(toMs(fast)).toBeLessThanOrEqual(200);
    expect(toMs(base)).toBeLessThanOrEqual(200);
    expect(toMs(fast)).toBeGreaterThan(0);
    expect(toMs(base)).toBeGreaterThan(0);
  });

  test("declares an enter and an exit easing as cubic-beziers", () => {
    const out = root.match(/--ease-out:\s*([^;]+);/)?.[1] ?? "";
    const eIn = root.match(/--ease-in:\s*([^;]+);/)?.[1] ?? "";
    expect(out).toContain("cubic-bezier");
    expect(eIn).toContain("cubic-bezier");
  });

  test("documents the ambient/infinite carve-out", () => {
    // The functional tokens are for one-shot reveals; ambient/infinite
    // animations (safe-mode pulse, EmptyState float) keep their own durations.
    // A comment must record that exemption near the tokens.
    expect(appCss).toMatch(/ambient|infinite/i);
  });
});

describe("the global prefers-reduced-motion rule", () => {
  // The single guard for the light-DOM chrome. Extract the body of the
  // app-root-scoped reduced-motion @media block — the rule wraps one nested
  // selector block, so capture through its closing brace and the @media's own.
  const block =
    appCss.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?\n  \}\n\})/)?.[1] ?? "";

  test("a global reduced-motion @media rule exists, scoped to the #app root", () => {
    expect(block).not.toBe("");
    // Scoped to the light-DOM app root — not a bare universal selector with no
    // root anchor, so it cannot bleed past the mounted app.
    expect(block).toContain("#app");
  });

  test("neutralizes animation and transition to near-zero", () => {
    expect(block).toMatch(/animation-duration:\s*0(\.0+)?(m?s)?/);
    expect(block).toMatch(/transition-duration:\s*0(\.0+)?(m?s)?/);
  });

  test("forces infinite animations to a single static frame", () => {
    // animation-iteration-count: 1 collapses an infinite ambient animation to
    // one resolved frame rather than letting it loop invisibly.
    expect(block).toMatch(/animation-iteration-count:\s*1/);
  });

  test("documents that the rule does not cross the shadow boundary", () => {
    // The @pierre/diffs surface lives in a Shadow DOM, unreachable from app.css.
    expect(appCss).toMatch(/shadow/i);
  });
});

describe("the two formerly-unguarded animations reference the tokens", () => {
  test("SourceComposer's pop reveal uses a duration + easing token", () => {
    // The `animation:` shorthand on the composer carries a var(--dur-*) and a
    // var(--ease-*), not a raw 0.14s/ease-out literal.
    const decl = composer.match(/animation:\s*pop\s+([^;]+);/)?.[1] ?? "";
    expect(decl).toContain("var(--dur-");
    expect(decl).toContain("var(--ease-");
    // No bare seconds literal left on the shorthand.
    expect(decl).not.toMatch(/\d+(\.\d+)?s\b/);
  });

  test("RequestChangesDialog's fade + rise use a duration + easing token", () => {
    const fade = dialog.match(/animation:\s*fade\s+([^;]+);/)?.[1] ?? "";
    const rise = dialog.match(/animation:\s*rise\s+([^;]+);/)?.[1] ?? "";
    for (const decl of [fade, rise]) {
      expect(decl).toContain("var(--dur-");
      expect(decl).toContain("var(--ease-");
      expect(decl).not.toMatch(/\d+(\.\d+)?s\b/);
    }
  });
});

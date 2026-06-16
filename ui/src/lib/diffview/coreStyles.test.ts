import { describe, expect, test } from "bun:test";
import { join } from "node:path";

// EXC-645: the drag-to-comment selection block must round its outer corners to
// match the comment composer's box. The selection is the @pierre/diffs per-cell
// [data-selected-line] highlight, rounded from caret's override sheet
// (CARET_OVERRIDES in coreStyles.ts, adopted into every view's shadow root after
// the library core sheet). The view is a two-column grid: line-number cells stack
// inside [data-gutter] and content/annotation cells stack inside [data-content],
// so the block's left corners are the first/last selected child of [data-gutter]
// and its right corners are the first/last selected child of [data-content] —
// each corner is scoped to its own column. This suite pins that contract
// structurally (each outer corner rounded, on the correct column, with the SAME
// radius token the composer uses) so a drift fails the unit suite rather than
// only showing as a square block behind a rounded composer in the shadow DOM.

const coreStyles = await Bun.file(join(import.meta.dir, "coreStyles.ts")).text();
const composer = await Bun.file(
  join(import.meta.dir, "../../components/SourceComposer.svelte"),
).text();

// The body of the CARET_OVERRIDES template literal — the override stylesheet that
// wins over the library core sheet in each view's shadow root.
function caretOverrides(src: string): string {
  const match = src.match(/const CARET_OVERRIDES = `([^`]*)`/);
  return match?.[1] ?? "";
}

const overrides = caretOverrides(coreStyles);

// The radius token the composer box rounds with (.composer's border-radius). The
// selection must round with the same token so the two read as one shape.
const COMPOSER_RADIUS = String.raw`var\(--radius-lg\)`;

describe("the drag-to-comment selection corner rounding (EXC-645)", () => {
  test("the composer box rounds with --radius-lg (the radius the selection must match)", () => {
    // Pins the reference: if the composer's box radius ever changes token, this
    // fails and forces the selection rules below to be re-pointed in lockstep.
    expect(composer).toMatch(/\.composer\s*\{[^}]*border-radius:\s*var\(--radius-lg\)/);
  });

  test("rounds the selection block via the library's [data-selected-line] hook", () => {
    // The amber selection is the only place [data-selected-line] is styled here;
    // rounding must hang off it — there is no wrapper element to round.
    expect(overrides).toContain("[data-selected-line]");
  });

  // Each block corner, the column it must be scoped to (left corners → the gutter
  // column, right corners → the content column), so a corner is rounded only on
  // the column that actually owns that edge.
  const CORNERS = [
    { corner: "border-top-left-radius", column: "data-gutter" },
    { corner: "border-bottom-left-radius", column: "data-gutter" },
    { corner: "border-top-right-radius", column: "data-content" },
    { corner: "border-bottom-right-radius", column: "data-content" },
  ] as const;

  for (const { corner, column } of CORNERS) {
    test(`rounds the selection's ${corner} on the ${column} column with the composer's radius token`, () => {
      // The corner is rounded with var(--radius-lg) — never a hardcoded px, so the
      // selection and the composer box never drift apart — within a rule scoped to
      // its own column, so only the block's true outer corner rounds (not an
      // interior cell of the opposite column).
      const rule = new RegExp(`\\[${column}\\][^{]*\\{[^}]*${corner}:\\s*${COMPOSER_RADIUS}`);
      expect(overrides).toMatch(rule);
    });
  }
});

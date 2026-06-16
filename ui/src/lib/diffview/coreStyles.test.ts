import { describe, expect, test } from "bun:test";
import { join } from "node:path";

// EXC-645: the drag-to-comment selection block must round its corners to match
// the comment composer's box. The selection is the @pierre/diffs per-cell
// [data-selected-line] highlight, rounded from caret's override sheet
// (CARET_OVERRIDES in coreStyles.ts, adopted into every view's shadow root after
// the library core sheet). The view is a two-column grid: line-number cells stack
// inside [data-gutter] and content/annotation cells inside [data-content], and
// [data-content]'s padding-inline-start leaves a gap between the two columns — so
// each column's selected run is its OWN standalone amber rectangle, not one block
// spanning both. Each therefore rounds all four of its corners. This matters most
// when line numbers are off: the gutter column collapses to zero width, leaving
// the content block as the only visible rectangle, so its LEFT corners must round
// too (rounding only its right corners — the original bug — left them square).
// This suite pins the contract structurally (every column rounds all four corners
// with the SAME radius token the composer uses) so a drift fails the unit suite
// rather than only showing as a square-cornered block in the shadow DOM.

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

// The override body with /* … */ comments stripped. The comments legitimately name
// [data-gutter]/[data-content] and corner properties in prose, which would let a
// selector regex span from a comment into an unrelated rule — so structural
// assertions scan the declarations alone (same approach as css-bridge.test.ts).
const overrideDecls = overrides.replace(/\/\*[\s\S]*?\*\//g, "");

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
    expect(overrideDecls).toContain("[data-selected-line]");
  });

  // Both columns are standalone rounded rectangles, so each rounds all four of its
  // corners. (The content column's LEFT corners are the EXC-645 regression: they
  // were square when the gutter collapsed with line numbers off.)
  const COLUMNS = ["data-gutter", "data-content"] as const;
  const CORNERS = [
    "border-top-left-radius",
    "border-top-right-radius",
    "border-bottom-left-radius",
    "border-bottom-right-radius",
  ] as const;

  for (const column of COLUMNS) {
    for (const corner of CORNERS) {
      test(`rounds the ${column} column's ${corner} with the composer's radius token`, () => {
        // Scoped to the column and rounded with var(--radius-lg) — never a
        // hardcoded px, so the selection and the composer box never drift apart.
        const rule = new RegExp(`\\[${column}\\][^{]*\\{[^}]*${corner}:\\s*${COMPOSER_RADIUS}`);
        expect(overrideDecls).toMatch(rule);
      });
    }
  }
});

import { describe, expect, test } from "bun:test";
import { join } from "node:path";

// EXC-664: the drag-to-comment selection reads as ONE continuous amber band
// spanning the [data-gutter] and [data-content] columns of the @pierre/diffs
// two-column grid, rounded from caret's override sheet (CARET_OVERRIDES in
// coreStyles.ts, adopted into every view's shadow root after the library core
// sheet). [data-content]'s padding-inline-start opens a seam between the columns;
// the band is made continuous by pulling each selected content cell across the
// seam (a negative inline-start margin, with the inset re-added as padding so the
// text never moves) and dropping the gutter column's per-row divider for selected
// rows. The band therefore rounds only its OUTER corners — the gutter column's
// left edge and the content column's right edge — with the --radius token, a
// tighter corner than the --radius-lg it used before (EXC-645). The inner corners
// where the columns join stay square so the band reads as one shape. Line numbers
// are always shown (EXC-664), so the gutter never collapses and the content's
// left corners never need rounding. This suite pins the contract structurally so
// a drift fails the unit suite rather than only showing in the shadow DOM.

const coreStyles = await Bun.file(join(import.meta.dir, "coreStyles.ts")).text();

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

const RADIUS = String.raw`var\(--radius\)`;

describe("the drag-to-comment selection band (EXC-664)", () => {
  test("rounds the selection block via the library's [data-selected-line] hook", () => {
    // The amber selection is the only place [data-selected-line] is styled here;
    // rounding must hang off it — there is no wrapper element to round.
    expect(overrideDecls).toContain("[data-selected-line]");
  });

  test("rounds with the tighter --radius token, never --radius-lg or a hardcoded px", () => {
    // Every corner-rounding declaration in the override uses var(--radius) — the
    // reduction from the previous --radius-lg is the whole point, so a drift back
    // (or to a raw px) fails here.
    const radiusRules = overrideDecls.match(/border-[a-z-]*radius:\s*[^;]+;/g) ?? [];
    expect(radiusRules.length).toBeGreaterThan(0);
    for (const rule of radiusRules) {
      expect(rule).toContain("var(--radius)");
      expect(rule).not.toContain("--radius-lg");
    }
  });

  // The band is one continuous rectangle, so only its OUTER corners round: the
  // gutter column's left edge (top + bottom) and the content column's right edge.
  // Each assertion is scoped to the band's own selected line cell ([data-column-
  // number]/[data-line] + [data-selected-line]) so it pins the SELECTION band, not
  // the separately-rounded fenced code-block panel (EXC-692) in the same sheet.
  const OUTER = [
    { column: "data-gutter", cell: "data-column-number", corner: "border-top-left-radius" },
    { column: "data-gutter", cell: "data-column-number", corner: "border-bottom-left-radius" },
    { column: "data-content", cell: "data-line", corner: "border-top-right-radius" },
    { column: "data-content", cell: "data-line", corner: "border-bottom-right-radius" },
  ] as const;
  for (const { column, cell, corner } of OUTER) {
    test(`rounds the ${column} column's ${corner} with var(--radius)`, () => {
      const rule = new RegExp(
        `\\[${column}\\][^{]*\\[${cell}\\]\\[data-selected-line\\][^{]*\\{[^}]*${corner}:\\s*${RADIUS}`,
      );
      expect(overrideDecls).toMatch(rule);
    });
  }

  // The inner corners — where the two columns meet — stay square so the band
  // reads as one shape, not two abutting rectangles. Scoped to the band's selected
  // line cell so the code-block panel's own left-corner rounding does not count.
  const INNER = [
    { column: "data-gutter", cell: "data-column-number", corner: "border-top-right-radius" },
    { column: "data-gutter", cell: "data-column-number", corner: "border-bottom-right-radius" },
    { column: "data-content", cell: "data-line", corner: "border-top-left-radius" },
    { column: "data-content", cell: "data-line", corner: "border-bottom-left-radius" },
  ] as const;
  for (const { column, cell, corner } of INNER) {
    test(`leaves the ${column} column's ${corner} square (the seamless join)`, () => {
      const rule = new RegExp(
        `\\[${column}\\][^{]*\\[${cell}\\]\\[data-selected-line\\][^{]*\\{[^}]*${corner}`,
      );
      expect(overrideDecls).not.toMatch(rule);
    });
  }

  test("fills the gutter→content seam so the band is continuous", () => {
    // The seam width is named once and reused — the content inset, the pull
    // margin, and the re-inset padding all reference --caret-seam, so they cannot
    // drift out of step (no repeated 24px literal).
    expect(overrideDecls).toMatch(/--caret-seam:\s*24px/);
    expect(overrideDecls).not.toMatch(/-24px/);
    expect(overrideDecls).toMatch(/padding-inline-start:\s*var\(--caret-seam\)/);
    // Each selected content code-line cell is pulled across the seam with a
    // negative inline-start margin (the shared --caret-seam); scoped to [data-line]
    // so an inline annotation/composer row caught in the selection is never shifted.
    expect(overrideDecls).toMatch(
      /\[data-content\]\s*>\s*\[data-line\]\[data-selected-line\]\s*\{[^}]*margin-inline-start:\s*calc\(-1 \* var\(--caret-seam\)\)/,
    );
    // The gutter column's per-row divider is dropped for selected line rows so the
    // two halves join with no 2px gap.
    expect(overrideDecls).toMatch(
      /\[data-gutter\]\s*>\s*\[data-column-number\]\[data-selected-line\]\s*\{[^}]*border-right-color:\s*transparent/,
    );
  });

  test("excludes the composer/annotation row from the band", () => {
    // The band styling is scoped to the line cells — the gutter's
    // [data-column-number] and the content's [data-line] — not every selected cell.
    expect(overrideDecls).toMatch(/\[data-content\]\s*>\s*\[data-line\]\[data-selected-line\]/);
    expect(overrideDecls).toMatch(
      /\[data-gutter\]\s*>\s*\[data-column-number\]\[data-selected-line\]/,
    );
    // The annotation/composer row the library also marks selected has its fill
    // cleared in both columns, so the surface shows through beside the composer
    // card rather than reading as more band (EXC-664).
    expect(overrideDecls).toMatch(
      /\[data-gutter\]\s*>\s*\[data-gutter-buffer\]\[data-selected-line\][^{]*\{[^}]*background-color:\s*transparent/,
    );
    expect(overrideDecls).toMatch(
      /\[data-content\]\s*>\s*\[data-line-annotation\]\[data-selected-line\][^{]*\{[^}]*background-color:\s*transparent/,
    );
  });
});

// EXC-692: fenced code blocks in the plan view read as a darker, rounded, slightly-
// indented panel in the content column. caret tags the shadow-DOM rows (data-code-
// line / -start / -end; see codeBlocks.ts) and this override sheet styles them. This
// suite pins the panel contract structurally so a drift fails the unit suite.
describe("the fenced code-block panel (EXC-692)", () => {
  test("fills code-line rows one step darker than the diff surface, scheme-correct", () => {
    // color-mix toward --ink carries correct depth in both schemes, matching the
    // layered-surface idiom; --paper-sunk is the diff surface the rows sit on.
    expect(overrideDecls).toMatch(
      /\[data-content\]\s*>\s*\[data-line\]\[data-code-line\]:not\(\[data-selected-line\]\)\s*\{[^}]*background-color:\s*color-mix\(in lab, var\(--paper-sunk\), var\(--ink\) \d+%\)/,
    );
  });

  test("makes the panel a contained card — inset both sides and width-capped", () => {
    const body =
      overrideDecls.match(
        /\[data-line\]\[data-code-line\]:not\(\[data-selected-line\]\)\s*\{[^}]*\}/,
      )?.[0] ?? "";
    expect(body).toContain("margin-inline-start:");
    expect(body).toContain("margin-inline-end:");
    expect(body).toContain("max-width:");
    // The code keeps the library's default 2ch inset — no extra indent past it.
    expect(body).toMatch(/padding-inline-start:\s*2ch\b/);
  });

  test("adds block padding on the first/last lines so the fences clear the corners", () => {
    expect(overrideDecls).toMatch(
      /\[data-line\]\[data-code-start\]:not\(\[data-selected-line\]\)\s*\{[^}]*padding-block-start:/,
    );
    expect(overrideDecls).toMatch(
      /\[data-line\]\[data-code-end\]:not\(\[data-selected-line\]\)\s*\{[^}]*padding-block-end:/,
    );
  });

  test("rounds only the block's first (top) and last (bottom) lines with var(--radius)", () => {
    expect(overrideDecls).toMatch(
      /\[data-line\]\[data-code-start\]:not\(\[data-selected-line\]\)\s*\{[^}]*border-top-left-radius:\s*var\(--radius\)[^}]*border-top-right-radius:\s*var\(--radius\)/,
    );
    expect(overrideDecls).toMatch(
      /\[data-line\]\[data-code-end\]:not\(\[data-selected-line\]\)\s*\{[^}]*border-bottom-left-radius:\s*var\(--radius\)[^}]*border-bottom-right-radius:\s*var\(--radius\)/,
    );
  });

  test("yields a selected code line to the amber band (every rule guards on selection)", () => {
    // CARET_OVERRIDES is adopted after the core sheet, so without the
    // :not([data-selected-line]) guard the panel fill would win over the library's
    // selection highlight. All three code-block rules must carry it.
    const codeRules = overrideDecls.match(/\[data-code-(?:line|start|end)\][^{]*\{/g) ?? [];
    expect(codeRules.length).toBe(3);
    for (const sel of codeRules) expect(sel).toContain(":not([data-selected-line])");
  });

  test("declares the code-block rules before the selection band", () => {
    const codeIdx = overrideDecls.indexOf("[data-code-line]");
    const bandIdx = overrideDecls.indexOf("[data-line][data-selected-line]");
    expect(codeIdx).toBeGreaterThan(-1);
    expect(bandIdx).toBeGreaterThan(codeIdx);
  });
});

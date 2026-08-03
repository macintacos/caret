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

  test("fills the gutter→content seam so every banded row is continuous", () => {
    // The seam width is named once and reused — the content inset, the pull
    // margin, and the re-inset padding all reference --caret-seam, so they cannot
    // drift out of step (no repeated seam literal).
    expect(overrideDecls).toMatch(/--caret-seam:\s*20px/);
    expect(overrideDecls).not.toMatch(/-20px/);
    expect(overrideDecls).toMatch(/padding-inline-start:\s*var\(--caret-seam\)/);
    // The seam-fill pull is shared by every row that carries a background band —
    // the drag-select selection, the pointer hover, and the add/del change rows —
    // so each banded content code-line cell is pulled across the seam with a
    // negative --caret-seam margin (the inset re-added as padding, text unmoved).
    const BANDED = ["data-selected-line", "data-hovered", "change-addition", "change-deletion"];
    const pull = overrideDecls.match(
      /\[data-content\]\s*>\s*\[data-line\]:is\(([\s\S]*?)\)\s*\{([\s\S]*?)\}/,
    );
    expect(pull).not.toBeNull();
    for (const state of BANDED) expect(pull![1]).toContain(state);
    expect(pull![2]).toMatch(/margin-inline-start:\s*calc\(-1 \* var\(--caret-seam\)\)/);
    // Glyph-lane modes (classic / caret "both") inset the line by 2ch instead of
    // 1ch, so a banded row in those modes re-adds 2ch + the seam.
    expect(overrideDecls).toMatch(/padding-inline-start:\s*calc\(2ch \+ var\(--caret-seam\)\)/);
    // The gutter column's per-row divider is dropped for the same banded rows so
    // the two halves join with no 2px gap.
    const border = overrideDecls.match(
      /\[data-gutter\]\s*>\s*\[data-column-number\]:is\(([\s\S]*?)\)\s*\{([\s\S]*?)\}/,
    );
    expect(border).not.toBeNull();
    for (const state of BANDED) expect(border![1]).toContain(state);
    expect(border![2]).toMatch(/border-right-color:\s*transparent/);
  });

  test("marks non-pointer selected rows with a faded tick in the + lane", () => {
    // During a drag range-select the library renders the "+" only on the pointer
    // row ([data-hovered]); the rest of the range gets a faded ::after tick so the
    // whole selection reads as one. Scoped to :not([data-hovered]) so it never
    // doubles with the real button on the active row.
    const marker = overrideDecls.match(
      /\[data-column-number\]\[data-selected-line\]:not\(\[data-hovered\]\)::after\s*\{([\s\S]*?)\}/,
    );
    expect(marker).not.toBeNull();
    expect(marker![1]).toMatch(/background-color:\s*var\(--accent\)/);
    expect(marker![1]).toMatch(/opacity:/);
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

// EXC-764 follow-up: the library has no "bars + glyphs" mode, so caret's "both"
// indicators drive it at "bars" and this sheet overlays the classic +/- glyphs,
// scoped to the host flag (SourceDiffView sets data-caret-indicators="both").
describe('the combined "both" indicators overlay', () => {
  test("overlays the +/- glyphs on change rows via the host flag", () => {
    // Scoped to the host flag so bars/classic mode never grow the glyphs.
    expect(overrideDecls).toMatch(/:host\(\[data-caret-indicators="both"\]\)/);
    // A 2ch inline lane opens on every content line to seat the glyph.
    expect(overrideDecls).toMatch(
      /:host\(\[data-caret-indicators="both"\]\)\s*\[data-content\]\s*\[data-line\]\s*\{[^}]*padding-inline-start:\s*2ch/,
    );
    // The + and - glyphs are painted on the add/del change rows.
    expect(overrideDecls).toMatch(/change-addition"\]::before\s*\{[^}]*content:\s*"\+"/);
    expect(overrideDecls).toMatch(/change-deletion"\]::before\s*\{[^}]*content:\s*"-"/);
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

  test("pads only the outer edges of the fence lines (they hug the code within)", () => {
    const startBody =
      overrideDecls.match(/\[data-code-start\]:not\(\[data-selected-line\]\)\s*\{[^}]*\}/)?.[0] ??
      "";
    const endBody =
      overrideDecls.match(/\[data-code-end\]:not\(\[data-selected-line\]\)\s*\{[^}]*\}/)?.[0] ?? "";
    // Opening fence: space above only; closing fence: space below only — so the
    // fence lines hug the code and there's no inner gap.
    expect(startBody).toContain("padding-block-start:");
    expect(startBody).not.toMatch(/padding-block-end:|padding-block:/);
    expect(endBody).toContain("padding-block-end:");
    expect(endBody).not.toMatch(/padding-block-start:|padding-block:/);
  });

  test("rounds only the block's first (top) and last (bottom) lines with var(--radius)", () => {
    expect(overrideDecls).toMatch(
      /\[data-line\]\[data-code-start\]:not\(\[data-selected-line\]\)\s*\{[^}]*border-top-left-radius:\s*var\(--radius\)[^}]*border-top-right-radius:\s*var\(--radius\)/,
    );
    expect(overrideDecls).toMatch(
      /\[data-line\]\[data-code-end\]:not\(\[data-selected-line\]\)\s*\{[^}]*border-bottom-left-radius:\s*var\(--radius\)[^}]*border-bottom-right-radius:\s*var\(--radius\)/,
    );
  });

  test("centers the closing fence markers and the language tag on their rows", () => {
    // shiki emits no classes, so codeBlocks.ts tags the two fence-line tokens and
    // this sheet shifts each with position: relative (moves the glyph, not the
    // panel background). A fence marker glyph sits high, so the closing markers move
    // DOWN (positive top); the language is a baseline word its row's top padding
    // pushed low, so it moves UP (negative top).
    const fenceRule =
      overrideDecls.match(/\[data-code-end\][^{]*\[data-code-fence\]\s*\{[^}]*\}/)?.[0] ?? "";
    const langRule =
      overrideDecls.match(/\[data-code-start\][^{]*\[data-code-lang\]\s*\{[^}]*\}/)?.[0] ?? "";
    expect(fenceRule).toContain("position: relative");
    expect(fenceRule).toMatch(/top:\s*0?\.\d+em/); // positive → down
    expect(langRule).toContain("position: relative");
    expect(langRule).toMatch(/top:\s*-0?\.\d+em/); // negative → up
  });

  test("yields a selected code line to the amber band (every fill rule guards on selection)", () => {
    // CARET_OVERRIDES is adopted after the core sheet, so a background fill on a code row
    // would win over the library's amber selection highlight unless it yields. Every rule that
    // fills a code row — the per-row panel fill and the card's cleared library fill — must
    // carry :not([data-selected-line]); layout-only rules (padding, radius) need not, so the
    // check is scoped to rules that set a background-color.
    const codeRowFillRules = (
      overrideDecls.match(/\[data-code-(?:line|start|end)\][^{]*\{[^}]*\}/g) ?? []
    ).filter((rule) => /background-color:/.test(rule));
    expect(codeRowFillRules.length).toBeGreaterThan(0);
    for (const rule of codeRowFillRules) {
      expect(rule).toContain(":not([data-selected-line])");
    }
  });

  test("declares the code-block rules before the selection band", () => {
    const codeIdx = overrideDecls.indexOf("[data-code-line]");
    const bandIdx = overrideDecls.indexOf("[data-line][data-selected-line]");
    expect(codeIdx).toBeGreaterThan(-1);
    expect(bandIdx).toBeGreaterThan(codeIdx);
  });
});

// EXC-729: a fenced-code line wider than the panel must stay INSIDE the card and scroll
// horizontally, not break out of the background. The EXC-692 panel caps rows at max-width, but
// the library renders source lines white-space: pre, so an over-wide line overflowed the
// capped box and floated over the surface. The fix wraps an overflowing block in ONE scroll
// card ([data-code-card]) that is a single native horizontal scroll container — the whole
// block scrolls as one unit (short lines follow, one scrollbar, no per-row jelly) and its
// subgrid rows keep the gutter aligned. This suite pins the CSS side.
describe("the fenced code-block scroll card (EXC-729)", () => {
  const cardBody =
    overrideDecls.match(/\[data-content\]\s*>\s*\[data-code-card\]\s*\{[^}]*\}/)?.[0] ?? "";

  test("wraps the block in a single subgrid horizontal scroll container", () => {
    expect(cardBody).toMatch(/display:\s*grid/);
    // subgrid rows map to the parent tracks, so the gutter line numbers stay aligned.
    expect(cardBody).toMatch(/grid-template-rows:\s*subgrid/);
    expect(cardBody).toMatch(/overflow-x:\s*auto/);
    // the block axis is clipped (hidden), so a single-line-tall row grows no vertical bar.
    expect(cardBody).toMatch(/overflow-y:\s*hidden/);
  });

  test("sizes the scroll content to the widest line while capping the visible card", () => {
    // max-content columns let the content grow to the longest line (the scroll range); the
    // max-width holds the visible card to its reading width so it scrolls WITHIN the card.
    expect(cardBody).toMatch(/grid-auto-columns:\s*max-content/);
    expect(cardBody).toContain("max-width:");
  });

  test("carries the same panel look as the per-row card so both read identically", () => {
    // A fitting block keeps the per-row card path; a scrolling block uses this wrapper. They
    // share the fill, inset, and rounding so the two paths are visually indistinguishable.
    expect(cardBody).toMatch(
      /background-color:\s*color-mix\(in lab, var\(--paper-sunk\), var\(--ink\) \d+%\)/,
    );
    expect(cardBody).toContain("margin-inline:");
    expect(cardBody).toMatch(/border-radius:\s*var\(--radius\)/);
  });

  test("clips a not-yet-wrapped row so it can't break out before the card wraps it", () => {
    // The per-row rule is the graceful floor for the frame before codeBlockScroll.ts wraps the
    // block (or if the script never runs): the over-wide line clips at the card's right edge
    // instead of spilling over the surface. Inline axis only, so the block stays visible and
    // the EXC-692 fence-glyph nudges are not shaved.
    const rowBody =
      overrideDecls.match(
        /\[data-content\]\s*>\s*\[data-line\]\[data-code-line\]:not\(\[data-selected-line\]\)\s*\{[^}]*\}/,
      )?.[0] ?? "";
    expect(rowBody).toMatch(/overflow-x:\s*clip/);
    expect(rowBody).not.toMatch(/overflow-x:\s*(?:auto|scroll)/);
  });
});

// EXC-729: one scrollbar per block, not one per line. The card is a native scroll container,
// so a single classic scrollbar sits at its bottom in a reserved lane. Styling
// ::-webkit-scrollbar keeps that bar always-visible (the standard scrollbar-* props would let
// Chromium pull back the auto-hiding overlay bar); the last row's track reserves the lane so
// the bar never overlaps the code, and the gutter's matching track grows with it via subgrid.
describe("the single per-block code scrollbar (EXC-729)", () => {
  const cardBody =
    overrideDecls.match(/\[data-content\]\s*>\s*\[data-code-card\]\s*\{[^}]*\}/)?.[0] ?? "";

  test("reserves a bottom lane on the card's last row for the bar", () => {
    expect(overrideDecls).toMatch(
      /\[data-code-card\]\s*>\s*\[data-line\]\[data-code-end\]\s*\{[^}]*padding-block-end:/,
    );
  });

  test("styles the bar via ::-webkit-scrollbar only, so it stays always-visible", () => {
    // Setting scrollbar-width/color on the card would let Chromium pull back the auto-hiding
    // platform scrollbar; the custom ::-webkit-* thumb is what keeps the single bar shown.
    expect(cardBody).not.toMatch(/scrollbar-width:|scrollbar-color:/);
    expect(overrideDecls).toMatch(/\[data-code-card\]::-webkit-scrollbar-thumb\s*\{/);
  });

  test("keeps the thumb a caret-neutral ink mix, not amber", () => {
    // The diff surface reserves amber for selection, so the bar is a neutral paper→ink mix.
    const thumb =
      overrideDecls.match(/\[data-code-card\]::-webkit-scrollbar-thumb\s*\{[^}]*\}/)?.[0] ?? "";
    expect(thumb).toMatch(/color-mix\(in lab, var\(--paper-sunk\), var\(--ink\) \d+%\)/);
    expect(thumb).toMatch(/border-radius:\s*var\(--radius\)/);
  });
});

// EXC-687: a resolved filename reference token (tagged data-file-ref by
// fileRefTag.ts) gets a small file icon before it, rendered as a mask so it takes
// the ink color. This pins the rule structurally.
describe("the filename-reference icon (EXC-687)", () => {
  const iconRule =
    overrideDecls.match(/\[data-content\]\s*\[data-file-ref\]::before\s*\{[^}]*\}/)?.[0] ?? "";

  test("scopes the icon to a content-column file-ref token's ::before", () => {
    expect(iconRule).not.toBe("");
    expect(iconRule).toContain('content: ""');
  });

  test("tints the mask with the faint ink token (no hardcoded color)", () => {
    expect(iconRule).toContain("background-color: var(--ink-faint)");
    expect(iconRule).toMatch(/mask:\s*\$\{FILE_ICON_MASK\}/);
  });
});

// EXC-840: the file reference opens its preview on click; hover highlights it.
// The highlight is CSS — a faint amber wash on the tagged token, the same warm
// hue as its inline-code text — so the pins here keep it warm (not grey), roomy
// (a chip around the reference, no layout shift), and motionless. A reference
// carrying a link target also shows a tooltip on hover (EXC-954); that one is
// rendered in JS and out of scope for these CSS pins.
describe("the filename-reference hover highlight (EXC-840)", () => {
  const tokenRule =
    overrideDecls.match(/\[data-content\]\s*\[data-file-ref\]\s*\{[^}]*\}/)?.[0] ?? "";
  const hoverRule =
    overrideDecls.match(/\[data-content\]\s*\[data-file-ref\]:hover\s*\{[^}]*\}/)?.[0] ?? "";

  test("the token always carries the pointer cursor — it is clickable", () => {
    expect(tokenRule).toContain("cursor: pointer");
  });

  test("the token reserves breathing room so the wash reads as a chip, not cramped", () => {
    // Padding widens the wash out past the glyphs; a matching negative inline
    // margin offsets it so the surrounding backticks never shift.
    expect(tokenRule).toMatch(/padding/);
    expect(tokenRule).toMatch(/margin-inline:\s*-/);
  });

  test("hover paints the faint amber accent wash with the control radius", () => {
    expect(hoverRule).toMatch(/background-color:\s*var\(--accent-wash\)/);
    expect(hoverRule).toMatch(/border-radius:\s*var\(--radius\)/);
  });

  test("the hover swap is instant — the diff surface stays motionless", () => {
    expect(tokenRule).not.toMatch(/transition|animation/);
    expect(hoverRule).not.toMatch(/transition|animation/);
  });
});

describe("the plan-search highlights (EXC-832, rehued EXC-905)", () => {
  const allMatches = overrideDecls.match(/::highlight\(caret-search\)\s*\{[^}]*\}/)?.[0] ?? "";
  const currentMatch =
    overrideDecls.match(/::highlight\(caret-search-current\)\s*\{[^}]*\}/)?.[0] ?? "";

  // Both extractions fall back to "" on a regex miss, and `not.toContain` passes
  // vacuously over an empty string — so pin non-emptiness before asserting absence.
  test("both highlight rules are present to assert against", () => {
    expect(allMatches).not.toBe("");
    expect(currentMatch).not.toBe("");
  });

  test("every match rides --mark, the content-highlight token", () => {
    expect(allMatches).toMatch(/background-color:\s*var\(--mark\)/);
  });

  test("the current match rides --mark-active, the same vocabulary a step up", () => {
    expect(currentMatch).toMatch(/background-color:\s*var\(--mark-active\)/);
  });

  // A search hit marks content; it is not the reviewer's selection. Reaching for
  // --accent here is what left --mark-active unread for as long as it was.
  test("neither spends the selection hue", () => {
    expect(allMatches).not.toContain("--accent");
    expect(currentMatch).not.toContain("--accent");
  });
});

describe("the resting-state link mark", () => {
  const linkRule = overrideDecls.match(/::highlight\(caret-link\)\s*\{[^}]*\}/)?.[0] ?? "";

  // The extraction falls back to "" on a regex miss, and the assertions below
  // would pass vacuously over one — pin non-emptiness first.
  test("the rule is present to assert against", () => {
    expect(linkRule).not.toBe("");
  });

  // The two properties a highlight pseudo supports that a link needs. Without
  // the decoration a link reads as tinted prose; without the tint it reads as
  // underlined prose. Both, or the affordance is half-drawn.
  test("it tints the glyphs and dots the underline", () => {
    expect(linkRule).toMatch(/color:\s*color-mix\([^)]*var\(--ink\)[^)]*var\(--accent\)/);
    expect(linkRule).toMatch(/text-decoration:\s*underline dotted/);
  });

  // Amber stays scarce: a link takes a minority mix into the ink, not the accent
  // itself, so a paragraph of links never reads as a page of selections.
  test("the accent is mixed in, not spent whole", () => {
    expect(linkRule).not.toMatch(/color:\s*var\(--accent[^)]*\)\s*;/);
  });
});

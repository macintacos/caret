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

/** Every declaration block under a `[data-content] … <tail>` selector, in source order.
 * A bare `.match()` yields only the first, and each decoration-pass member carries two
 * rules under one selector — the properties the text intrinsically has, then its tint
 * variable — so picking by position pins the wrong half as the file grows. */
function rulesFor(tail: string): string[] {
  const pattern = new RegExp(String.raw`\[data-content\][^{}]*${tail}\s*\{[^}]*\}`, "g");
  return [...overrideDecls.matchAll(pattern)].map((m) => m[0]);
}

/** A `data-md` member's tint rule — the one declaring its `--md-<member>` layer variable. */
function tintRule(member: string): string {
  return (
    rulesFor(String.raw`\[data-md~="${member}"\]`).find((r) => r.includes(`--md-${member}:`)) ?? ""
  );
}

/** A `data-md` member's other rule — the one carrying the properties the text intrinsically
 * has (bold's weight, italic's slant, a link's ink). Defined as the complement of
 * `tintRule` rather than by sniffing for a property name, so it stays correct when a
 * member's intrinsic set changes. */
function propsRule(member: string): string {
  return (
    rulesFor(String.raw`\[data-md~="${member}"\]`).find((r) => !r.includes(`--md-${member}:`)) ?? ""
  );
}

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
    // (or to a raw px) fails here. A literal 0 is the one other admissible value: it
    // is the ABSENCE of a corner rather than a second opinion about how round one
    // should be, and squaring a nested member is how a pill stays one shape (EXC-868
    // squares a file reference sitting inside a codespan). Any other literal still
    // fails, so the token discipline this test exists for is intact.
    const radiusRules = overrideDecls.match(/border-[a-z-]*radius:\s*[^;]+;/g) ?? [];
    expect(radiusRules.length).toBeGreaterThan(0);
    for (const rule of radiusRules) {
      expect(rule).toMatch(/:\s*(var\(--radius\)|0);/);
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
    // the two halves join with no 2px gap. A DESCENDANT selector, not a child one:
    // a carded block's gutter cells sit inside a display:contents card (EXC-729's
    // for an overflowing fence, EXC-864's for every table), which a child combinator
    // stops matching — the row would keep its divider and read with a gap.
    const border = overrideDecls.match(
      /\[data-gutter\]\s+\[data-column-number\]:is\(([\s\S]*?)\)\s*\{([\s\S]*?)\}/,
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
    // card rather than reading as more band (EXC-664). Descendant since EXC-865 — a
    // comment on a table line puts that row inside the table's card, and its buffer
    // inside the gutter mirror.
    expect(overrideDecls).toMatch(
      /\[data-gutter\]\s+\[data-gutter-buffer\]\[data-selected-line\][^{]*\{[^}]*background-color:\s*transparent/,
    );
    expect(overrideDecls).toMatch(
      /\[data-content\]\s+\[data-line-annotation\]\[data-selected-line\][^{]*\{[^}]*background-color:\s*transparent/,
    );
  });

  // EXC-865: a carded row reads as a banded row. The library will not mark one at all
  // (cardSelection.ts owns that), and two of the three things that then paint the band
  // had to change shape to reach it — which is what these pin.
  test("carries the band across the seam from the gutter side for a carded row", () => {
    // A carded row cannot pull left across the seam: its card is an overflow-x: auto
    // scroll container, so anything painted outside that box is clipped. The strip is
    // painted from the gutter cell instead, which nothing clips.
    const extension = overrideDecls.match(
      /\[data-gutter\]\s+:is\(\[data-table-card-gutter\], \[data-code-card-gutter\]\)\s*>\s*\[data-column-number\]:is\([^)]*\)::before\s*\{([^}]*)\}/,
    );
    expect(extension).not.toBeNull();
    // Its width is exactly the two insets it has to cover, both named rather than
    // written as literals that could drift from the card's own margin.
    expect(extension?.[1]).toMatch(
      /width:\s*calc\(var\(--caret-seam\)\s*\+\s*var\(--caret-card-inset\)\)/,
    );
    // inherit rather than a named fill, so one rule covers selection, hover and cursor.
    expect(extension?.[1]).toMatch(/background-color:\s*inherit/);
    // Offset from the cell's BORDER box. 100% alone resolves against the padding box,
    // which on a gutter cell is two pixels short of the card — the strip would leave a
    // hairline in the very seam it exists to fill.
    expect(extension?.[1]).toMatch(
      /inset-inline-start:\s*calc\(100%\s*\+\s*var\(--caret-gutter-divider\)\)/,
    );
    // And the card's own inset reads the same token, so the two cannot drift.
    expect(overrideDecls).toMatch(
      /\[data-content\]\s*>\s*\[data-table-card\]\s*\{[^}]*margin-inline:\s*var\(--caret-card-inset\)/,
    );
  });

  test("takes a rounded end back off where the band continues past a card", () => {
    // Widened to descendant, the sibling logic rounds a card's first and last selected
    // rows — right for a selection wholly inside one, wrong for one that runs past it.
    for (const corner of ["top-left", "top-right", "bottom-left", "bottom-right"]) {
      const column = corner.endsWith("left") ? "gutter" : "content";
      const card = corner.endsWith("left")
        ? String.raw`\[data-table-card-gutter\], \[data-code-card-gutter\]`
        : String.raw`\[data-table-card\], \[data-code-card\]`;
      const override = new RegExp(
        String.raw`\[data-${column}\][^{}]*:is\(${card}\)[^{}]*\{[^}]*border-${corner}-radius:\s*0`,
      );
      expect(overrideDecls).toMatch(override);
      // The override ties with the widened rule on specificity and wins on source order
      // alone, so the order is the contract: reversed, the square-ends bug comes back
      // with every assertion above still green.
      const widened = new RegExp(
        String.raw`\[data-${column}\]\s*\n?\s*\[data-(?:column-number|line)\]\[data-selected-line\][^{}]*\{[^}]*border-${corner}-radius:\s*var\(--radius\)`,
      );
      expect(overrideDecls.search(widened)).toBeGreaterThan(-1);
      expect(overrideDecls.search(override)).toBeGreaterThan(overrideDecls.search(widened));
    }
  });

  test("places a carded comment's row across the table's columns", () => {
    const row = overrideDecls.match(
      /\[data-content\]\s*>\s*\[data-table-card\]\s*>\s*\[data-line-annotation\]\s*\{([^}]*)\}/,
    );
    expect(row).not.toBeNull();
    expect(row?.[1]).toMatch(/grid-column:\s*1\s*\/\s*-1/);
    // Out of the track sizing: a spanning grid item contributes its own max-content to
    // every track it covers, and a composer's would push a narrow table into scroll.
    expect(row?.[1]).toMatch(/contain:\s*inline-size/);
    // The drawn width and the sticky position both belong on the library's wrapper, not
    // on the row: the row is stretched to its whole grid area, so it has no slack to
    // stick within, and a definite width on it is distributed back into the tracks.
    expect(row?.[1]).not.toMatch(/position:\s*sticky/);
    const content = overrideDecls.match(
      /\[data-table-card\]\s*>\s*\[data-line-annotation\]\s*>\s*\[data-annotation-content\]\s*\{([^}]*)\}/,
    );
    // Capped by BOTH the reading measure and the card's own visible width. The reading
    // measure alone is right only while the pane is wide enough for the card to reach
    // it; below that the comment overhangs the card and the Comment button lands beyond
    // its scroll edge.
    expect(content?.[1]).toMatch(/max-width:\s*min\(/);
    expect(content?.[1]).toMatch(/var\(--caret-read-max\)/);
    expect(content?.[1]).toMatch(/var\(--diffs-column-content-width/);
    expect(content?.[1]).toMatch(/var\(--caret-seam\)/);
    expect(content?.[1]).toMatch(/var\(--caret-card-inset\)/);
    // And the library's own sticky offset, meant for the whole view's sideways scroll,
    // is reset — inside a card it measures against the wrong scroll box.
    expect(content?.[1]).toMatch(/inset-inline-start:\s*0/);
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

// EXC-869: the ``` / ~~~ delimiters stay visible and take the EXC-855 chip family's
// round-rect treatment, so a fenced block reads as a deliberate element. Nothing is
// hidden, so this suite pins the chip's shape rather than any row's absence.
describe("the fence-marker chip (EXC-869)", () => {
  // Matched from [data-content] so the assertions below can read the COMBINATOR, not
  // just the body. [^{}] can cross neither brace, so the match stays inside one rule's
  // selector; [data-code-line] is what separates the chip from the EXC-692 centering
  // rules, which name [data-code-fence] under [data-code-end] instead.
  const chipRule =
    overrideDecls.match(
      /\[data-content\][^{}]*\[data-code-line\][^{}]*\[data-code-fence\]\s*\{[^}]*\}/,
    )?.[0] ?? "";

  test("fills the fence markers with the family's inline-code chip token", () => {
    // The tint is CONSUMED, never redefined here: --chip-code is the chip family's shared
    // token, derived for all nine palettes by the recipe (EXC-858), so the fence chip and
    // the inline-code chip (EXC-868) spend one token rather than a matched value — one
    // token, not one rendered colour, for the reasons the rule itself carries. A bare
    // var() with no fallback is the point here: a fallback would silently paint a second,
    // unreviewed tint if the token ever stopped resolving.
    expect(chipRule).toMatch(/background-color:\s*var\(--chip-code\)/);
    expect(chipRule).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(chipRule).not.toMatch(/color-mix/);
  });

  test("wears the family's shared radius", () => {
    expect(chipRule).toMatch(new RegExp(String.raw`border-radius:\s*${RADIUS}`));
  });

  test("shifts no column: any inline padding is cancelled by an equal negative margin", () => {
    // Rows render white-space: pre, so UNCANCELLED inline padding on a token moves every
    // glyph after it. Inline padding is allowed only paired with an equal negative margin —
    // the escape hatch [data-file-ref] already uses in this sheet — so this pins the
    // column-parity invariant rather than banning the technique.
    expect(chipRule).not.toMatch(/padding-left|padding-right|margin-left|margin-right/);
    const pad = chipRule.match(/padding-inline:\s*([\d.]+)em/)?.[1];
    const margin = chipRule.match(/margin-inline:\s*-([\d.]+)em/)?.[1];
    expect(pad).toBe(margin); // both absent, or equal and opposite
  });

  test("reaches the scroll card's rows as well as the direct-child rows", () => {
    // An overflowing block's rows are re-parented into [data-code-card], so a child
    // combinator would chip only the fitting blocks. The selector is a descendant one.
    expect(chipRule).not.toMatch(/\[data-content\]\s*>\s*\[data-line\]\[data-code-line\]/);
    expect(chipRule).toMatch(/\[data-content\]\s+\[data-line\]\[data-code-line\]/);
  });
});

// EXC-867: the inline emphasis chips, the first prose members of the EXC-855 chip family.
// The real weight and slant come from shiki (caret-theme.ts) — EXC-858 measured bold's and
// italic's tints within a 1.05 contrast ratio in five of nine palettes, so the tint alone
// cannot be the separator. What this suite pins is the chip's shape and, above all, that it
// costs the monospace grid nothing.
describe("the inline emphasis chips (EXC-867)", () => {
  const fillRule = overrideDecls.match(/\[data-content\][^{}]*\[data-md\]\s*\{[^}]*\}/)?.[0] ?? "";
  const startRule =
    overrideDecls.match(/\[data-content\][^{}]*\[data-md-start\]\s*\{[^}]*\}/)?.[0] ?? "";
  const endRule =
    overrideDecls.match(/\[data-content\][^{}]*\[data-md-end\]\s*\{[^}]*\}/)?.[0] ?? "";

  test("declares the weight and slant itself, ungated by selection", () => {
    // @pierre/diffs carries shiki's font style into the DOM as a custom property and then
    // consumes it with font-weight: light-dark(…), which is invalid — light-dark() is
    // defined over <color> only — so the library renders every token at one weight. caret
    // declares both off the decoration pass's own attributes instead.
    const weight = propsRule("bold");
    const slant = propsRule("italic");
    expect(weight).toMatch(/font-weight:\s*bold/);
    expect(slant).toMatch(/font-style:\s*italic/);
    // Weight and slant are what the text IS, so unlike the tint they survive selection.
    expect(weight).not.toMatch(/:not\(\[data-selected-line\]\)/);
    expect(slant).not.toMatch(/:not\(\[data-selected-line\]\)/);
  });

  test("spends the family's own bold and italic tints, and declares neither", () => {
    // Consumed, never redefined: the recipe (EXC-858) derives all five tints for all nine
    // palettes, so a literal here would be a tenth, unreviewed palette.
    expect(overrideDecls).toMatch(/\[data-md~="bold"\]\s*\{[^}]*var\(--chip-bold\)/);
    expect(overrideDecls).toMatch(/\[data-md~="italic"\]\s*\{[^}]*var\(--chip-italic\)/);
    expect(fillRule).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(fillRule).not.toMatch(/color-mix/);
  });

  test("layers the tints so a run carrying two members shows both", () => {
    // ***x*** is genuinely bold AND italic, and the middle run of **a `c` b** is bold and
    // code. A single background-color would let the more specific rule win and punch a gap
    // through the middle of the bold pill, so each member gets its own layer.
    expect(fillRule).toMatch(/background-image:/);
    expect(fillRule).toMatch(/var\(--md-bold,\s*transparent\)/);
    expect(fillRule).toMatch(/var\(--md-italic,\s*transparent\)/);
    // The transparent fallback is what makes an absent member paint nothing without any
    // default declaration having to out-specify the member rules above.
    expect(fillRule).not.toMatch(/--md-bold:\s/);
  });

  test("rounds only the ends of a group, so a fragmented element draws one pill", () => {
    // An element split across several runs closes its pill once — the same shape
    // data-code-start / data-code-end already draw for a fenced block.
    expect(startRule).toMatch(new RegExp(String.raw`border-start-start-radius:\s*${RADIUS}`));
    expect(startRule).toMatch(new RegExp(String.raw`border-end-start-radius:\s*${RADIUS}`));
    expect(endRule).toMatch(new RegExp(String.raw`border-start-end-radius:\s*${RADIUS}`));
    expect(endRule).toMatch(new RegExp(String.raw`border-end-end-radius:\s*${RADIUS}`));
    // A blanket border-radius on every run would close the pill at every internal seam.
    expect(fillRule).not.toMatch(/border-radius/);
  });

  test("shifts no column: the chip carries no padding or margin at all", () => {
    // The issue's own de-escalation ladder names the monospace grid as the likeliest
    // trigger. Rows render white-space: pre, so inline padding moves every glyph after the
    // chip and vim motions, drag ranges and search highlights stop matching source columns.
    // [data-file-ref]'s cancelled padding/negative-margin pair is not available here —
    // emphasis chips can abut, so the negative margins would overlap.
    for (const rule of [fillRule, startRule, endRule]) {
      expect(rule).not.toMatch(/padding/);
      expect(rule).not.toMatch(/margin/);
    }
  });

  test("drops the decoration tints on a selected row so a drag reads as one flat band", () => {
    // The guard rides each member's own tint VARIABLE rather than the shared fill rule,
    // because the members disagree about it: the link chip (EXC-859) keeps its tint through
    // a selection. background-image is one property, so a second unguarded rule would
    // replace the whole stack rather than add a layer to it — an unset variable falling
    // back to transparent is what lets one stack carry two policies.
    expect(tintRule("bold")).toMatch(/:not\(\[data-selected-line\]\)/);
    expect(tintRule("italic")).toMatch(/:not\(\[data-selected-line\]\)/);
    // Code sides with them (EXC-868): it marks a span rather than offering an action, the
    // same call the fence chip makes with the same token.
    expect(tintRule("code")).toMatch(/:not\(\[data-selected-line\]\)/);
    expect(fillRule).not.toMatch(/:not\(\[data-selected-line\]\)/);
  });
});

// EXC-859: the link chip, the family's fifth member and the compensating half of EXC-866 —
// that ticket generalized the collapse of [label](target) to every safe link, leaving the
// bare label where the markup used to be. This member takes EXC-880's side of the family's
// selection split rather than EXC-869's: a fence chip is decoration and drops on a
// drag-selected row so the band reads flat, while the reference chip stays lit because an
// affordance's chip is not decoration to be tidied away — and a link chip vanishing beside
// a reference chip on the same selected row would read as a glitch rather than a policy.
// The link's ink and underline are ungated for a different reason again: like bold's
// weight, they are what the text IS. What only a real browser can say is that the cascade
// actually resolves that way, which is diff-surface e2e's half (links.e2e.ts).
describe("the link chip (EXC-859)", () => {
  const inkRule = propsRule("link");
  const linkTint = tintRule("link");
  const fillRule = rulesFor(String.raw`\[data-md\]`)[0] ?? "";
  const startRule = rulesFor(String.raw`\[data-md-start\]`)[0] ?? "";
  const endRule = rulesFor(String.raw`\[data-md-end\]`)[0] ?? "";

  // Every extraction falls back to "" on a regex miss, over which `not.toMatch` passes
  // vacuously — pin non-emptiness on all of them before asserting any absence.
  test("every rule this suite asserts against is present", () => {
    for (const rule of [inkRule, linkTint, fillRule, startRule, endRule]) {
      expect(rule).not.toBe("");
    }
  });

  test("tints the glyphs and dots the underline", () => {
    // A link is a control the reader can act on, so it marks itself the way body text
    // does — the glyphs take the color and the underline sits under them — and the chip
    // is what the collapse adds on top. Without the underline a link reads as tinted
    // prose; without the tint it reads as underlined prose. Both, or the affordance is
    // half-drawn. The tint is a minority mix of the accent into --ink, never the accent
    // itself: amber stays scarce and brand-reserved, so a paragraph of links never reads
    // as a page of selections.
    expect(inkRule).toMatch(/color:\s*color-mix\([^)]*var\(--ink\)[^)]*var\(--accent\)/);
    expect(inkRule).toMatch(/text-decoration:\s*underline dotted/);
    expect(inkRule).not.toMatch(/color:\s*var\(--accent[^)]*\)\s*;/);
  });

  test("spends the family's own link tint through its own layer, and declares none", () => {
    // Consumed, never redefined: the recipe (EXC-858) derives all five tints for all nine
    // palettes, so a literal here would be a tenth, unreviewed palette. A layer rather
    // than a background-color so a bold link shows both members at once, exactly as a
    // bold-italic run does.
    expect(linkTint).toMatch(/--md-link:\s*var\(--chip-link\)/);
    expect(fillRule).toMatch(/var\(--md-link,\s*transparent\)/);
    expect(linkTint).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  test("carries no selection guard, so the chip survives a drag-select intact", () => {
    // The radius rules are ungated alongside the tint, and that costs the other members
    // nothing: a bold or italic token on a selected row has no tint at all, and the amber
    // band is painted on the ROW rather than the token, so there is no background for a
    // radius to clip. Gated, the link chip would read as a square block inside the band.
    for (const rule of [inkRule, linkTint, startRule, endRule]) {
      expect(rule).not.toMatch(/:not\(\[data-selected-line\]\)/);
    }
  });

  test("shifts no column: the chip carries no padding or margin at all", () => {
    // Same constraint the emphasis chips carry, for the same reason — rows render
    // white-space: pre, so inline padding moves every glyph after the chip and vim
    // motions, drag ranges and search highlights stop matching source columns. A link
    // label can abut the prose around it, so [data-file-ref]'s cancelled
    // padding/negative-margin pair is not available here either.
    for (const rule of [inkRule, linkTint]) {
      expect(rule).not.toMatch(/padding/);
      expect(rule).not.toMatch(/margin/);
    }
  });
});

// EXC-868: the inline-code chip, the third prose member of the EXC-855 chip family. The
// decoration pass already tags a codespan data-md~="code" and already closes its pill once
// per ELEMENT (EXC-867), so the whole render is one layer variable and one gradient — which
// is all this suite has to pin, plus the one call the ticket had to make: that the tint is
// the same token the fence chip spends rather than a second value corrected for the surface.
// The geometry the code member rides is shared with bold and italic, so the "shifts no
// column" and "drops the chip on a selected row" pins above already cover it and are not
// repeated here.
describe("the inline-code chip (EXC-868)", () => {
  const fillRule = rulesFor(String.raw`\[data-md\]`)[0] ?? "";
  const fenceRule = rulesFor(String.raw`\[data-code-fence\]`).find((r) =>
    r.includes("background-color:"),
  );
  const nestedRef = rulesFor(String.raw`\[data-file-ref\]\[data-md~="code"\]`)[0] ?? "";

  test("spends the family's inline-code tint through a layer of its own", () => {
    // A layer rather than a background-color, for the reason bold and italic are layers:
    // the middle run of a bold element wrapping inline code carries bold AND code, and a
    // single background-color would let one rule win and punch a gap through the bold pill.
    expect(tintRule("code")).toMatch(/--md-code:\s*var\(--chip-code\)/);
    expect(fillRule).toMatch(/var\(--md-code,\s*transparent\)/);
    // The transparent fallback is what paints nothing when the member is absent, so no
    // default declaration is needed and nothing has to out-specify the member rule.
    expect(fillRule).not.toMatch(/--md-code:\s/);
  });

  test("spends whatever token the fence chip spends, rather than a second value", () => {
    // The account of WHY one token serves two surfaces lives on the rule itself in
    // coreStyles.ts; what is pinned here is only that the two never drift apart. Read
    // the token out of each rule and compare, so this fails on a second value being
    // introduced anywhere rather than on --chip-code specifically being named.
    const token = (rule: string) => rule.match(/var\((--chip-[a-z]+)\)/)?.[1];
    expect(token(fenceRule ?? "")).toBe("--chip-code");
    expect(token(tintRule("code"))).toBe(token(fenceRule ?? ""));
  });

  test("squares and unpads a file reference sitting inside a codespan", () => {
    // [data-file-ref] is shaped as a STANDALONE pill: 0.3em of inline breathing room
    // cancelled by a negative margin, 0.1em of block padding, and its own radius. Inside
    // a codespan it is a stretch of hue in someone else's pill, and each of those three
    // draws a seam — the overhang double-coats the translucent chip under each backtick,
    // the block padding leaves the tint proud, and the radius notches the fill once the
    // box no longer overlaps its neighbours. All three go, together.
    expect(nestedRef).toMatch(/padding:\s*0;/);
    expect(nestedRef).toMatch(/margin-inline:\s*0;/);
    expect(nestedRef).toMatch(/border-radius:\s*0;/);
    // Scoped to a reference the pass tagged as code: a prose-labelled reference carries
    // no member, so it must keep the standalone chip this rule is carved out of.
    expect(nestedRef).toContain('[data-md~="code"]');
  });
});

// EXC-870: the one element on this surface that is content rather than decoration. It is
// also the only one whose geometry cannot shift a glyph — display: block takes it out of
// the inline flow entirely, which is what lets it carry the margins every chip in this
// sheet is forbidden. The rules are pinned structurally here; that the row track and its
// gutter cell really grow around it is images.e2e.ts's job.
describe("the inline image (EXC-870)", () => {
  const imageRule = rulesFor(String.raw`\[data-md-image\]`)[0] ?? "";
  const hiddenRule = rulesFor(String.raw`\[data-md-image\]\[hidden\]`)[0] ?? "";

  test("is a block, so it takes its own line inside the row", () => {
    // Inline, it would sit among shiki's tokens on a white-space: pre line and the
    // monospace grid would stop matching source columns — the ladder trigger EXC-867
    // names. Block is also what makes the row track grow to hold it.
    expect(imageRule).toMatch(/display:\s*block/);
  });

  test("is capped in both axes and keeps its aspect ratio", () => {
    // The height cap is what stops one asset owning the plan; the width cap borrows the
    // fenced panel's own reading measure rather than inventing a second one, with min()
    // leaving a narrow viewport in charge. Both dimensions stay auto so whichever cap
    // bites first scales the other — which is also why no object-fit is needed.
    expect(imageRule).toMatch(/max-width:\s*min\(100%,\s*var\(--caret-read-max\)\)/);
    expect(imageRule).toMatch(/max-height:/);
    expect(imageRule).toMatch(/width:\s*auto/);
    expect(imageRule).toMatch(/height:\s*auto/);
  });

  test("spends the same indent the fenced panel spends", () => {
    // Same VALUE, deliberately, so the two things a plan embeds are indented alike
    // rather than by two arbitrary numbers — not the same pixel rail, since the
    // panel's margin moves the row box while this one sits inside that box's own
    // text padding. Both read --caret-card-inset (EXC-865), so the pairing this used to
    // assert by comparing two literals is now carried by the value itself.
    expect(imageRule).toMatch(/margin-inline-start:\s*var\(--caret-card-inset\)/);
    expect(overrideDecls).toMatch(
      /\[data-code-line\][^{}]*\{[^}]*margin-inline-start:\s*var\(--caret-card-inset\)/,
    );
  });

  test("wears the chip family's radius and a scheme-correct hairline edge", () => {
    // A screenshot on a white ground dissolves into --paper with no edge, so the border
    // is legibility rather than decoration. The ink mix is the sheet's own idiom, which
    // is what makes one declaration correct in both schemes — no literal color.
    expect(imageRule).toMatch(new RegExp(String.raw`border-radius:\s*${RADIUS}`));
    expect(imageRule).toMatch(/border:\s*1px solid color-mix\(in lab,/);
    expect(imageRule).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  test("is excluded from the selection, so copy carries only the row's text", () => {
    // Not styling. Blink emits an image's alt text into the plain-text flavour of a
    // copied selection, so without this the row copies as the source markdown with
    // the accessible name stapled on — breaking the epic's copy contract, and doing
    // it invisibly, since Selection.toString() takes a path that never shows it.
    // images.e2e.ts reads the real clipboard; this pins the declaration.
    expect(imageRule).toMatch(/user-select:\s*none/);
  });

  test("carries no transition", () => {
    // svelte-rules § Motion: the diff surface swaps state instantly.
    expect(imageRule).not.toMatch(/transition/);
  });

  test("a hidden image really collapses", () => {
    // Not boilerplate: a failed load sets `hidden` rather than removing the element, so
    // the observer pass stays idempotent — and the UA sheet's own [hidden] rule loses to
    // the display: block above, so without this line a broken image still holds the row.
    expect(hiddenRule).toMatch(/display:\s*none/);
  });
});

describe("the list markers (EXC-861)", () => {
  const anyMarker = rulesFor(String.raw`\[data-md-list\]`)[0] ?? "";
  const bulletRule = rulesFor(String.raw`\[data-md-list="bullet"\]`)[0] ?? "";
  const glyphRule = rulesFor(String.raw`\[data-md-list="bullet"\]::before`)[0] ?? "";

  test("marks every kind with the ink the other structural markers wear", () => {
    // A marker is ink, not a chip: --ink-faint is what caret-theme.ts already gives the
    // fence markers and the ** / _ emphasis markers, so a list marker joins that family
    // rather than spending a sixth --chip-* token on a single dash.
    expect(anyMarker).toMatch(/color:\s*var\(--ink-faint\)/);
    expect(anyMarker).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(anyMarker).not.toMatch(/--chip-/);
  });

  test("hands the bullet's own cell to the glyph drawn over it", () => {
    // Transform-in-place (EXC-855): the dash is still in the DOM and still copied — it
    // is only made invisible so the bullet can occupy the column it already had.
    expect(bulletRule).toMatch(/color:\s*transparent/);
    expect(glyphRule).toMatch(/content:\s*"•"/);
  });

  test("draws the glyph out of flow so no column moves", () => {
    // Rows render white-space: pre, so a pseudo-element in flow would push every glyph
    // after it and the monospace grid would stop matching the source columns vim
    // motions, drag-ranges and the search highlights all resolve against. Absolute with
    // NO inset lands the box at its static position — over the marker, on the same
    // baseline — and contributes no advance. An inset would position it against some
    // ancestor instead, and padding or margin would cost width; both are the drift this
    // pins.
    expect(glyphRule).toMatch(/position:\s*absolute/);
    expect(glyphRule).not.toMatch(/\b(top|left|right|bottom|inset[a-z-]*)\s*:/);
    expect(glyphRule).not.toMatch(/\b(padding|margin)[a-z-]*\s*:/);
  });

  test("keeps the glyph out of the clipboard", () => {
    // The epic's copy contract. Blink emits generated content into the plain-text
    // flavour of a copied selection the same way EXC-870 found it emitting an image's
    // alt — invisible to Selection.toString(), visible only in the real clipboard, which
    // lists.e2e.ts reads. This pins the declaration that keeps it out.
    expect(glyphRule).toMatch(/user-select:\s*none/);
  });

  test("gives a task item's marker the ink and not the glyph", () => {
    // One treatment per row: a checkbox IS a task item's marker, so a bullet beside it
    // would be two markers arguing. The kind is settled in the emission (inlineSpans.ts
    // tags it "task"), which is why the glyph selector can name "bullet" exactly rather
    // than carving the task case back out here. EXC-860's checkbox hangs off a different
    // attribute (data-md-checkbox), so the sheet needs no data-md-list="task" rule at all.
    expect(glyphRule).toContain('[data-md-list="bullet"]');
    expect(rulesFor(String.raw`\[data-md-list="task"\]`)).toEqual([]);
  });

  test("carries no transition", () => {
    // svelte-rules § Motion: the diff surface swaps state instantly.
    expect(`${anyMarker}${bulletRule}${glyphRule}`).not.toMatch(/transition/);
  });
});

// EXC-860: the task-list checkbox, drawn over the `[ ]` / `[x]` run inlineSpans.ts already
// tags. Structurally this is the list marker one block up scaled from one character cell to
// three, so the assertions are deliberately its assertions — what differs is the centring
// offset the extra two cells need, and that state is told by SHAPE rather than by colour.
// That the run really measures three cells and that the glyph really paints is tasks.e2e.ts's
// job; this suite pins the declarations.
describe("the task-list checkbox (EXC-860)", () => {
  const runRule = rulesFor(String.raw`\[data-md-checkbox\]`)[0] ?? "";
  const glyphRule = rulesFor(String.raw`\[data-md-checkbox\]::before`)[0] ?? "";
  const uncheckedRule = rulesFor(String.raw`\[data-md-checkbox="unchecked"\]::before`)[0] ?? "";
  const checkedRule = rulesFor(String.raw`\[data-md-checkbox="checked"\]::before`)[0] ?? "";
  const suppressRule =
    rulesFor(String.raw`\[data-md-checkbox\] ~ \[data-md-checkbox\]::before`)[0] ?? "";

  test("hands the bracket run's own cells to the glyph drawn over them", () => {
    // Transform-in-place (EXC-855): the brackets are still in the DOM and still copied —
    // they are only made invisible so the checkbox can occupy the columns they already had.
    expect(runRule).toMatch(/color:\s*transparent/);
  });

  test("tells the two states apart by shape, not by colour", () => {
    // Both states spend the SAME ink and differ only in the glyph, so the distinction
    // survives a reader who cannot separate the two by hue (EXC-863 records the same
    // failure one rule family over). The sheet's own block carries the full argument.
    expect(uncheckedRule).toMatch(/content:/);
    expect(checkedRule).toMatch(/content:/);
    expect(uncheckedRule.match(/content:[^;]*/)?.[0]).not.toBe(
      checkedRule.match(/content:[^;]*/)?.[0],
    );
    expect(`${uncheckedRule}${checkedRule}`).not.toMatch(/color|opacity/);
  });

  test("pins the checked box to its text presentation", () => {
    // VARIATION SELECTOR-15. Without it a platform carrying a colour emoji font may
    // substitute a picture for U+2611, and an emoji ignores `color` — the box would stop
    // taking the theme's ink, which is precisely the failure the ink test below cannot
    // see. U+2610 needs no pin: it carries no Emoji property, so nothing may substitute.
    expect(checkedRule).toContain(String.raw`\\FE0E`);
    expect(uncheckedRule).not.toContain(String.raw`\\FE0E`);
  });

  test("spends one step above the faint marker ink, which the floor requires", () => {
    // Not the --ink-faint the structural markers spend. A checkbox reports STATE, so WCAG
    // 1.4.11's 3:1 floor for a non-text indicator binds it — and on the surface it renders
    // on (--paper-sunk and the row's ink bands, not the --paper / --paper-raised the ramp
    // test measures) --ink-faint falls under that floor on two of the nine palettes.
    // theme.test.ts pins the ink chosen here against all nine on that surface; this only
    // holds the sheet to the same token, so the two cannot drift apart.
    expect(glyphRule).toMatch(/color:\s*var\(--ink-soft\)/);
    expect(glyphRule).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(glyphRule).not.toMatch(/--chip-/);
    expect(glyphRule).not.toMatch(/opacity/);
  });

  test("draws the glyph out of flow so no column moves", () => {
    // Identical reasoning to the bullet: rows render white-space: pre, so a pseudo-element
    // in flow would push every glyph after it. Absolute with NO inset lands the box at its
    // static position; an inset would resolve it against some ancestor instead, and padding
    // or margin would cost width.
    expect(glyphRule).toMatch(/position:\s*absolute/);
    expect(glyphRule).not.toMatch(/\b(top|left|right|bottom|inset[a-z-]*)\s*:/);
    expect(glyphRule).not.toMatch(/\b(padding|margin)[a-z-]*\s*:/);
  });

  test("centres over three cells with transform, which costs no advance", () => {
    // The one place this cannot copy the bullet. A bullet overdraws ONE cell and needs no
    // offset; the brackets are THREE, so a one-cell glyph left at its static position would
    // sit over the opening bracket rather than over the run. translateX moves the box from
    // its own static position and is not a layout property, so the centring is free — which
    // is exactly why it is spelled this way rather than with an inset.
    expect(glyphRule).toMatch(/transform:\s*translateX\(1ch\)/);
  });

  test("keeps the glyph out of the clipboard", () => {
    // The epic's copy contract. Blink emits generated content into the plain-text flavour
    // of a copied selection, invisible to Selection.toString() and visible only in the real
    // clipboard, which tasks.e2e.ts reads. A leaked box would make a copied plan read
    // `☐- [ ] item` and corrupt the markdown the epic exists to keep honest.
    expect(glyphRule).toMatch(/user-select:\s*none/);
  });

  test("draws one box per run, however many tokens shiki cut the run into", () => {
    // A real defect rather than a hypothetical: shiki cuts a three-character run into
    // three tokens on some rows, inlineDecorate tags every one, and the sheet drew three
    // boxes. The sheet's block carries the reasoning; what is pinned here is the rule's
    // two load-bearing properties.
    expect(suppressRule).toMatch(/content:\s*none/);
    // GENERAL sibling, not adjacent: tagRow leaves a zero-length token untagged, which
    // would sit between two tagged ones and break an adjacent-only chain into two boxes.
    expect(suppressRule).toContain("[data-md-checkbox] ~ [data-md-checkbox]");
    // And it out-specifies the state rules that supply the content on WEIGHT rather than
    // on source order, so reordering this block cannot undo it. Counted rather than
    // asserted by spelling: one more attribute selector than the rule it has to beat.
    const attrs = (rule: string) => (rule.match(/\[/g) ?? []).length;
    expect(attrs(suppressRule)).toBeGreaterThan(attrs(checkedRule));
  });

  test("inherits the row's type metrics so the glyph keeps the baseline", () => {
    // The glyph shares the row's baseline because it inherits the token's font and
    // line-height and so builds an identical line box. Giving this pseudo-element a
    // font-size or line-height of its own is the one edit that would silently break the
    // alignment, which is why it is pinned rather than merely commented.
    expect(glyphRule).not.toBe("");
    expect(glyphRule).not.toMatch(/font-size|line-height|font-family/);
  });

  test("carries no transition", () => {
    // svelte-rules § Motion: the diff surface swaps state instantly. The non-empty guard is
    // what keeps this from passing on four selectors that resolved to nothing.
    const all = [runRule, glyphRule, uncheckedRule, checkedRule];
    expect(all.filter((rule) => rule !== "")).toHaveLength(4);
    expect(all.join("")).not.toMatch(/transition/);
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
    // [^{]* rather than \s*: the table card (EXC-864) shares this bar, so the rule heads a
    // selector LIST. The code card still has to be in it for this to match.
    expect(overrideDecls).toMatch(/\[data-code-card\]::-webkit-scrollbar-thumb[^{]*\{/);
  });

  test("keeps the thumb a caret-neutral ink mix, not amber", () => {
    // The diff surface reserves amber for selection, so the bar is a neutral paper→ink mix.
    const thumb =
      overrideDecls.match(/\[data-code-card\]::-webkit-scrollbar-thumb[^{]*\{[^}]*\}/)?.[0] ?? "";
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

// EXC-918: the daemon reports a kind per reference, and a directory's token is
// tagged data-file-ref="directory" (fileRefTag.ts). The rule swaps the mask and
// nothing else — the glyph is the only thing that distinguishes a folder — so
// the tint, the hover wash, the pointer cursor and the chip padding all keep
// cascading from the rules above, whose valueless attribute selector matches a
// directory token too.
describe("the folder-reference glyph (EXC-918)", () => {
  const folderRule =
    overrideDecls.match(
      /\[data-content\]\s*\[data-file-ref="directory"\]::before\s*\{[^}]*\}/,
    )?.[0] ?? "";

  test("swaps in the folder mask for a directory reference", () => {
    expect(folderRule).not.toBe("");
    expect(folderRule).toMatch(/mask:\s*\$\{FOLDER_ICON_MASK\}/);
  });

  test("overrides nothing but the mask, so the file rule's tint and box still apply", () => {
    expect(folderRule).not.toContain("background-color");
    expect(folderRule).not.toContain("content:");
  });
});

// The filename reference's chip. It RESTS in --chip-ref — the reference member of
// the chip family EXC-855 fixed and EXC-858 derived — so which spans are
// previewable is legible without sweeping the pointer across the plan (EXC-880);
// hover swaps the fill to the warm accent wash (EXC-840) so pressing one still
// reads as a change of state. The pins here keep the resting tint a DERIVED token
// rather than a literal, keep the two states on different tokens, and keep the
// chip roomy (no layout shift) and motionless. A reference carrying a link target
// also shows a tooltip on hover (EXC-954); that one is rendered in JS and out of
// scope for these CSS pins.
describe("the filename-reference chip (EXC-840, tinted EXC-880)", () => {
  const tokenRule =
    overrideDecls.match(/\[data-content\]\s*\[data-file-ref\]\s*\{[^}]*\}/)?.[0] ?? "";
  const hoverRule =
    overrideDecls.match(/\[data-content\]\s*\[data-file-ref\]:hover\s*\{[^}]*\}/)?.[0] ?? "";

  test("the token always carries the pointer cursor — it is clickable", () => {
    expect(tokenRule).toContain("cursor: pointer");
  });

  test("the token reserves breathing room so the fill reads as a chip, not cramped", () => {
    // Padding widens the fill out past the glyphs; a matching negative inline
    // margin offsets it so the surrounding backticks never shift.
    expect(tokenRule).toMatch(/padding/);
    expect(tokenRule).toMatch(/margin-inline:\s*-/);
  });

  test("the chip rests in the derived reference tint, with the control radius", () => {
    // The tint is the ColorToken EXC-858 derived, never a literal — that is what
    // makes all nine palettes supply it by construction. The radius rides the
    // resting rule too, so the chip is one shape the hover only re-fills.
    expect(tokenRule).toMatch(/background-color:\s*var\(--chip-ref\)/);
    expect(tokenRule).toMatch(/border-radius:\s*var\(--radius\)/);
    // The positive pin alone would still pass with a literal declared after it, which
    // would win the cascade — so hold the whole rule clear of both escape hatches.
    expect(tokenRule).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(tokenRule).not.toMatch(/color-mix/);
  });

  test("hover swaps the fill to the accent wash, so it stays a visible step up", () => {
    expect(hoverRule).toMatch(/background-color:\s*var\(--accent-wash\)/);
    expect(hoverRule).not.toMatch(/var\(--chip-ref\)/);
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

// EXC-864: a GFM table renders as a real column-aligned table. tables.ts moves its rows
// into a card and groups each row's tokens into cells; these rules are the whole visual
// treatment. The two nested subgrids are the load-bearing part — rows from the parent so
// the gutter numbers stay aligned, columns from the card so cells line up across rows —
// and the pipes are left in place to BE the borders rather than replaced by drawn ones.
// This suite pins the CSS side; the rendered layout is covered by e2e.
describe("the markdown table (EXC-864)", () => {
  const cardBody =
    overrideDecls.match(/\[data-content\]\s*>\s*\[data-table-card\]\s*\{[^}]*\}/)?.[0] ?? "";
  const rowBody =
    overrideDecls.match(
      /\[data-content\]\s*>\s*\[data-table-card\]\s*>\s*\[data-line\]\s*\{[^}]*\}/,
    )?.[0] ?? "";

  test("takes its row tracks from the parent so the gutter stays aligned", () => {
    expect(cardBody).toMatch(/display:\s*grid/);
    expect(cardBody).toMatch(/grid-template-rows:\s*subgrid/);
  });

  test("declares the table's column tracks from the count tables.ts sets", () => {
    // max-content, so a track never shrinks under space pressure — a wide table
    // overflows into the scroll rather than reflowing into a tall cramped block.
    expect(cardBody).toMatch(
      /grid-template-columns:\s*repeat\(var\(--table-columns[^)]*\),\s*max-content\)/,
    );
    // start, not stretch: a narrow table keeps its natural width inside the cap.
    expect(cardBody).toMatch(/justify-content:\s*start/);
  });

  test("scrolls as one unit once even wrapping cannot fit the columns", () => {
    expect(cardBody).toMatch(/overflow-x:\s*auto/);
    // The reading cap, named since EXC-865 so the fenced row, the code card, the table
    // card and a comment anchored inside one cannot drift apart.
    expect(cardBody).toMatch(/max-width:\s*var\(--caret-read-max\)/);
    expect(overrideDecls).toMatch(/--caret-read-max:\s*720px/);
    // The code card's bar, shared rather than duplicated — one scrollbar idiom.
    expect(overrideDecls).toMatch(/\[data-table-card\]::-webkit-scrollbar\s*\{/);
    expect(overrideDecls).toMatch(/\[data-table-card\]::-webkit-scrollbar-thumb\s*\{/);
  });

  test("makes each row a subgrid of the card's columns, so cells align across rows", () => {
    expect(rowBody).toMatch(/display:\s*grid/);
    expect(rowBody).toMatch(/grid-template-columns:\s*subgrid/);
  });

  test("wraps inside cells only, at the width that says a cell is prose", () => {
    const cellBody =
      overrideDecls.match(/\[data-content\]\s*\[data-table-cell\]\s*\{[^}]*\}/)?.[0] ?? "";
    expect(cellBody).toMatch(/white-space:\s*pre-wrap/);
    // The cap rides the CELL, not the track: capping the track lets the grid squeeze
    // every column at once, which reflows a wide table instead of scrolling it.
    expect(cellBody).toMatch(/max-width:\s*44ch/);
    // No padding: the source's own spaces inside a cell are the breathing room.
    expect(cellBody).not.toMatch(/padding/);
  });

  test("respects the delimiter row's alignment markers", () => {
    expect(overrideDecls).toMatch(/\[data-table-align="center"\]\s*\{\s*text-align:\s*center/);
    expect(overrideDecls).toMatch(/\[data-table-align="right"\]\s*\{\s*text-align:\s*right/);
  });

  test("inks the pipes as the borders rather than drawing rules in their place", () => {
    expect(overrideDecls).toMatch(/\[data-table-pipe\]\s*\{\s*color:\s*var\(--ink-faint\)/);
    // No drawn column dividers anywhere: the characters do that job.
    expect(cardBody).not.toMatch(/border-inline/);
    expect(rowBody).not.toMatch(/border-inline/);
  });

  test("declares the header row's weight rather than routing it through shiki", () => {
    // @pierre/diffs drops shiki's fontStyle into an invalid font-weight: light-dark(...),
    // so a theme-side bold would never land (EXC-867's standing upstream finding).
    expect(overrideDecls).toMatch(/\[data-line\]\[data-table-head\]\s*\{\s*font-weight:\s*bold/);
  });

  test("subdues the delimiter row's dashes and draws the header's rule under it", () => {
    expect(overrideDecls).toMatch(
      /\[data-line\]\[data-table-rule\]\s*\{\s*border-block-end:\s*1px solid var\(--rule\)/,
    );
    // Subdued, not hidden: the alignment markers stay legible and stay copyable.
    expect(overrideDecls).toMatch(
      /\[data-table-rule\]\s*\[data-table-cell\]\s*>\s*\*\s*\{\s*color:\s*var\(--ink-faint\)/,
    );
    expect(overrideDecls).not.toMatch(/\[data-table-rule\][^{]*\{[^}]*display:\s*none/);
  });
});

// EXC-863: blockquote level bars. The bar belongs to the epic's transform-in-place
// category rather than to the chip family: it overdraws the marker it replaces
// instead of tinting a run, so it spends the marker ink EXC-855 already fixed and
// mints nothing new. The subdue is the whole-line half, and where it is anchored is
// the load-bearing part — see the rule's own note in coreStyles.ts.
describe("blockquote level bars (EXC-863)", () => {
  const markerRule = rulesFor(String.raw`\[data-md-quote\]`).find((r) => r.includes("color:"));
  const barRule = rulesFor(String.raw`\[data-md-quote\]::before`)[0] ?? "";
  const subdueRule = rulesFor(String.raw`\[data-quote-depth\][^{}]*`).find((r) =>
    r.includes("opacity:"),
  );

  test("all three rules are present to assert against", () => {
    expect(markerRule).toBeDefined();
    expect(barRule).not.toBe("");
    expect(subdueRule).toBeDefined();
  });

  test("overdraws the marker rather than deleting it", () => {
    // The `>` stays in the text — copy, selection and the column grid all depend on
    // it — so the glyph goes transparent and the bar is drawn where it sat.
    expect(markerRule).toMatch(/color:\s*transparent/);
    expect(markerRule).toMatch(/position:\s*relative/);
    expect(barRule).toMatch(/position:\s*absolute/);
  });

  test("spends the family's marker ink, not a chip tint", () => {
    // EXC-855 fixes the marker ink at --ink-faint and refuses a sixth token for it. The
    // bar IS the marker redrawn, so it takes that ink rather than minting one or
    // borrowing a chip's.
    expect(barRule).toMatch(/background-color:\s*var\(--ink-faint\)/);
    expect(barRule).not.toContain("--chip-");
  });

  test("draws a round-rect on the family's own radius", () => {
    expect(barRule).toMatch(new RegExp(String.raw`border-radius:\s*${RADIUS}`));
  });

  test("costs the monospace grid nothing", () => {
    // Out of flow and sized in ch, so the bar takes no room in the line box and
    // cannot shift a column. Anything participating in flow here would move every
    // glyph after the markers, since rows render white-space: pre.
    expect(barRule).not.toMatch(/(?:^|[^-\w])margin(?:-\w+)*:/);
    expect(barRule).not.toMatch(/(?:^|[^-\w])padding(?:-\w+)*:/);
  });

  test("subdues the row's tokens rather than the row", () => {
    // The amber selection band and the hover band are background-colors on
    // [data-line] itself, so fading the ROW would fade them too and a selected
    // quoted row would read differently from a selected unquoted one.
    expect(subdueRule).toMatch(/\[data-line\]\[data-quote-depth\]\s*>/);
  });

  test("leaves the bar out of the subdue", () => {
    // The marker child carries the bar; fading it with the ink it replaced would
    // dim the one thing that has to stay legible at depth.
    expect(subdueRule).toMatch(/:not\(\[data-md-quote\]\)/);
  });
});

// EXC-862: thematic breaks. Transform-in-place like the level bars above — the `---`
// stays in the row and the rule is drawn over it — but the mechanism is the load-bearing
// half here, and it is the one thing a stylesheet regex can actually pin. A pass that
// APPENDED a node would loop the repaint observer inside a table cell (EXC-870), and a
// declaration that changed the row's height would drift the gutter numbers; both failures
// are invisible in a diff and obvious in this suite.
describe("thematic breaks (EXC-862)", () => {
  const ruleRule = rulesFor(String.raw`\[data-md-rule\]`).find((r) =>
    r.includes("background-image:"),
  );
  const inkRule = rulesFor(String.raw`\[data-md-rule\][^{}]*`).find((r) => r.includes("color:"));

  test("both rules are present to assert against", () => {
    expect(ruleRule).toBeDefined();
    expect(inkRule).toBeDefined();
  });

  test("paints the rule as a background, never as a pseudo-element", () => {
    // The whole point of the mechanism: no node, no ::before, nothing for tables.ts's
    // child-count settle check to disagree with.
    expect(ruleRule).toMatch(/background-image:\s*linear-gradient\(/);
    expect(overrideDecls).not.toMatch(/\[data-md-rule\][^{]*::(?:before|after)/);
  });

  test("spans the full column at one pixel, centered", () => {
    expect(ruleRule).toMatch(/background-size:\s*100%\s+1px/);
    expect(ruleRule).toMatch(/background-position:\s*center/);
    expect(ruleRule).toMatch(/background-repeat:\s*no-repeat/);
  });

  test("spends a rule token, not a chip tint or a new constant", () => {
    // A hairline spanning a whole edge is what the rule tokens are for — the level
    // bars' own note says so while rejecting them for a 2px mark.
    expect(ruleRule).toMatch(/var\(--rule-strong\)/);
    expect(ruleRule).not.toContain("--chip-");
  });

  test("overdraws the characters rather than deleting them", () => {
    // The row keeps every character for copy, the comment anchors and the column grid;
    // only the ink goes. The row itself is covered as well as its tokens, so a line the
    // library has not yet wrapped in shiki spans shows no glyph either.
    expect(inkRule).toMatch(/color:\s*transparent/);
    expect(inkRule).toMatch(/\[data-line\]\[data-md-rule\],/);
  });

  test("costs the row's height nothing", () => {
    // One gutter number per row. Anything here that grew the line box would drift the
    // numbers against the rows long before it read as a divider.
    expect(ruleRule).not.toMatch(/(?:^|[^-\w])(?:margin|padding|height|border)(?:-\w+)*:/);
  });
});

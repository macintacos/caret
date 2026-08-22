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

// A `${…}` interpolation in the sheet — an icon mask, a shared constant — carries braces,
// and every rule capture in this file is a `{[^}]*}` scan, so an interpolated declaration
// would end its rule's capture early and silently hide every declaration after it. The
// parens are the same width as the braces, so the backtick-truncation check above still
// measures what it means to.
const overrides = caretOverrides(coreStyles).replace(/\$\{([^{}]*)\}/g, "$($1)");

// CARET_OVERRIDES is a template literal, so one backtick anywhere inside it — most often
// in a CSS comment quoting markdown syntax — closes it early. Every assertion below then
// scans a truncated sheet and dozens fail at once, naming rules that are perfectly fine;
// three tickets in a row have spent a debugging cycle on that cascade. This is the one
// assertion that says what actually happened, and it runs before any of them.
test("the override sheet closes where it should, with no stray backtick inside it", () => {
  const opened = coreStyles.indexOf("const CARET_OVERRIDES = `");
  const closed = coreStyles.indexOf("\n`;", opened);
  expect(opened).toBeGreaterThan(-1);
  // The captured body reaches the sheet's real end rather than stopping at a backtick
  // partway through it.
  expect(overrides.length).toBe(closed - (opened + "const CARET_OVERRIDES = `".length) + 1);
});

// The sibling of the backtick trap above, and a quieter one. A comment that carries a
// SECOND `*/` — the usual way is editing a long block and terminating the paragraph you
// rewrote rather than the block — closes early, and the prose after it is then read as a
// selector prelude. CSS error recovery consumes that prelude together with the next `{…}`
// block, so exactly ONE rule vanishes from the parsed sheet while the source still reads
// perfectly and every text-scanning assertion in this file still passes. EXC-871 lost
// `[data-md-quote] { color: transparent }` that way and only caught it in a browser, from
// a `>` that should have been invisible.
//
// Counting terminators catches both directions: an extra `*/` and a missing one. Nothing
// legitimate unbalances them, because CSS comments do not nest.
test("every comment in the override sheet closes exactly once", () => {
  const opens = overrides.match(/\/\*/g)?.length ?? 0;
  const closes = overrides.match(/\*\//g)?.length ?? 0;
  expect(closes, `${opens} comment openers, ${closes} terminators`).toBe(opens);
});

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
    //
    // The drawn checkbox is exempt and is filtered out rather than admitted: --radius is
    // the CHROME radius, sized for panels and chips, and a checkbox is a control roughly
    // one em across — at that size the shared token rounds it most of the way to a circle.
    // Its corner is part of the shape being drawn, the way its border width and its size
    // are, so it is measured in the same em the rest of the control is.
    const radiusRules = (overrideDecls.match(/[^{}]*\{[^{}]*border-[a-z-]*radius:[^{}]*\}/g) ?? [])
      .filter((block) => !block.includes("checkbox"))
      .flatMap((block) => block.match(/border-[a-z-]*radius:\s*[^;]+;/g) ?? []);
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
    // A code card is an overflow-x: auto scroll container, so a row inside one cannot
    // pull left across the seam — anything painted outside that box is clipped. The
    // strip is painted from the gutter cell instead, which nothing clips and which
    // BOTH card kinds share (EXC-864's table card is the second).
    const extension = overrideDecls.match(
      /\[data-gutter\]\s+:is\(\[data-table-card-gutter\],\s*\[data-code-card-gutter\]\)\s*>\s*\[data-column-number\]:is\([^)]*\)::before\s*\{([^}]*)\}/,
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
      /\[data-content\]\s*>\s*\[data-code-card\]\s*\{[^}]*margin-inline:\s*var\(--caret-card-inset\)/,
    );
  });

  test("takes a rounded end back off where the band continues past a card", () => {
    // Widened to descendant, the sibling logic rounds a card's first and last selected
    // rows — right for a selection wholly inside one, wrong for one that runs past it.
    for (const corner of ["top-left", "top-right", "bottom-left", "bottom-right"]) {
      const column = corner.endsWith("left") ? "gutter" : "content";
      const card = corner.endsWith("left")
        ? String.raw`\[data-code-card-gutter\]`
        : String.raw`\[data-code-card\]`;
      const override = new RegExp(
        String.raw`\[data-${column}\][^{}]*${card}[^{}]*\{[^}]*border-${corner}-radius:\s*0`,
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

// The fence markers take NO chip. EXC-869 gave them one and it was the family member that
// never read as one — a chip tints a span of CONTENT, and a fence row is all marker and no
// content, so the tint drew a small empty pill inside the code panel. What they keep is
// their ink (caret-theme.ts) and the EXC-692 centering nudges, which are about where the
// marker sits in its line box rather than about tinting it.
test("draws no chip on the fence markers", () => {
  const fenceRules = rulesFor(String.raw`\[data-code-fence\]`).join("\n");
  expect(fenceRules).not.toMatch(/background|border-radius/);
  // Asserted against the centering rules still being there, so this cannot pass by the
  // selector having vanished from the sheet altogether.
  expect(fenceRules).toMatch(/top:\s*-?[\d.]+em/);
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

  test("pads at the pill's ends only, so an interior fragment opens no gap", () => {
    // A pill fragmented into several runs is several ELEMENTS, and inline padding on each
    // would space the pill's own glyphs apart from the inside. data-md-start / data-md-end
    // are exactly the pill's outer ends (the pass withholds them from a nested member, for
    // the radius's sake), so the inline half hangs there and the fill rule carries only the
    // block half — which is on the cross axis, where every fragment shares one line box.
    expect(fillRule).toMatch(/padding-block:\s*var\(--chip-pad-block\)/);
    expect(fillRule).not.toMatch(/padding-inline|padding-left|padding-right/);
    expect(startRule).toMatch(/padding-inline-start:\s*var\(--chip-pad-inline\)/);
    expect(endRule).toMatch(/padding-inline-end:\s*var\(--chip-pad-inline\)/);
  });

  test("shifts its neighbours rather than cancelling the padding under them", () => {
    // EXC-867 shipped these unpadded and EXC-880 cancelled the reference's padding with a
    // negative margin, both to keep the monospace grid matching the source columns. The
    // shift is now intended: nothing resolves a column in pixels (anchors and motions are
    // character-indexed, the search marks paint over DOM ranges), and a cancelled pair
    // spends the fill UNDER the neighbouring glyph — so two chips either side of one
    // character double-coat its cell, which is the look this replaces.
    for (const rule of [fillRule, startRule, endRule]) {
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

  test("spends the family's derived code token, never a second value", () => {
    // The tint is CONSUMED, never redefined here: --chip-code is derived for all nine
    // palettes by the recipe (EXC-858), so the code chip carries the same relationship to
    // whatever ground it sits on in every one of them. A literal — or a color-mix spelled
    // out here — would be a tenth palette declared by hand.
    expect(tintRule("code")).toMatch(/var\(--chip-code\)/);
    expect(tintRule("code")).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(tintRule("code")).not.toMatch(/color-mix/);
  });

  test("squares and unpads a file reference sitting inside a codespan", () => {
    // [data-file-ref] is shaped as a STANDALONE pill: the family's breathing room on both
    // axes, its own fill, and its own radius. Inside a codespan it is not a pill at all but
    // the middle of the citation's — so its inline padding would space the path away from
    // the backticks meant to sit tight around it, and its radius would notch the fill it
    // sits in.
    expect(nestedRef).toMatch(/padding-inline:\s*0;/);
    expect(nestedRef).toMatch(/border-radius:\s*0;/);
    // The BLOCK half stays, and that is what makes the pill one thickness end to end: the
    // group's other tokens carry --chip-pad-block from the family's fill rule, so a
    // reference that zeroed all four sides drew a thinner middle inside taller caps.
    expect(nestedRef).not.toMatch(/padding(-block)?:\s*0;/);
    // Scoped to a reference the pass tagged as code: a prose-labelled reference carries
    // no member, so it must keep the standalone chip this rule is carved out of.
    expect(nestedRef).toContain('[data-md~="code"]');
  });

  test("hands the citation's fill to the group, so the pill is one colour", () => {
    // The reference used to paint its own --chip-ref under the code layer, which left the
    // pill green in the middle and code-coloured at the backticks — two tints and a seam
    // where there is one span of meaning. The group's own tint is rebound instead, on every
    // token the pass marked data-md-cite, and the reference drops its fill so the wash is
    // not laid down twice over the path.
    const cite = rulesFor(String.raw`\[data-md-cite\]`)[0] ?? "";
    expect(cite).toMatch(/--chip-code:\s*var\(--chip-ref\)/);
    expect(nestedRef).toMatch(/background-color:\s*transparent/);
    // A REBIND rather than an override of --md-code: the layer variable is declared once
    // for the token and once for a nested member (on the pseudo-element), and both resolve
    // var(--chip-code) — so rebinding the token reaches both with no specificity to lose.
    expect(cite).not.toMatch(/--md-code:\s*var\(--chip-code\)/);
    // The affordance's selection policy, unchanged from the standalone chip: the code
    // member drops its tint on a drag-selected row and a citation must not, or the row
    // claims the path stopped being clickable.
    expect(cite).toMatch(/--md-code:\s*var\(--chip-ref\)/);
    expect(cite).not.toMatch(/:not\(\[data-selected-line\]\)/);
    // Hover is still the reference's own, since the path is the only pressable part.
    expect(rulesFor(String.raw`\[data-file-ref\]\[data-md~="code"\]:hover`)[0] ?? "").toMatch(
      /background-color:\s*var\(--accent-wash\)/,
    );
  });

  test("that hover washes the whole pill, backticks included", () => {
    // Lighting only the path reads as a chip with a lit core rather than as a lit chip. The
    // rest of the group is the token either side of the reference, reached as adjacent
    // siblings — there is no element around the group to select.
    const spread =
      rulesFor(String.raw`\[data-file-ref\]\[data-md-cite\]:hover \+ \[data-md-cite\]`)[0] ?? "";
    expect(spread).toMatch(/background-color:\s*var\(--accent-wash\)/);
    // The token BEFORE the reference needs :has — no preceding-sibling combinator exists.
    expect(spread).toContain("[data-md-cite]:has(+ [data-file-ref][data-md-cite]:hover)");
  });
});

// The nested chip's corners. A member whose group sits inside another's takes no cap on the
// token — border-radius clips every background layer on the box, so capping there would
// round the enclosing pill's tint too and notch its middle — and it drew a square-ended
// rectangle inside a rounded pill, the one shape in this family that reads as an accident.
// A second radius needs a second box, so the inner tint moves to a pseudo-element that has
// one of its own.
describe("the nested chip's own corners", () => {
  const fillRule = rulesFor(String.raw`\[data-md\]`)[0] ?? "";
  const nestFill = rulesFor(String.raw`\[data-md-inner\]::after`)[0] ?? "";
  const nestBox = rulesFor(String.raw`\[data-md-inner\]`).find((r) => r.includes("z-index")) ?? "";
  const nestStart = rulesFor(String.raw`\[data-md-inner-start\]::after`)[0] ?? "";
  const nestEnd = rulesFor(String.raw`\[data-md-inner-end\]::after`)[0] ?? "";
  const nestPadStart = rulesFor(String.raw`\[data-md-inner-start\]`)[0] ?? "";
  const nestPadEnd = rulesFor(String.raw`\[data-md-inner-end\]`)[0] ?? "";
  const nestTint = (member: string) =>
    rulesFor(String.raw`\[data-md-inner~="${member}"\]`).find((r) =>
      r.includes(`--nest-${member}:`),
    ) ?? "";

  // Every extraction falls back to "" on a regex miss, over which `not.toMatch` passes
  // vacuously — pin non-emptiness on all of them before asserting any absence.
  test("every rule this suite asserts against is present", () => {
    for (const rule of [
      fillRule,
      nestFill,
      nestBox,
      nestStart,
      nestEnd,
      nestPadStart,
      nestPadEnd,
    ]) {
      expect(rule).not.toBe("");
    }
    for (const member of ["bold", "italic", "code", "link"]) {
      expect(nestTint(member)).not.toBe("");
    }
  });

  test("gives the inner pill the family's breathing room at its ends", () => {
    // A chip tight to its glyphs reads as a highlighter smear whether or not it sits
    // inside another chip, and the inner one was shipped with none. The room is the
    // family's own --chip-pad-inline rather than a second number, and it hangs on the
    // ends only, exactly as the outer pill's does: on every fragment it would space the
    // inner pill's own glyphs apart from the inside.
    expect(nestPadStart).toMatch(/padding-inline-start:\s*var\(--chip-pad-inline\)/);
    expect(nestPadEnd).toMatch(/padding-inline-end:\s*var\(--chip-pad-inline\)/);
    // On the ELEMENT, not the pseudo. Padding the token is real space that pushes the
    // enclosing pill's glyphs aside; padding the pseudo would only paint wider and
    // overhang them. inset: 0 then carries the pseudo along for free.
    for (const rule of [nestFill, nestStart, nestEnd]) {
      expect(rule).not.toMatch(/padding/);
    }
  });

  test("sizes the inner pill to the chip's own rect", () => {
    // inset: 0 resolves against the token's PADDING box, which is the chip — the block
    // padding above is what makes a chip taller than its glyphs and it is included. So the
    // inner pill matches the outer one's height by construction rather than by a second
    // measurement that could drift from it.
    expect(nestFill).toMatch(/position:\s*absolute/);
    expect(nestFill).toMatch(/inset:\s*0/);
    expect(nestFill).not.toMatch(/height|padding|margin/);
  });

  test("keeps the pseudo-element under the glyphs it sits behind", () => {
    // Both halves of the z-index pair are load-bearing. -1 puts the pseudo under the
    // token's text — a positioned descendant paints ABOVE inline content by default, which
    // would wash the very glyphs it is meant to sit behind. z-index: 0 on the token makes
    // it a stacking context so that -1 stays INSIDE it; without that the pseudo would sink
    // past the row and disappear under the hover and selection bands, which are backgrounds
    // on the row.
    expect(nestFill).toMatch(/z-index:\s*-1/);
    expect(nestBox).toMatch(/position:\s*relative/);
    expect(nestBox).toMatch(/z-index:\s*0/);
  });

  test("draws on ::after, leaving ::before to the file reference's glyph", () => {
    // A citation inside a bold element is a file reference that is ALSO a nested code
    // member, and the reference draws its glyph on ::before. Both rules on one
    // pseudo-element merge: the icon ends up absolutely positioned at inset 0, behind the
    // text it should sit left of, wearing the chip's gradient through its own mask. Two
    // decorations, two slots.
    for (const rule of [nestFill, nestStart, nestEnd]) {
      expect(rule).toContain("::after");
      expect(rule).not.toContain("::before");
    }
    expect(rulesFor(String.raw`\[data-file-ref\]::before`)[0] ?? "").toMatch(/mask:/);
  });

  test("rounds only the inner group's ends, so a fragmented member closes once", () => {
    // The same shape data-md-start / data-md-end draw for the outer pill: an inner member
    // split across several tokens (shiki cuts a codespan at its backticks) opens and closes
    // once rather than pinching at every internal seam.
    expect(nestStart).toMatch(new RegExp(String.raw`border-start-start-radius:\s*${RADIUS}`));
    expect(nestStart).toMatch(new RegExp(String.raw`border-end-start-radius:\s*${RADIUS}`));
    expect(nestEnd).toMatch(new RegExp(String.raw`border-start-end-radius:\s*${RADIUS}`));
    expect(nestEnd).toMatch(new RegExp(String.raw`border-end-end-radius:\s*${RADIUS}`));
    expect(nestFill).not.toMatch(/border-radius/);
  });

  test("moves a nested member's tint rather than copying it", () => {
    // Each member's rule names both halves: --md-<member> is reset to initial so the layer
    // on the element paints nothing (a custom property set to initial is guaranteed-invalid,
    // so var() takes its transparent fallback), and --nest-<member> carries it here. Painted
    // in both places a nested member would double its own alpha and read as a third tint.
    for (const member of ["bold", "italic", "code", "link"]) {
      expect(nestTint(member)).toMatch(new RegExp(String.raw`--md-${member}:\s*initial`));
      expect(nestTint(member)).toMatch(
        new RegExp(String.raw`--nest-${member}:\s*var\(--chip-${member}\)`),
      );
      expect(nestFill).toMatch(new RegExp(String.raw`var\(--nest-${member},\s*transparent\)`));
    }
    // Consumed, never redefined: the recipe (EXC-858) derives all five tints for all nine
    // palettes, so a literal at this level would be a tenth, unreviewed palette.
    expect(nestFill).not.toMatch(/#[0-9a-fA-F]{3,8}\b|color-mix/);
  });

  test("carries the family's selection split one level down", () => {
    // The nested tint takes the same side its own member takes on the token: bold, italic
    // and code are decoration and drop on a drag-selected row so the band reads as one flat
    // shape, and the link chip is an affordance that keeps its tint. A nested member that
    // survived a selection its own outer pill dropped would read as a stray block.
    for (const member of ["bold", "italic", "code"]) {
      expect(nestTint(member)).toMatch(/:not\(\[data-selected-line\]\)/);
    }
    expect(nestTint("link")).not.toMatch(/:not\(\[data-selected-line\]\)/);
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
  const taskRule = rulesFor(String.raw`\[data-md-list="task"\]`)[0] ?? "";

  test("marks a SURVIVING marker with the ink the supplementary markers wear", () => {
    // An ordered item's `1.` keeps its glyph and is only tinted, so it is supplementary
    // and stays on --ink-faint — the ink caret-theme.ts already gives the fence markers
    // and the ** / _ emphasis markers. No sixth --chip-* token for a single dash.
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

  test("steps the REPLACEMENT glyph up to the ink that clears the non-text floor", () => {
    // This test and the ink one above are the two halves of EXC-871's epic-wide rule, and
    // the bullet is the construct that shows both at once. The dash it draws over is
    // transparent, so the dot is the only thing left saying "list item here" — WCAG
    // 1.4.11's 3:1 floor binds it, on the surface it really renders on. --ink-faint
    // measures 2.90 on catppuccin-latte and 2.97 on github-light against the banded diff
    // body; theme.test.ts owns those numbers and reds naming the palette. This pins only
    // that the sheet spends what they chose, and that the drawn glyph and the surviving
    // marker genuinely differ — one shared ink here would mean the rule had been dropped.
    expect(glyphRule).toMatch(/color:\s*var\(--ink-soft\)/);
    expect(glyphRule).not.toMatch(/--ink-faint/);
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

  test("collapses a task item's marker instead of drawing over it", () => {
    // One treatment per row: a checkbox IS a task item's marker, so the `-` beside it is
    // neither a second marker nor faint punctuation to read past. The kind is settled in
    // the emission (inlineSpans.ts tags it "task"), which is why the glyph selector can
    // name "bullet" exactly rather than carving the task case back out of it. What this
    // pins is the one place the family breaks its own transform-in-place rule: the task
    // run costs no advance, so the box lands where the item's text begins rather than two
    // cells into a row nothing else indents. Nothing is painted back in its place.
    expect(glyphRule).toContain('[data-md-list="bullet"]');
    expect(taskRule).toMatch(/font-size:\s*0/);
    expect(rulesFor(String.raw`\[data-md-list="task"\]::before`)).toEqual([]);
  });

  test("collapses it in the one way that keeps the row copyable", () => {
    // display: none and visibility: hidden collapse the run just as well and are the two
    // spellings Blink drops from a copied selection — the row would lose the `- ` from its
    // markdown, which is the contract the whole family is built around (tasks.e2e.ts reads
    // the real clipboard). A zero font-size keeps the characters in the serialization.
    expect(taskRule).not.toMatch(/display:\s*none|visibility:\s*hidden/);
  });

  test("carries no transition", () => {
    // svelte-rules § Motion: the diff surface swaps state instantly.
    expect(`${anyMarker}${bulletRule}${glyphRule}`).not.toMatch(/transition/);
  });
});

// EXC-860: the task-list checkbox, drawn over the `[ ]` / `[x]` / `[/]` run inlineSpans.ts
// already tags. Structurally this is the list marker one block up scaled from one character
// cell to three, and it is an ICON rather than a glyph: one vendored Lucide square per state,
// masked into ::before. A typed U+2610 / U+2611 took its weight, its corner radius and its
// size from whichever font the platform resolved, which is what made the pair read as ASCII
// art of a checkbox rather than as a control. That the run really measures three cells and
// that the box really paints is tasks.e2e.ts's job; this suite pins the declarations.
describe("the task-list checkbox (EXC-860)", () => {
  const runRule = rulesFor(String.raw`\[data-md-checkbox\]`)[0] ?? "";
  const glyphRule = rulesFor(String.raw`\[data-md-checkbox\]::before`)[0] ?? "";
  const checkedRule = rulesFor(String.raw`\[data-md-checkbox="checked"\]::before`)[0] ?? "";
  const slashedRule = rulesFor(String.raw`\[data-md-checkbox="slashed"\]::before`)[0] ?? "";
  const suppressRule =
    rulesFor(String.raw`\[data-md-checkbox\] ~ \[data-md-checkbox\]::before`)[0] ?? "";

  test("hands the bracket run's own cells to the glyph drawn over them", () => {
    // Transform-in-place (EXC-855): the brackets are still in the DOM and still copied —
    // they are only made invisible so the checkbox can occupy the columns they already had.
    expect(runRule).toMatch(/color:\s*transparent/);
  });

  test("tells the three states apart by shape, not by colour", () => {
    // Empty square, square with a check, square with a slash — three Lucide glyphs on one
    // ink. Neither state rule introduces a hue or an opacity step of its own, so the
    // distinction survives a reader who cannot separate two colours (EXC-863 records the
    // same failure one rule family over).
    for (const rule of [checkedRule, slashedRule]) {
      expect(rule).toMatch(/mask-image:/);
      expect(rule).not.toMatch(/color|opacity/);
    }
    // And the two really are different pictures, not the same one named twice.
    expect(checkedRule).not.toBe(slashedRule);
  });

  test("is an icon rather than a glyph, so no font decides how it looks", () => {
    // The whole point of the shape. A glyph renders at the text's own stroke weight in
    // whichever face the platform resolved — and a colour emoji font may substitute a
    // picture outright, which ignores color. An empty content string masked with a vendored
    // SVG is the same control in every font and every palette. The mask is inlined as a
    // data: URI, so it needs no network round-trip and no emitted asset either.
    expect(glyphRule).toMatch(/content:\s*""/);
    expect(glyphRule).toMatch(/mask:\s*\$\(CHECKBOX_MASKS\.unchecked\)/);
    // Sized in em, so the control tracks the type scale rather than one viewport's pixels.
    expect(overrideDecls).toMatch(/--checkbox-size:\s*[\d.]+em/);
  });

  test("ships the same vendored Lucide squares the rest of the product wears", () => {
    // doc/agents/icon-rules.md: icons live in ui/src/icons/ and are imported ?raw, never
    // hand-drawn a second time in a stylesheet and never fetched from a CDN. The three
    // states name three DIFFERENT files, so a copy-paste that pointed two states at one
    // glyph fails here rather than in a screenshot. That each file is the verbatim Lucide
    // SVG, and that the registry and the licence table know it, is icons.test.ts's job.
    for (const icon of ["square", "square-check-big", "square-slash"]) {
      expect(coreStyles).toContain(`@/icons/${icon}.svg?raw`);
    }
    expect(coreStyles).toMatch(/data:image\/svg\+xml,\$\{encodeURIComponent\(square/);
    const masked = (rule: string) => rule.match(/CHECKBOX_MASKS\.(\w+)/)?.[1];
    expect(new Set([glyphRule, checkedRule, slashedRule].map(masked))).toEqual(
      new Set(["unchecked", "checked", "slashed"]),
    );
  });

  test("spends one step above the faint marker ink, which the floor requires", () => {
    // Not the --ink-faint the structural markers spend. A checkbox reports STATE, so WCAG
    // 1.4.11's 3:1 floor for a non-text indicator binds it — and on the surface it renders
    // on (--paper-sunk and the row's ink bands, not the --paper / --paper-raised the ramp
    // test measures) --ink-faint falls under that floor on two of the nine palettes.
    // theme.test.ts pins the ink chosen here against all nine on that surface; this only
    // holds the sheet to the same token, so the two cannot drift apart. The mask is what
    // makes the token reachable at all: background-color paints through it, so the glyph
    // rides the palette rather than whatever colour an <img> would have baked in.
    expect(glyphRule).toMatch(/background-color:\s*var\(--ink-soft\)/);
    expect(glyphRule).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(glyphRule).not.toMatch(/--chip-/);
    expect(glyphRule).not.toMatch(/opacity/);
  });

  test("draws out of flow so no column moves", () => {
    // Identical reasoning to the bullet: rows render white-space: pre, so a pseudo-element
    // in flow would push every glyph after it. Absolutely positioned, it contributes
    // nothing to the line whatever its size, so the three source columns keep their
    // advance and no margin is needed (or allowed) to claw any back.
    expect(glyphRule).toMatch(/position:\s*absolute/);
    expect(glyphRule).not.toMatch(/\bmargin[a-z-]*\s*:/);
  });

  test("centres the glyph in the three-cell run", () => {
    // A bullet overdraws ONE cell and needs no offset; the brackets are THREE, so the box
    // has to be placed in them — 1.5ch is the run's middle, and half the box's own width
    // brings its edge back to centre it there. Anchored to the MARKER SPAN (position:
    // relative), because the static position of a pseudo-element on a later token would
    // land the box past the run's three characters.
    expect(runRule).toMatch(/position:\s*relative/);
    expect(glyphRule).toMatch(/inset-inline-start:\s*calc\(1\.5ch/);
    expect(glyphRule).toMatch(/var\(--checkbox-size\)/);
  });

  test("keeps the drawn box out of the clipboard", () => {
    // The epic's copy contract. Blink emits generated content into the plain-text flavour
    // of a copied selection, invisible to Selection.toString() and visible only in the real
    // clipboard, which tasks.e2e.ts reads. A masked box cannot leak a character the way the
    // ☐ glyph could, but generated content is still content, so it stays out of the
    // selection outright.
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

  test("carries no type metrics of its own, so the em sizes track the row", () => {
    // The glyph is sized from --checkbox-size, which is em-relative — so it resolves
    // against the token's own inherited font-size. Declaring one here would silently
    // decouple the control from the type scale the row is set in.
    expect(glyphRule).not.toBe("");
    expect(glyphRule).not.toMatch(/font-size|line-height|font-family/);
  });

  test("carries no transition", () => {
    // svelte-rules § Motion: the diff surface swaps state instantly. The non-empty guard is
    // what keeps this from passing on four selectors that resolved to nothing.
    const all = [runRule, glyphRule, checkedRule, slashedRule];
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
    expect(iconRule).toMatch(/mask:\s*\$\(FILE_ICON_MASK\)/);
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
    expect(folderRule).toMatch(/mask:\s*\$\(FOLDER_ICON_MASK\)/);
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
    // Padding widens the fill out past the glyphs, and it is the chip family's own pair
    // rather than a second set of numbers — a reference and a codespan beside it have to
    // be spaced alike. EXC-880 cancelled the inline half with a negative margin so the
    // backticks around a citation never shifted; that spends the fill UNDER the
    // neighbouring glyph, so it is gone and the reference shifts its neighbours like
    // every other chip.
    expect(tokenRule).toMatch(/padding:\s*var\(--chip-pad-block\) var\(--chip-pad-inline\)/);
    expect(tokenRule).not.toMatch(/margin/);
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

test("spends no --rule token anywhere on the diff body", () => {
  // The sheet-wide half of the same finding, and the reason it is one assertion rather
  // than a note: --rule and --rule-strong draw hairlines on the CHROME surfaces, where
  // they are 10% and 16% ink over --paper / --paper-raised and read correctly. The diff
  // body is --paper-sunk plus 2-8% ink row bands, and over that ground they measure
  // 1.15-1.37 and 1.24-1.64 across the nine — a line that is in the DOM and not on the
  // screen. Every mark this epic draws there spends the ink ramp instead. Scanned over
  // the declarations, so the prose above (and this comment) can keep naming the tokens.
  expect(overrideDecls).not.toContain("--rule");
});

// EXC-863: blockquote level bars. The bar belongs to the epic's transform-in-place
// category rather than to the chip family: it overdraws the marker it replaces instead of
// tinting a run, so it spends ink from the ramp and mints nothing new. WHICH ink is
// EXC-871's replacement/supplementary split — the `>` under it is transparent, so the bar
// is the only carrier and takes --ink-soft. The subdue is the whole-line half, and where it
// is anchored is the load-bearing part — see the rule's own note in coreStyles.ts.
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

  test("spends the replacement family's ink, not a chip tint and not the faint marker ink", () => {
    // EXC-855 refuses a sixth token for marker ink, so the bar takes one of the two the
    // ink ramp already offers rather than minting one or borrowing a chip's. WHICH one is
    // EXC-871's epic-wide rule: the `>` above it is transparent, so the bars are the only
    // thing carrying "quoted, and this deep", which puts them under WCAG 1.4.11's 3:1
    // floor on the banded diff body. theme.test.ts measures that floor across the nine and
    // reds on --ink-faint (2.90 catppuccin-latte, 2.97 github-light); this pins the
    // declaration, including that it did not stay on the faint ink EXC-863 shipped.
    expect(barRule).toMatch(/background-color:\s*var\(--ink-soft\)/);
    expect(barRule).not.toContain("--ink-faint");
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
    // The whole point of the mechanism: no node, no ::before, nothing a child-count
    // settle check can disagree with.
    expect(ruleRule).toMatch(/background-image:\s*linear-gradient\(/);
    expect(overrideDecls).not.toMatch(/\[data-md-rule\][^{]*::(?:before|after)/);
  });

  test("spans the full column at one pixel, centered", () => {
    expect(ruleRule).toMatch(/background-size:\s*100%\s+1px/);
    expect(ruleRule).toMatch(/background-position:\s*center/);
    expect(ruleRule).toMatch(/background-repeat:\s*no-repeat/);
  });

  test("measures that width against a box the seam pull cannot move", () => {
    // The seam-fill group pulls a hovered, cursored or selected row 20px left and re-adds
    // the inset as padding, so a percentage of the PADDING box (the default origin) would
    // lengthen the divider by 20px for as long as the row is banded. The content box is
    // invariant under that pull.
    expect(ruleRule).toMatch(/background-origin:\s*content-box/);
  });

  test("spends the ink that clears the non-text floor, not a rule token or a chip tint", () => {
    // The rule tokens are 10% and 16% ink and effectively vanish on the sunk diff surface
    // (--rule 1.15-1.37, --rule-strong 1.24-1.64 across the nine palettes); --ink-faint is
    // under 3:1 on two of them. theme.test.ts owns those measurements — this pins only that
    // the sheet spends what they chose.
    expect(ruleRule).toMatch(/var\(--ink-soft\)/);
    expect(ruleRule).not.toContain("--chip-");
    expect(ruleRule).not.toContain("--rule");
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
    // numbers against the rows long before it read as a divider. Anchored on the start of
    // a declaration rather than on a word boundary, so `line-height` — the likeliest way
    // to grow a row while looking harmless — is caught rather than skipped past.
    expect(ruleRule).not.toMatch(
      /(?:^|[;{])\s*(?:margin|padding|height|min-height|line-height|border)[a-z-]*\s*:/,
    );
  });
});

// EXC-864: a GFM table renders as a real column-aligned table — a framed subgrid card
// whose rows take its column tracks, with the source pipes taken to transparent and the
// column rules painted in the space they vacate. What this suite pins is that trade
// rather than the layout: which glyphs go, what replaces them, what ink that owes, what
// is allowed to size a column, and that the card does NOT scroll. The boxes those
// declarations produce are test/e2e/tables.e2e.ts's.
describe("tables (EXC-864)", () => {
  const cardRule =
    overrideDecls.match(/\[data-content\]\s*>\s*\[data-table-card\]\s*\{[^}]*\}/)?.[0] ?? "";
  const rowRule =
    overrideDecls.match(
      /\[data-content\]\s*>\s*\[data-table-card\]\s*>\s*\[data-line\]\s*\{[^}]*\}/,
    )?.[0] ?? "";
  // The card's own fill only shows through once the library's per-row --diffs-bg is
  // cleared, which this rule does for every row that is not carrying a band.
  const cardRows = rulesFor(String.raw`>\s*\[data-table-card\]\s*>\s*\[data-line\]:not\([^{}]*\)`);
  const transparentRow = cardRows.find((r) => r.includes("background-color:"));
  // The hairline under every body row — the same selector shape, a different exclusion
  // list and a background LAYER rather than a fill.
  const hairlineRule = cardRows.find((r) => r.includes("background-image:"));
  const headCap = rulesFor(String.raw`\[data-line\]\[data-table-head\]`).find((r) =>
    r.includes("text-transform:"),
  );
  const headTokens = rulesFor(String.raw`\[data-line\]\[data-table-head\][^{}]*`).find((r) =>
    r.includes("data-table-pipe"),
  );
  const cellRule = rulesFor(String.raw`\[data-table-cell\]`).find((r) => r.includes("max-width:"));
  const inertRule = rulesFor(String.raw`\[data-table-inert\]`)[0];
  const pipeRule = rulesFor(String.raw`\[data-table-pipe\]`)[0];
  // Two rules key off the same "this cell opens with a pipe" selector: the divider it
  // paints, and the hanging indent it owes.
  const edgeRules = rulesFor(String.raw`\[data-table-edge="both"\]\s*\)`);
  const dividerRule = edgeRules.find((r) => r.includes("background-image:"));
  const hangRule = edgeRules.find((r) => r.includes("text-indent:"));
  const ruleRow = rulesFor(String.raw`\[data-line\]\[data-table-rule\]`).find((r) =>
    r.includes("background-image:"),
  );
  const ruleInk = rulesFor(String.raw`\[data-line\]\[data-table-rule\][^{}]*`).find((r) =>
    r.includes("color:"),
  );
  const headRow =
    overrideDecls.match(
      /\[data-content\]\s*>\s*\[data-table-card\]\s*>\s*:first-child\s*\{[^}]*\}/,
    )?.[0] ?? "";
  const footRow =
    overrideDecls.match(
      /\[data-content\]\s*>\s*\[data-table-card\]\s*>\s*:last-child\s*\{[^}]*\}/,
    )?.[0] ?? "";
  const tightRule =
    [
      ...overrideDecls.matchAll(
        /\[data-content\][^{}]*\[data-line\]\[data-table-rule\][^{}]*\{[^}]*\}/g,
      ),
    ]
      .map((m) => m[0])
      .find((r) => r.includes("line-height:")) ?? "";
  // The gutter's three, which rulesFor cannot reach — it anchors on [data-content].
  const numberRule =
    overrideDecls.match(
      /:nth-child\(2 of \[data-column-number\]\)\s*>\s*\[data-line-number-content\]\s*\{[^}]*\}/,
    )?.[0] ?? "";
  const dotRule =
    overrideDecls.match(
      /:nth-child\(2 of \[data-column-number\]\)\s*>\s*\[data-line-number-content\]::before\s*\{[^}]*\}/,
    )?.[0] ?? "";
  const slotRule =
    overrideDecls.match(/\[data-gutter\]\s*\[data-gutter-utility-slot\]\s*\{[^}]*\}/)?.[0] ?? "";
  const slotOverride =
    overrideDecls.match(
      /:nth-child\(2 of \[data-column-number\]\)\s*>\s*\[data-gutter-utility-slot\]\s*\{[^}]*\}/,
    )?.[0] ?? "";

  test("every rule this suite reads is present", () => {
    for (const [name, rule] of Object.entries({
      cardRule,
      rowRule,
      transparentRow,
      hairlineRule,
      headCap,
      headTokens,
      cellRule,
      inertRule,
      pipeRule,
      dividerRule,
      ruleRow,
      ruleInk,
      headRow,
      footRow,
      tightRule,
      dotRule,
      numberRule,
      slotRule,
      slotOverride,
      hangRule,
    })) {
      expect(rule, `${name} did not match`).toBeTruthy();
    }
  });

  test("grows the card until the whole table is visible rather than scrolling it", () => {
    // The one place this card parts company with the code card: a fenced block earns a
    // panel with its own scroll box, where a table's value is being comparable at a
    // glance. A max-width or an overflow here would hide the last columns behind a
    // scrollbar, which is what the issue asks not to happen.
    expect(cardRule).not.toContain("max-width");
    expect(cardRule).not.toContain("overflow");
    expect(overrideDecls).not.toMatch(/\[data-table-card\][^{]*::-webkit-scrollbar/);
  });

  test("takes its rows from the parent, declares its own columns, and shrinks to them", () => {
    // Subgrid rows are what keep the gutter numbers aligned as a wrapped cell grows its
    // track. justify-self is what makes the panel below hug the TABLE: a stretched card
    // would panel the whole reading column instead.
    expect(cardRule).toMatch(/grid-template-rows:\s*subgrid/);
    expect(cardRule).toMatch(
      /grid-template-columns:\s*repeat\(var\(--table-columns[^)]*\), max-content\)/,
    );
    expect(cardRule).toMatch(/justify-self:\s*start/);
  });

  test("is a surface, on the code card's fill, and no longer a frame", () => {
    // EXC-1136 traded the outline for a panel. The fill is the code card's own, quoted
    // rather than re-tuned: a table and a fenced block are the two cards on this page,
    // and two panel colours a shade apart read as a mistake rather than as two kinds of
    // block. The elevation is what says "floating"; the frame it replaces is gone
    // outright, so the column rules now stop against the panel's edge instead of a line.
    const codeCard =
      overrideDecls.match(/\[data-content\]\s*>\s*\[data-code-card\]\s*\{[^}]*\}/)?.[0] ?? "";
    const codeFill = codeCard.match(/background-color:\s*([^;]+);/)?.[1];
    expect(codeFill).toBeTruthy();
    expect(cardRule).toContain(`background-color: ${codeFill};`);
    expect(cardRule).toMatch(/border-radius:\s*var\(--radius\)/);
    expect(cardRule).toMatch(/box-shadow:\s*[^;]+;/);
    expect(cardRule).not.toMatch(/border:\s*1px/);
  });

  test("clears the library's row fill inside the card, banded rows excepted", () => {
    // @pierre/diffs paints every row its own opaque --diffs-bg, so without this the rows
    // tile straight over the panel and the fill above never reaches the screen — the same
    // companion the code card carries.
    expect(transparentRow).toMatch(/background-color:\s*transparent/);
    // The three banded states are carved OUT rather than re-tuned on top: a hovered,
    // cursored or drag-selected row inside a table keeps exactly the band it painted
    // before this card had a fill, so there is no second tuned number to keep in step
    // with the first. Shorten this list and the band silently vanishes.
    for (const state of ["[data-selected-line]", "[data-hovered]", "[data-caret-cursor]"]) {
      expect(transparentRow).toContain(state);
    }
  });

  test("zeroes the row padding so the subgrid tracks are the card's", () => {
    // The library pads every row 1ch inline, which on a subgrid insets the row's own
    // tracks from the card's — the cells stop filling the columns they define, and the
    // header rule (a percentage of the row) stops matching the frame.
    expect(rowRule).toMatch(/grid-template-columns:\s*subgrid/);
    expect(rowRule).toMatch(/padding-inline:\s*0/);
  });

  test("caps the CELL, not the track, so one prose column wraps and the rest do not", () => {
    // A max-content track never shrinks under space pressure, so the cap riding the cell
    // resolves each track to min(its content, the cap). Capping the tracks instead lets
    // the grid squeeze every column at once, which is the reflow this avoids.
    expect(cellRule).toMatch(/max-width:\s*64ch/);
    expect(cellRule).toMatch(/white-space:\s*pre-wrap/);
  });

  test("hangs a wrapped cell's continuation lines under its own first line", () => {
    // A cell's text does not start at the cell's edge: the source puts a pipe and a space
    // before it. Continuation lines starting at the edge therefore sat two characters
    // left of every line above them, and ran through the column rule painted half a
    // character in.
    //
    // The padding and the indent are one mechanism and have to match: the padding moves
    // every line right, the indent pulls the first one back, so the pipe stays on its own
    // character column and the track is the width it always was.
    expect(hangRule).toMatch(/padding-inline-start:\s*2ch/);
    expect(hangRule).toMatch(/text-indent:\s*-2ch/);
    // Keyed on the edge attribute, which IS "this cell opens with a pipe" — a table
    // written without outer pipes has a first cell whose text starts at the edge, and it
    // must indent nothing. Not :not(:first-child), which is the DIVIDER's question.
    expect(hangRule).toContain('[data-table-edge="start"]');
    expect(hangRule).not.toContain(":not(:first-child)");
  });

  test("keeps the source's own alignment padding out of the column's width", () => {
    // An author pads every cell out to the widest thing typed in the column, which is a
    // fact about the SOURCE — and a lie the moment the display text is shorter, as a
    // collapsed link's is. Zero-size rather than hidden, so the characters stay in the
    // layout tree where selectionCopy.ts and the search Ranges still find them.
    expect(inertRule).toMatch(/font-size:\s*0/);
    expect(inertRule).not.toMatch(/display:\s*none/);
    expect(inertRule).not.toMatch(/visibility:\s*hidden/);
  });

  test("aligns a wrapped cell's continuation lines with its column", () => {
    // text-align on the cell rather than its tokens: a token-level rule would only ever
    // reach the first visual line of a wrapped cell.
    for (const value of ["left", "center", "right"] as const) {
      const rule = rulesFor(String.raw`\[data-table-align="${value}"\]`)[0];
      expect(rule).toMatch(new RegExp(String.raw`text-align:\s*${value}`));
    }
  });

  test("hides the pipes and paints the rules on the cell instead", () => {
    // The glyph does not fill its line box, so a column of pipes reads as a dotted stack
    // and disappears entirely below a wrapped cell's first line. The rule rides the cell
    // box, which is full height whatever the row does.
    expect(pipeRule).toMatch(/color:\s*transparent/);
    expect(dividerRule).toMatch(/background-image:\s*linear-gradient\(/);
    expect(dividerRule).toMatch(/background-size:\s*1px\s+100%/);
    expect(dividerRule).toMatch(/background-position:\s*0\.5ch/);
  });

  test("draws the dividers BETWEEN columns and leaves the edges to the frame", () => {
    // A cell draws its own pipe, so the first cell of a row would draw the table's left
    // edge and the last its right — half a character inside the frame, which reads as a
    // doubled line. There is no inline-end layer at all, and :first-child drops the
    // leading one.
    expect(dividerRule).toContain(":not(:first-child)");
    expect(overrideDecls).not.toMatch(/\[data-table-edge[^{]*\{[^}]*calc\(100% - 0\.5ch\)/);
  });

  test("replaces the delimiter row's markers with one full-width rule", () => {
    // Paint, never a node: tables.ts settles a celled row by counting its cells, so a
    // pass that appended a rule here would rebuild the row on every repaint and never
    // adopt it. A plain 100% spans the frame's inner width exactly, which is what
    // zeroing the row padding above buys.
    expect(ruleRow).toMatch(/background-image:\s*linear-gradient\(/);
    expect(ruleRow).toMatch(/background-size:\s*100%\s+1px/);
    expect(ruleRow).not.toContain("background-origin");
    expect(overrideDecls).not.toMatch(/\[data-table-rule\][^{]*::(?:before|after)/);
    expect(ruleInk).toMatch(/color:\s*transparent/);
    // Descendant, not the thematic break's child combinator: a celled row's tokens sit
    // one level further down, inside the cells.
    expect(ruleInk).toMatch(/\[data-line\]\[data-table-rule\] \*/);
  });

  test("declares the rule ink once, as one step off the surface, and spends it everywhere", () => {
    // The column dividers, the delimiter rule and the row hairlines are one mark in three
    // places; a tuned number written out three times is three numbers waiting to drift
    // apart. (The frame was the fourth until EXC-1136 removed it.)
    //
    // ONE STEP OFF THE SURFACE, NOT AN INK SOFTENED TOWARD IT. Until EXC-1136's review
    // pass this was --ink-soft mixed toward --paper-sunk through a light-dark() whose two
    // arms carried different numbers, because an ink softened by the same amount lands in
    // two different places on a light and a dark palette. Stated the other way round —
    // --paper-sunk stepped toward --ink — one number lands in the SAME place on all nine,
    // because the operands do the scheme-flipping themselves. That is the same idiom the
    // card fill above and the row bands in styles/diffview.css already use, and it is why
    // light-dark() is gone from this declaration rather than merely retuned.
    expect(cardRule).toMatch(
      /--table-rule:\s*color-mix\(in lab, var\(--paper-sunk\), var\(--ink\) 16%\)/,
    );
    // Not light-dark(): a per-scheme arm here would be the old mechanism creeping back.
    expect(cardRule).not.toMatch(/--table-rule:[^;]*light-dark/);
    for (const rule of [dividerRule, ruleRow, hairlineRule]) {
      expect(rule).toContain("var(--table-rule)");
      expect(rule).not.toContain("--ink-faint");
      expect(rule).not.toContain("--rule");
    }
    // One declaration, nowhere else.
    expect(overrideDecls.match(/--table-rule:/g)).toHaveLength(1);
  });

  test("rounds the end rows so they stop painting over the card's corners", () => {
    // The rule survives the frame it was written for. A BANDED end row is still opaque —
    // the transparent rule above steps aside for it — so a selected or cursored first row
    // paints its square corners straight over the card's own arc and the panel reads as a
    // rounded rectangle with a bite out of the corner. The same radius, so the row's edge
    // follows the card's rather than crossing it.
    expect(headRow).toMatch(/border-top-left-radius:\s*var\(--radius\)/);
    expect(headRow).toMatch(/border-top-right-radius:\s*var\(--radius\)/);
    expect(footRow).toMatch(/border-bottom-left-radius:\s*var\(--radius\)/);
    expect(footRow).toMatch(/border-bottom-right-radius:\s*var\(--radius\)/);
    // Not by clipping. overflow on the card would round the corners in one declaration
    // and make the card a scroll container, which is the one thing it must never be —
    // the same reason the sizing test above refuses it.
    for (const rule of [headRow, footRow]) expect(rule).not.toContain("overflow");
    // The last CHILD, not the last row: an annotation row is the bottom of the card
    // whenever someone comments on the table's final line.
    expect(footRow).not.toContain("[data-line]:last-child");
  });

  test("takes the delimiter row down to a fraction of a line", () => {
    // The row draws one hairline and was a full text line tall, so it set half a line of
    // air above that hairline and half below — the gap under a header the eye reads as
    // padding. line-height rather than a height, so the row still tracks the type scale;
    // a fraction of a line rather than one, which the gutter's half of the row can only
    // follow because its digits are gone (below).
    expect(tightRule).toMatch(/line-height:\s*0?\.\d+/);
    expect(tightRule).not.toContain("font-size");
    expect(tightRule).not.toContain("height: 0;");
    // Both columns in one rule. The row track is the taller of the gutter cell and the
    // content row, and the gutter still holds its number — hidden, but in flow — so a
    // declaration reaching only the content row would resolve to the number's line box
    // and change nothing on screen.
    expect(tightRule).toContain("[data-table-card] > [data-line][data-table-rule]");
    expect(tightRule).toMatch(/:nth-child\(2 of \[data-column-number\]\)/);
  });

  test("replaces the delimiter's line number with a dot on that number's own box", () => {
    // A line number is an address, and the delimiter is the one line of a table that says
    // nothing — numbering it spent a full line of rhythm on an address for nothing, and
    // the row is now far too short to set a digit in. The dot still says a line is there,
    // which stays true: the comment anchors rest on it.
    //
    // visibility rather than display, because the number's BOX is what places the dot:
    // the library sizes every number to the widest in the file and right-aligns the
    // digits inside it, so a dot centred on the column lands off the numbers themselves
    // as soon as a file runs past a power of ten. min-width takes the box back to this
    // number's own digits; height and vertical-align take it to the row rather than to
    // the text baseline it would otherwise sit on.
    expect(numberRule).toMatch(/visibility:\s*hidden/);
    expect(numberRule).not.toMatch(/display:\s*none/);
    expect(numberRule).toMatch(/min-width:\s*0/);
    expect(numberRule).toMatch(/height:\s*100%/);
    expect(numberRule).toMatch(/vertical-align:\s*top/);
    // Painted, not swapped. Replacing the number's TEXT would be a DOM write on every
    // repaint — the childList churn tables.ts exists to avoid. The paint needs a pseudo
    // of its own because visibility takes an element's background along with its text;
    // this one is free, where the ::before EXC-865 spends is on the CELL a level up.
    expect(dotRule).toMatch(/visibility:\s*visible/);
    expect(dotRule).toMatch(/background-image:\s*radial-gradient\(/);
    expect(dotRule).toMatch(/inset:\s*0/);
    // Round, not square: a farthest-corner circle is clipped by its own painting area and
    // the dot comes out a tiny block.
    expect(dotRule).toContain("circle closest-side");
    // The gutter's own ink, the same the numbers around it take, including their hover
    // and selection states — not a token of its own to drift from them.
    expect(dotRule).toContain("currentColor");
    expect(dotRule).toMatch(/background-position:\s*center/);
    // Both halves reach the cell positionally, and both count LINE cells rather than
    // children — which is what steps over the buffer a comment inserts ahead of it. Bare
    // :nth-child(2) would dot that buffer instead.
    for (const rule of [dotRule, numberRule]) {
      expect(rule).toMatch(/:nth-child\(2 of \[data-column-number\]\)/);
    }
  });

  test("centres the hover affordance on one line of its row, not on the whole row", () => {
    // The "+" is a fixed size and a row is not, so it is centred rather than hung from
    // the top. What it is centred ON is one line: a row grows when a cell wraps or an
    // image lands on it and its number does not, so a button centred on the box sits a
    // full line below the address it belongs to. The library stretches the slot over the
    // whole cell, so the clamp is what takes it back to a line.
    expect(slotRule).toMatch(/align-items:\s*center/);
    expect(slotRule).toMatch(/max-height:\s*1lh/);
    // A max rather than a height, because a row can be shorter than a line too — an
    // over-constrained absolute box keeps its top edge, so this only trims from below.
    expect(slotRule).not.toMatch(/[^-]height:\s*1lh/);
    // Stated for every row, because that is the rule; the one exception is scoped and
    // says why it is one.
    expect(slotRule).not.toContain("[data-table-card-gutter]");
    expect(slotOverride).toMatch(/max-height:\s*none/);
    expect(slotOverride).toMatch(/:nth-child\(2 of \[data-column-number\]\)/);
  });

  test("caps the header in subdued small-caps rather than shouting it in bold", () => {
    // EXC-1136: a filled card carries the table's edge now, so the header no longer has to
    // out-weigh a frame to read as a header. Uppercase plus a step back in the ink says
    // "these are labels" more quietly than bold did.
    expect(headCap).toMatch(/text-transform:\s*uppercase/);
    expect(headCap).toMatch(/color:\s*var\(--ink-soft\)/);
    expect(headCap).not.toContain("font-weight");
    // No font-size and no letter-spacing, both for the same reason: the column dividers
    // paint 0.5ch INSIDE each cell, so a header set on a different advance width would
    // land its divider segment on a different x than every body row's.
    for (const rule of [headCap, headTokens]) {
      expect(rule).not.toContain("font-size");
      expect(rule).not.toContain("letter-spacing");
    }
    // The tokens too — shiki inks each one, and the row's own color never reaches them.
    // The pipes are excluded BY NAME: this arm scores 0,5,0 and would otherwise outrank
    // the 0,3,0 rule that took them to transparent, resurrecting the picket fence EXC-864
    // removed.
    expect(headTokens).toMatch(/color:\s*var\(--ink-soft\)/);
    expect(headTokens).toContain(":not([data-table-pipe])");
  });

  test("rules a hairline under every body row, and only under those", () => {
    // The delimiter row's paint shape moved from the row's centre to its bottom edge — a
    // background layer, never a border: tables.ts settles a celled row by COUNTING its
    // cells, and nothing here may move the box model the search ranges, drag ranges, vim
    // motions and comment anchors all resolve against.
    expect(hairlineRule).toMatch(/background-image:\s*linear-gradient\(/);
    expect(hairlineRule).toMatch(/background-size:\s*100%\s+1px/);
    expect(hairlineRule).toMatch(/background-position:\s*bottom/);
    // The head row is excluded because the delimiter row below it already draws that
    // separator, and the delimiter row because it IS one.
    expect(hairlineRule).toContain("[data-table-head]");
    expect(hairlineRule).toContain("[data-table-rule]");
    // And the card's LAST child, whose hairline would land a pixel above the panel's own
    // bottom edge and read as the frame this change removed — asymmetric, since the top
    // edge has no matching line. :last-child rather than the last body row by name: when
    // a comment opens on the table's final line the annotation row becomes the bottom of
    // the card, and the body row above it is then an interior row that should rule again.
    expect(hairlineRule).toContain(":not(:last-child)");
  });

  test("adds the new marks as paint and nothing else", () => {
    // Every mark this card gained is a background layer or an ink. A border, a padding or
    // a margin on any of them would shift the monospace grid — which is the one thing the
    // whole table treatment is built not to do.
    for (const rule of [hairlineRule, headCap, headTokens]) {
      expect(rule).not.toMatch(/(?:^|[\s;{])(?:border|padding|margin)[-:]/);
    }
  });

  test("keeps a comment inside the card from widening the table", () => {
    // A spanning grid item contributes its own max-content to every track it covers, and
    // a composer's is large enough to stretch a narrow table the moment someone comments.
    // container-type on the card would say this directly and cannot be used: its layout
    // containment stops the subgrid contributing the comment's height, collapsing the
    // thread to one line.
    const annotation =
      overrideDecls.match(
        /\[data-content\]\s*>\s*\[data-table-card\]\s*>\s*\[data-line-annotation\]\s*\{[^}]*\}/,
      )?.[0] ?? "";
    expect(annotation).toMatch(/contain:\s*inline-size/);
    expect(cardRule).not.toContain("container-type");
  });
});

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

  test("drops the bold and italic tints on a selected row so a drag reads as one flat band", () => {
    // The guard rides each member's own tint VARIABLE rather than the shared fill rule,
    // because the members disagree about it: the link chip (EXC-859) keeps its tint through
    // a selection. background-image is one property, so a second unguarded rule would
    // replace the whole stack rather than add a layer to it — an unset variable falling
    // back to transparent is what lets one stack carry two policies.
    expect(tintRule("bold")).toMatch(/:not\(\[data-selected-line\]\)/);
    expect(tintRule("italic")).toMatch(/:not\(\[data-selected-line\]\)/);
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
  const fillRule = overrideDecls.match(/\[data-content\][^{}]*\[data-md\]\s*\{[^}]*\}/)?.[0] ?? "";
  const codeMember =
    overrideDecls.match(/\[data-content\][^{}]*\[data-md~="code"\]\s*\{[^}]*\}/)?.[0] ?? "";
  const fenceRule =
    overrideDecls.match(
      /\[data-content\][^{}]*\[data-code-line\][^{}]*\[data-code-fence\]\s*\{[^}]*\}/,
    )?.[0] ?? "";
  const nestedRef =
    overrideDecls.match(/\[data-file-ref\]\[data-md~="code"\]\s*\{[^}]*\}/)?.[0] ?? "";

  test("spends the family's inline-code tint through a layer of its own", () => {
    // A layer rather than a background-color, for the reason bold and italic are layers:
    // the middle run of a bold element wrapping inline code carries bold AND code, and a
    // single background-color would let one rule win and punch a gap through the bold pill.
    expect(codeMember).toMatch(/--md-code:\s*var\(--chip-code\)/);
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
    expect(token(fenceRule)).toBe("--chip-code");
    expect(token(codeMember)).toBe(token(fenceRule));
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

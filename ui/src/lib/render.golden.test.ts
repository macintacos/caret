// Golden-render and id-coverage hardening for the plan pipeline (EXC-542).
//
// These two suites are the safety net for a later sanitizer-allowlist change:
//   1. Golden render — `renderPlan(FIXTURE)` HTML is pinned byte-for-byte to a
//      committed expectation. Any shift in marked / DOMPurify / shiki output (or
//      the sanitizer allowlist) moves the bytes and fails loudly, because such a
//      shift silently moves the char offsets annotations anchor against.
//   2. id-coverage — every block-level element marked emits for a BLOCK_METHODS
//      entry carries a unique `id="b{n}"`. A new marked block type the override
//      loop misses would render un-annotatable; this fails when it does.
//
// Determinism re: shiki. The highlighter is a process-global singleton that
// renderPlan reads through highlightToHtml; its WARM output is NOT a safe golden
// because shiki's JS-regex tokenizer carries state across codeToHtml calls, so a
// given snippet's per-token span colors depend on what was highlighted before it
// in the shared `bun test` process — the same input yields different bytes by
// suite order. So the fixture's fenced block is tagged `text`, a language the
// highlighter never loads: highlightToHtml returns null and renderPlan always
// falls back to the plain <pre><code class="language-text"> — identical cold or
// warm. That keeps the golden a stable structural snapshot (tags, ids, attrs,
// text — the offset-bearing surface) regardless of highlighter state; shiki's
// highlighted-output path is covered separately by render.test.ts / highlight.test.ts.
//
// The fixture is synthetic and non-identifying (browser-testing rules).

import "../../test-setup.ts";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type HeadingEntry, renderPlan } from "./render.ts";

// Read the committed fixture + golden at test time (the icons.test.ts pattern):
// avoids the ambient `*.html` module typing that a static import resolves to.
const goldenPlan = readFileSync(join(import.meta.dir, "fixtures/golden-plan.md"), "utf8");
const goldenHtml = readFileSync(join(import.meta.dir, "fixtures/golden-plan.html"), "utf8");

// The fixture exercises every BLOCK_METHODS block type — heading (h1/h2/h3),
// paragraph, blockquote, list, code (a fenced block), table, hr — plus inline
// code, bold, and a link, so the golden covers the whole structural surface.
describe("renderPlan golden render", () => {
  test("HTML matches the committed golden byte-for-byte", () => {
    const { html } = renderPlan(goldenPlan);
    expect(html).toBe(goldenHtml);
  });

  test("headings outline matches the committed expectation", () => {
    const { headings } = renderPlan(goldenPlan);
    const expected: HeadingEntry[] = [
      { level: 1, slug: "plan-title", text: "Plan Title", blockId: "b0" },
      { level: 2, slug: "section-one", text: "Section One", blockId: "b2" },
      { level: 3, slug: "subsection", text: "Subsection", blockId: "b7" },
    ];
    expect(headings).toEqual(expected);
  });
});

// Tags marked emits for the BLOCK_METHODS entries (heading levels, paragraph,
// blockquote, list, code→pre, table, hr). Every such element in the output must
// carry a structural id; an element of one of these tags WITHOUT a b{n} id is a
// block type the override loop failed to stamp — un-annotatable, silently.
const BLOCK_TAGS = new Set([
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "P",
  "BLOCKQUOTE",
  "UL",
  "OL",
  "PRE",
  "TABLE",
  "HR",
]);

describe("renderPlan id coverage", () => {
  test("every block-level element carries a unique sequential b{n} id", () => {
    const { html } = renderPlan(goldenPlan);
    const container = document.createElement("div");
    container.innerHTML = html;

    // Walk the rendered tree: every block-level-tagged element must have a
    // b{n} id (this is the un-annotatable-block guard), and we collect those
    // ids in document order to assert the b0..bN sequence has no gaps/dupes.
    const idsInOrder: string[] = [];
    for (const el of container.querySelectorAll("*")) {
      if (!BLOCK_TAGS.has(el.tagName)) continue;
      const id = el.id;
      expect(id, `<${el.tagName.toLowerCase()}> is missing a structural id`).toMatch(/^b\d+$/);
      idsInOrder.push(id);
    }

    expect(idsInOrder.length).toBeGreaterThan(0);
    // Sequential from b0, no gaps: querySelectorAll returns document order, and
    // the override stamps the counter in that same order, so the ids must be
    // exactly b0..b{N-1}.
    const expectedSeq = idsInOrder.map((_, i) => `b${i}`);
    expect(idsInOrder).toEqual(expectedSeq);
    // Unique.
    expect(new Set(idsInOrder).size).toBe(idsInOrder.length);
  });

  test("the stamped id count equals every b{n} id in the raw HTML", () => {
    // Cross-check the DOM walk against the raw string: no block element the
    // walk counted is one the string lacks, and vice versa — so the coverage
    // assertion above can't pass by missing a stamped element.
    const { html } = renderPlan(goldenPlan);
    const container = document.createElement("div");
    container.innerHTML = html;
    const domIds = [...container.querySelectorAll<HTMLElement>("[id^='b']")]
      .map((el) => el.id)
      .filter((id) => /^b\d+$/.test(id));
    const rawIds = [...html.matchAll(/id="(b\d+)"/g)].map((m) => m[1]!);
    expect(new Set(domIds)).toEqual(new Set(rawIds));
  });
});

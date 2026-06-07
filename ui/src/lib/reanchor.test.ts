// Cross-version re-anchoring (EXC-542): an annotation captured against plan
// version v1 is re-resolved against a MUTATED v2 through the real resolveAnnotation
// + real renderPlan output. The existing anchors.test.ts drives the tiers with
// hand-built blocks; this suite closes the gap the only anchor e2e left open —
// it always reloaded the same version, so tier 2 (quote repair) and tier 3
// (orphan) across a re-render were never exercised end-to-end.
//
// getBlock queries the rendered DOM: each version's HTML is mounted into a
// happy-dom container and the block looked up by its structural id — the same
// lookup App.svelte performs against the live document. Fixtures are synthetic.

import "../../test-setup.ts";
import { describe, expect, test } from "bun:test";
import type { Annotation } from "@core/types";
import { resolveAnnotation } from "./anchors.ts";
import { renderPlan } from "./render.ts";

/** Mount a rendered plan and return a getBlock that looks blocks up by id. */
function mount(plan: string): (blockId: string) => HTMLElement | null {
  const { html } = renderPlan(plan);
  const container = document.createElement("div");
  container.innerHTML = html;
  return (blockId) => container.querySelector<HTMLElement>(`#${blockId}`);
}

// v1: the annotated paragraph. The quote "brown fox" sits at textContent offsets
// [10,19) (counted by hand from "The quick brown fox jumps over the lazy dog.").
const V1 = "The quick brown fox jumps over the lazy dog.\n";

const QUOTE = "brown fox";
const baseAnn: Annotation = {
  id: "a1",
  blockId: "b0",
  startOffset: 10,
  endOffset: 19,
  quote: QUOTE,
  comment: "note",
};

describe("cross-version re-anchor", () => {
  test("tier 1: resolves exactly against the version it was captured on", () => {
    // Baseline: against v1 the stored offsets still match the quote.
    const res = resolveAnnotation(baseAnn, mount(V1));
    expect(res.tier).toBe(1);
    expect(res.range!.toString()).toBe(QUOTE);
    expect(res.startOffset).toBe(10);
    expect(res.endOffset).toBe(19);
  });

  test("tier 2: a mutated v2 shifts the offsets but quote-repair re-resolves", () => {
    // v2 prepends "Note: the very " so the stored offsets [10,19) now select
    // the wrong text, but the quote still occurs exactly once — at offset 21.
    const V2 = "Note: the very quick brown fox jumps over the lazy dog.\n";
    const res = resolveAnnotation(baseAnn, mount(V2));
    expect(res.tier).toBe(2);
    expect(res.range!.toString()).toBe(QUOTE);
    expect(res.startOffset).toBe(21);
    expect(res.endOffset).toBe(21 + QUOTE.length);
  });

  test("tier 2: re-resolves across inline markup the mutation introduced", () => {
    // The mutation also wraps a word in **bold**; the quote is plain text in
    // both versions, so the textContent search still finds it uniquely even
    // though the DOM around it gained a <strong>. Confirms tier 2 measures
    // textContent, not raw HTML.
    const V2 = "The **very** quick brown fox leaps over the lazy dog.\n";
    const res = resolveAnnotation(baseAnn, mount(V2));
    expect(res.tier).toBe(2);
    expect(res.range!.toString()).toBe(QUOTE);
  });

  test("tier 3 (ambiguous): the quote now occurs twice -> orphan, range null", () => {
    // v2 duplicates the quote, so unique-substring repair can't choose; the
    // annotation orphans rather than anchoring to the wrong occurrence.
    const V2 = "A brown fox here and a brown fox there.\n";
    const res = resolveAnnotation(baseAnn, mount(V2));
    expect(res.tier).toBe(3);
    expect(res.range).toBeNull();
    // The stored offsets are carried through untouched (never silently dropped).
    expect(res.startOffset).toBe(10);
    expect(res.endOffset).toBe(19);
  });

  test("tier 3 (gone): the quote is absent in v2 -> orphan, range null", () => {
    const V2 = "Totally different prose with no animals at all here.\n";
    const res = resolveAnnotation(baseAnn, mount(V2));
    expect(res.tier).toBe(3);
    expect(res.range).toBeNull();
  });

  test("tier 3 (block removed): the annotated block is gone in v2 -> orphan", () => {
    // v2 no longer renders a b0-shaped paragraph carrying the quote in the same
    // slot; here the plan is empty so getBlock("b0") misses entirely.
    const res = resolveAnnotation(baseAnn, mount("\n"));
    expect(res.tier).toBe(3);
    expect(res.range).toBeNull();
  });
});

import "../../test-setup.ts";
import { beforeEach, describe, expect, test } from "bun:test";
import type { Annotation } from "./types.ts";
import { offsetsToRange, rangeToOffsets, resolveAnnotation } from "./anchors.ts";

/** Build a detached block element with id and inner HTML. */
function block(id: string, html: string): HTMLElement {
  const el = document.createElement("div");
  el.id = id;
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("offsetsToRange / rangeToOffsets round-trip", () => {
  test("plain text round-trips", () => {
    const el = block("b0", "Hello world");
    const range = offsetsToRange(el, 0, 5);
    expect(range).not.toBeNull();
    expect(range!.toString()).toBe("Hello");
    expect(rangeToOffsets(el, range!)).toEqual({ start: 0, end: 5 });
  });

  test("selection across nested inline markup round-trips by textContent offset", () => {
    // textContent = "alpha bold code end"
    const el = block("b0", "alpha <strong>bold</strong> <code>code</code> end");
    expect(el.textContent).toBe("alpha bold code end");
    const start = 6; // "bold..."
    const end = 15; // "...code" (textContent index of the space after "code")
    const range = offsetsToRange(el, start, end);
    expect(range!.toString()).toBe("bold code");
    expect(rangeToOffsets(el, range!)).toEqual({ start, end });
  });

  test("offset landing exactly on a node boundary round-trips", () => {
    const el = block("b0", "<em>one</em><em>two</em>");
    // textContent = "onetwo"; select "two"
    const range = offsetsToRange(el, 3, 6);
    expect(range!.toString()).toBe("two");
    expect(rangeToOffsets(el, range!)).toEqual({ start: 3, end: 6 });
  });
});

describe("resolveAnnotation tiers", () => {
  const ann = (over: Partial<Annotation>): Annotation => ({
    id: "a1",
    blockId: "b0",
    startOffset: 0,
    endOffset: 5,
    quote: "Hello",
    comment: "note",
    ...over,
  });

  test("tier 1: exact offsets whose text equals quote", () => {
    const root = block("b0", "Hello world");
    const res = resolveAnnotation(ann({}), (id) => (id === "b0" ? root : null));
    expect(res.tier).toBe(1);
    expect(res.range!.toString()).toBe("Hello");
  });

  test("tier 2: offsets stale but quote uniquely found -> repaired", () => {
    const root = block("b0", "XX Hello world");
    // offsets point at "XX He" which != quote "Hello"; quote appears once
    const res = resolveAnnotation(ann({ startOffset: 0, endOffset: 5 }), () => root);
    expect(res.tier).toBe(2);
    expect(res.range!.toString()).toBe("Hello");
    expect(res.startOffset).toBe(3);
    expect(res.endOffset).toBe(8);
  });

  test("tier 3: quote missing -> orphan", () => {
    const root = block("b0", "nothing matches here");
    const res = resolveAnnotation(
      ann({ quote: "absent text", startOffset: 0, endOffset: 5 }),
      () => root,
    );
    expect(res.tier).toBe(3);
    expect(res.range).toBeNull();
  });

  test("tier 3: quote ambiguous (multiple matches) -> orphan", () => {
    const root = block("b0", "dup and dup again");
    const res = resolveAnnotation(
      ann({ quote: "dup", startOffset: 99, endOffset: 102 }),
      () => root,
    );
    expect(res.tier).toBe(3);
    expect(res.range).toBeNull();
  });

  test("tier 3: missing block element -> orphan", () => {
    const res = resolveAnnotation(ann({}), () => null);
    expect(res.tier).toBe(3);
    expect(res.range).toBeNull();
  });
});

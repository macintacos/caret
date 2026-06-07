import "../../test-setup.ts";
import { beforeEach, describe, expect, test } from "bun:test";
import type { Annotation } from "@core/types";
import {
  contextAround,
  offsetsToRange,
  rangeToOffsets,
  resolveAnnotation,
  wrapTextRange,
} from "./anchors.ts";

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

  test("range ending at the end of a nested element measures that element, not the root", () => {
    const el = block("b0", "alpha <strong>bold</strong> tail");
    // textContent = "alpha bold tail"; the end of <strong> is char offset 10.
    const strong = el.querySelector("strong")!;
    const range = document.createRange();
    range.setStart(el.firstChild!, 0);
    range.setEnd(strong, strong.childNodes.length); // boundary AFTER <strong>'s text
    // Regression: previously this returned the FULL root length (15) instead of 10.
    expect(rangeToOffsets(el, range)).toEqual({ start: 0, end: 10 });
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

  // EXC-543: a recurring quote is disambiguated by the W3C prefix/suffix context
  // instead of orphaning. Old annotations (no context) keep the prior behavior.
  test("tier 2: ambiguous quote disambiguated by prefix context", () => {
    const root = block("b0", "the cat sat and the cat ran");
    // "cat" occurs twice; the stored context points at the second occurrence.
    const res = resolveAnnotation(
      ann({ quote: "cat", prefix: "and the ", suffix: " ran", startOffset: 99, endOffset: 102 }),
      () => root,
    );
    expect(res.tier).toBe(2);
    expect(res.range!.toString()).toBe("cat");
    // second "cat" begins at offset 20 in "the cat sat and the cat ran"
    expect(res.startOffset).toBe(20);
    expect(res.endOffset).toBe(23);
  });

  test("tier 2: prefix alone disambiguates when suffix is empty", () => {
    const root = block("b0", "red dup blue dup");
    const res = resolveAnnotation(
      ann({ quote: "dup", prefix: "red ", suffix: "", startOffset: 99, endOffset: 102 }),
      () => root,
    );
    expect(res.tier).toBe(2);
    expect(res.startOffset).toBe(4); // first "dup", preceded by "red "
    expect(res.endOffset).toBe(7);
  });

  test("tier 3 (back-compat): ambiguous quote with NO context still orphans", () => {
    const root = block("b0", "dup and dup again");
    const res = resolveAnnotation(
      // No prefix/suffix — the old on-disk shape.
      ann({ quote: "dup", startOffset: 99, endOffset: 102 }),
      () => root,
    );
    expect(res.tier).toBe(3);
    expect(res.range).toBeNull();
  });

  test("tier 3: context ties between identical surroundings -> orphan", () => {
    // Both occurrences have the same neighboring chars, so context can't choose.
    const root = block("b0", "x dup y x dup y");
    const res = resolveAnnotation(
      ann({ quote: "dup", prefix: "x ", suffix: " y", startOffset: 99, endOffset: 102 }),
      () => root,
    );
    expect(res.tier).toBe(3);
    expect(res.range).toBeNull();
  });

  test("tier 2 (back-compat): unique quote with context resolves as before", () => {
    const root = block("b0", "XX Hello world");
    const res = resolveAnnotation(
      ann({ quote: "Hello", prefix: "XX ", suffix: " world", startOffset: 0, endOffset: 5 }),
      () => root,
    );
    expect(res.tier).toBe(2);
    expect(res.range!.toString()).toBe("Hello");
    expect(res.startOffset).toBe(3);
  });
});

describe("contextAround", () => {
  test("captures up to 32 chars on each side, clamped at boundaries", () => {
    const text = "alpha beta gamma";
    expect(contextAround(text, 6, 10)).toEqual({ prefix: "alpha ", suffix: " gamma" });
    expect(contextAround(text, 0, 5)).toEqual({ prefix: "", suffix: " beta gamma" });
    expect(contextAround(text, 11, 16)).toEqual({ prefix: "alpha beta ", suffix: "" });
  });

  test("caps each window at 32 chars", () => {
    const text = `${"x".repeat(40)}Q${"y".repeat(40)}`;
    const { prefix, suffix } = contextAround(text, 40, 41);
    expect(prefix).toBe("x".repeat(32));
    expect(suffix).toBe("y".repeat(32));
  });
});

describe("wrapTextRange (cross-node annotation painting)", () => {
  const mk = (id: string) => () => {
    const m = document.createElement("mark");
    m.dataset.annotation = id;
    m.className = "anno";
    return m;
  };

  test("wraps a selection inside a single text node", () => {
    const el = block("b0", "Hello world");
    const marks = wrapTextRange(el, 0, 5, mk("a1"));
    expect(marks.length).toBe(1);
    expect(marks[0]!.tagName).toBe("MARK");
    expect(marks[0]!.textContent).toBe("Hello");
    // text is preserved, only the DOM structure changes
    expect(el.textContent).toBe("Hello world");
  });

  test("wraps a selection spanning multiple element boundaries", () => {
    // mimics shiki token spans: each token in its own <span>
    const el = block("b0", "<span>const</span> <span>x</span> <span>= 1</span>");
    expect(el.textContent).toBe("const x = 1");
    // select "st x =" (offsets 3..9)
    const marks = wrapTextRange(el, 3, 9, mk("a1"));
    expect(marks.length).toBeGreaterThan(1);
    expect(marks.map((m) => m.textContent).join("")).toBe("st x =");
    expect(el.textContent).toBe("const x = 1");
  });

  test("every produced mark carries the annotation id from makeMark", () => {
    const el = block("b0", "<span>aa</span><span>bb</span>");
    const marks = wrapTextRange(el, 1, 3, mk("note-7"));
    expect(marks.length).toBeGreaterThan(1);
    for (const m of marks) expect(m.dataset.annotation).toBe("note-7");
  });

  test("returns an empty array for a collapsed range", () => {
    const el = block("b0", "Hello");
    expect(wrapTextRange(el, 2, 2, mk("a1"))).toEqual([]);
  });
});

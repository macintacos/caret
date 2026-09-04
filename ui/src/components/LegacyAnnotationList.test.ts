import "@ui/support/mount.ts";
import { describe, expect, test } from "bun:test";

import type { LegacyAnnotation } from "@core/lib/types";
import { render } from "@ui/support/mount.ts";
import LegacyAnnotationList from "@/components/LegacyAnnotationList.svelte";

// Per the union compat contract, legacy (selection-anchored) annotations always
// load and show but carry no edit/delete controls and no line anchor.

const legacy: LegacyAnnotation[] = [
  { id: "g1", blockId: "b0", startOffset: 0, endOffset: 5, quote: "Hello", comment: "old note" },
  { id: "g2", blockId: "b1", startOffset: 2, endOffset: 9, quote: "world!!", comment: "second" },
];

describe("LegacyAnnotationList", () => {
  test("renders nothing when there are no legacy annotations", () => {
    const { target } = render(LegacyAnnotationList, { annotations: [] });
    expect(target.querySelector(".legacy-list")).toBeNull();
  });

  test("renders each legacy annotation's quote and comment", () => {
    const { target } = render(LegacyAnnotationList, { annotations: legacy });
    const comments = Array.from(target.querySelectorAll(".comment")).map((c) => c.textContent);
    expect(comments).toEqual(["old note", "second"]);
    const quotes = Array.from(target.querySelectorAll(".quote")).map((q) => q.textContent);
    expect(quotes).toEqual(["Hello", "world!!"]);
  });

  test("exposes no edit or delete controls (read-only)", () => {
    const { target } = render(LegacyAnnotationList, { annotations: legacy });
    expect(target.querySelectorAll("button")).toHaveLength(0);
    expect(target.querySelector("textarea")).toBeNull();
  });
});

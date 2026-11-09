import { describe, expect, test } from "bun:test";

import { changeStarts } from "$lib/diffview/changes.ts";

const lines = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`);
const edited = [...lines];
edited[4] = "changed 5";
edited.splice(9, 0, "added A");
edited.splice(13, 0, "added B");
edited.splice(30, 1);
const before = { name: "p.md", contents: lines.join("\n") };
const after = { name: "p.md", contents: edited.join("\n") };

describe("changeStarts", () => {
  test("stops on each change block, even where one @@ hunk holds several", () => {
    // The first three blocks share one @@ hunk, so hunk starts alone would skip two.
    expect(changeStarts(before, after)).toEqual([
      { line: 5, side: "before" },
      { line: 10, side: "after" },
      { line: 14, side: "after" },
      { line: 29, side: "before" },
    ]);
  });

  test("identical files have no stops", () => {
    expect(changeStarts(before, before)).toEqual([]);
  });
});

import { describe, expect, test } from "bun:test";
import { codeBlockRanges } from "./codeBlocks.ts";

// codeBlockRanges classifies which lines of a rendered plan belong to a fenced
// code block, so the source view can decorate those rows as a panel (EXC-692).
// Ranges are 1-based and inclusive, spanning the opening fence line through the
// closing fence line, matching the simple fence-toggle semantics buildLinkLayer
// (links.ts) already uses so the two layers agree on what "code" is.
describe("codeBlockRanges", () => {
  test("returns no ranges when there is no fence", () => {
    expect(codeBlockRanges("just prose\nmore prose\n")).toEqual([]);
  });

  test("spans one block from its opening fence to its closing fence", () => {
    const text = ["intro", "```ts", "const x = 1;", "```", "outro"].join("\n");
    // opening fence is line 2, closing fence is line 4 (both inclusive).
    expect(codeBlockRanges(text)).toEqual([{ start: 2, end: 4 }]);
  });

  test("returns a separate range per block", () => {
    const text = ["```ts", "a", "```", "prose", "```sh", "b", "```"].join("\n");
    expect(codeBlockRanges(text)).toEqual([
      { start: 1, end: 3 },
      { start: 5, end: 7 },
    ]);
  });

  test("treats tilde fences the same as backtick fences", () => {
    const text = ["~~~python", "x = 1", "~~~"].join("\n");
    expect(codeBlockRanges(text)).toEqual([{ start: 1, end: 3 }]);
  });

  test("runs an unclosed fence to the end of the document", () => {
    const text = ["prose", "```ts", "still code", "and code"].join("\n");
    expect(codeBlockRanges(text)).toEqual([{ start: 2, end: 4 }]);
  });

  test("detects a fence indented up to three spaces", () => {
    const text = ["   ```ts", "code", "   ```"].join("\n");
    expect(codeBlockRanges(text)).toEqual([{ start: 1, end: 3 }]);
  });

  test("toggles on every fence line (matching the link layer)", () => {
    // A ``` inside a longer ```` fence still toggles, mirroring buildLinkLayer's
    // stateless fence detection: each fence line flips the in-code state.
    const text = ["````", "```", "````", "```"].join("\n");
    expect(codeBlockRanges(text)).toEqual([
      { start: 1, end: 2 },
      { start: 3, end: 4 },
    ]);
  });
});

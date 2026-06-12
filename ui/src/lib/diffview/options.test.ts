import { describe, expect, test } from "bun:test";
import { toFileDiffOptions, toFileOptions } from "./options.ts";

// The option mapping always emits a complete library option object from the
// current caret options, so passing its output to setOptions is a faithful
// full replacement (the library swaps options wholesale, never merges).

describe("toFileOptions", () => {
  test("maps the caret single-document options through", () => {
    expect(toFileOptions({ overflow: "wrap", disableLineNumbers: true })).toEqual({
      overflow: "wrap",
      disableLineNumbers: true,
    });
  });

  test("leaves unset options undefined so library defaults apply", () => {
    expect(toFileOptions({})).toEqual({
      overflow: undefined,
      disableLineNumbers: undefined,
    });
  });
});

describe("toFileDiffOptions", () => {
  test("maps the diff options including the layout style", () => {
    expect(toFileDiffOptions({ diffStyle: "split", overflow: "scroll" })).toEqual({
      overflow: "scroll",
      disableLineNumbers: undefined,
      diffStyle: "split",
    });
  });

  test("leaves unset options undefined so library defaults apply", () => {
    expect(toFileDiffOptions({})).toEqual({
      overflow: undefined,
      disableLineNumbers: undefined,
      diffStyle: undefined,
    });
  });
});

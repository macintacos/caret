import { describe, expect, test } from "bun:test";
import { shortCwd } from "./cwd.ts";

describe("shortCwd", () => {
  test("shows a one-segment path in full", () => {
    expect(shortCwd("/tmp")).toBe("/tmp");
  });

  test("shows a two-segment path in full", () => {
    expect(shortCwd("/home/julian")).toBe("/home/julian");
  });

  test("collapses a deeper path to its last two segments", () => {
    expect(shortCwd("/home/julian/code/caret")).toBe("…/code/caret");
  });

  test("ignores leading and trailing slashes when counting segments", () => {
    expect(shortCwd("/a/b/")).toBe("/a/b/");
    expect(shortCwd("/a/b/c/")).toBe("…/b/c");
  });

  test("handles an empty string", () => {
    expect(shortCwd("")).toBe("");
  });
});

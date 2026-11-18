import { describe, expect, test } from "bun:test";

import { sameStop } from "$lib/diffview/commentStops.ts";

describe("sameStop", () => {
  test("matches the same kind and id", () => {
    expect(sameStop({ kind: "comment", id: "a" }, { kind: "comment", id: "a" })).toBe(true);
    expect(sameStop({ kind: "resume", key: "k" }, { kind: "resume", key: "k" })).toBe(true);
  });

  test("differs on a different id", () => {
    expect(sameStop({ kind: "comment", id: "a" }, { kind: "comment", id: "b" })).toBe(false);
  });

  test("a comment never matches a resume marker", () => {
    expect(sameStop({ kind: "comment", id: "a" }, { kind: "resume", key: "a" })).toBe(false);
  });
});

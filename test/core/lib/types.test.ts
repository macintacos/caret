import { expect, test } from "bun:test";

import {
  type Annotation,
  errorMessage,
  isLegacyAnnotation,
  isLineAnnotation,
  type Review,
  toClientReview,
} from "@/lib/types.ts";

const line: Annotation = { id: "l1", startLine: 3, endLine: 5, comment: "tighten" };
const legacy: Annotation = {
  id: "a1",
  blockId: "b0",
  startOffset: 0,
  endOffset: 5,
  quote: "Hello",
  comment: "c",
};

test("isLineAnnotation accepts the line shape and rejects the legacy shape", () => {
  expect(isLineAnnotation(line)).toBe(true);
  expect(isLineAnnotation(legacy)).toBe(false);
});

test("isLegacyAnnotation accepts the legacy shape and rejects the line shape", () => {
  expect(isLegacyAnnotation(legacy)).toBe(true);
  expect(isLegacyAnnotation(line)).toBe(false);
});

test("a legacy annotation without anchor context still routes to the legacy guard", () => {
  // On-disk annotations predating the prefix/suffix context omit both fields.
  const bare: Annotation = {
    id: "a2",
    blockId: "b1",
    startOffset: 2,
    endOffset: 4,
    quote: "ll",
    comment: "",
  };
  expect(isLegacyAnnotation(bare)).toBe(true);
  expect(isLineAnnotation(bare)).toBe(false);
});

test("errorMessage returns an Error's message", () => {
  expect(errorMessage(new Error("boom"))).toBe("boom");
});

test("errorMessage stringifies a non-Error throw", () => {
  expect(errorMessage("plain string")).toBe("plain string");
  expect(errorMessage(42)).toBe("42");
  expect(errorMessage(null)).toBe("null");
  expect(errorMessage(undefined)).toBe("undefined");
  expect(errorMessage({ code: "EACCES" })).toBe("[object Object]");
});

test("errorMessage uses the message of an Error subclass", () => {
  class CustomError extends Error {}
  expect(errorMessage(new CustomError("custom"))).toBe("custom");
});

function reviewWithVersions(versions: Review["versions"]): Review {
  return {
    id: "r1",
    sessionId: "s",
    cwd: "/p",
    title: "P",
    status: "pending",
    planEpoch: 0,
    versions,
    createdAt: 1,
    updatedAt: 1,
  };
}

test("toClientReview serves the current version's composer scratches", () => {
  const scratches = [{ startLine: 3, endLine: 5, text: "tighten this" }];
  const review = reviewWithVersions([
    { version: 1, plan: "# a\n", annotations: [], composerScratches: scratches, createdAt: 1 },
  ]);
  expect(toClientReview(review).composerScratches).toEqual(scratches);
});

test("toClientReview serves only the current version's scratches, not a stale prior version's", () => {
  const review = reviewWithVersions([
    {
      version: 1,
      plan: "# a\n",
      annotations: [],
      composerScratches: [{ startLine: 1, endLine: 1, text: "old" }],
      createdAt: 1,
    },
    { version: 2, plan: "# b\n", annotations: [], createdAt: 2 },
  ]);
  // The current version (v2) carries no scratches; v1's must not leak through.
  expect(toClientReview(review).composerScratches).toEqual([]);
});

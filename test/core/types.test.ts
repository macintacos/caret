import { expect, test } from "bun:test";
import {
  type Annotation,
  errorMessage,
  isLegacyAnnotation,
  isLineAnnotation,
} from "../../src/types.ts";

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

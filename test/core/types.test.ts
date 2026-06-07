import { expect, test } from "bun:test";
import { errorMessage } from "../../src/types.ts";

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

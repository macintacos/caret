import { afterEach, beforeEach, expect, test } from "bun:test";
import { reviewTimeoutMs } from "../src/paths.ts";

let saved: string | undefined;
beforeEach(() => {
  saved = process.env.CARET_TIMEOUT;
  delete process.env.CARET_TIMEOUT;
});
afterEach(() => {
  if (saved === undefined) delete process.env.CARET_TIMEOUT;
  else process.env.CARET_TIMEOUT = saved;
});

test("reviewTimeoutMs defaults to one hour when CARET_TIMEOUT is unset", () => {
  expect(reviewTimeoutMs()).toBe(3_600_000);
});

test("reviewTimeoutMs honors CARET_TIMEOUT (seconds → ms)", () => {
  process.env.CARET_TIMEOUT = "120";
  expect(reviewTimeoutMs()).toBe(120_000);
});

test("reviewTimeoutMs falls back to the default on a non-positive or invalid value", () => {
  for (const bad of ["0", "-5", "nope", ""]) {
    process.env.CARET_TIMEOUT = bad;
    expect(reviewTimeoutMs()).toBe(3_600_000);
  }
});

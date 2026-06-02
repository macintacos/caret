import { afterEach, beforeEach, expect, test } from "bun:test";
import { heartbeatMs, reviewTimeoutMs } from "../src/paths.ts";

let saved: string | undefined;
let savedHb: string | undefined;
beforeEach(() => {
  saved = process.env.CARET_TIMEOUT;
  savedHb = process.env.CARET_HEARTBEAT_MS;
  delete process.env.CARET_TIMEOUT;
  delete process.env.CARET_HEARTBEAT_MS;
});
afterEach(() => {
  if (saved === undefined) delete process.env.CARET_TIMEOUT;
  else process.env.CARET_TIMEOUT = saved;
  if (savedHb === undefined) delete process.env.CARET_HEARTBEAT_MS;
  else process.env.CARET_HEARTBEAT_MS = savedHb;
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

test("heartbeatMs defaults to 8s when CARET_HEARTBEAT_MS is unset", () => {
  expect(heartbeatMs()).toBe(8_000);
});

test("heartbeatMs honors a positive integer CARET_HEARTBEAT_MS", () => {
  process.env.CARET_HEARTBEAT_MS = "250";
  expect(heartbeatMs()).toBe(250);
});

test("heartbeatMs falls back to the default on a non-positive or invalid value", () => {
  for (const bad of ["0", "-1", "1.5", "nope", ""]) {
    process.env.CARET_HEARTBEAT_MS = bad;
    expect(heartbeatMs()).toBe(8_000);
  }
});

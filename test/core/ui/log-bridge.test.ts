import { expect, test } from "bun:test";

import {
  CONTROL_RE,
  MAX_BODY_BYTES,
  MAX_EVENTS,
  MAX_MSG_LEN,
  parseUiLogBatch,
  RESERVED_KEYS,
  STEP_RE,
  sanitizeString,
} from "@/ui/log-bridge.ts";

// The browser-safe trust-boundary parser for POST /api/logs (EXC-445). The
// daemon's route exercises this end-to-end over HTTP in
// test/core/daemon/server.test.ts; these units pin the pure parser and the wire
// constants directly.

test("wire caps match the published contract", () => {
  expect(MAX_BODY_BYTES).toBe(64 * 1024);
  expect(MAX_EVENTS).toBe(100);
  expect(MAX_MSG_LEN).toBe(256);
});

test("RESERVED_KEYS covers the record's own NDJSON fields", () => {
  expect([...RESERVED_KEYS].sort()).toEqual(
    ["caller", "err", "level", "msg", "pid", "step", "time"].sort(),
  );
});

test("STEP_RE accepts lowercase tokens and rejects spaces/uppercase/over-length", () => {
  expect(STEP_RE.test("ui")).toBe(true);
  expect(STEP_RE.test("render-frame")).toBe(true);
  expect(STEP_RE.test("UI")).toBe(false);
  expect(STEP_RE.test("a b")).toBe(false);
  expect(STEP_RE.test("1step")).toBe(false);
  expect(STEP_RE.test("a".repeat(33))).toBe(false);
});

test("sanitizeString strips control chars but keeps TAB and printable text", () => {
  expect(sanitizeString("a\nb\tc")).toBe("ab\tc");
  expect(sanitizeString("plain text")).toBe("plain text");
  // CONTROL_RE is a global regex; sanitizeString must not be tripped up by its
  // lastIndex across calls.
  expect(sanitizeString("x\u0000y")).toBe("xy");
  expect(sanitizeString("x\u0000y")).toBe("xy");
});

test("CONTROL_RE matches a C0 control but not TAB", () => {
  expect("\u0000".match(CONTROL_RE)).not.toBeNull();
  expect("\t".match(CONTROL_RE)).toBeNull();
});

test("a valid batch sanitizes msg, forces source='ui', and truncates", () => {
  const result = parseUiLogBatch({
    events: [
      { level: "info", step: "ui", msg: `keep\nme`, extra: { ms: 5 } },
      { level: "error", step: "render", msg: "z".repeat(300) },
    ],
  });
  expect("events" in result).toBe(true);
  if (!("events" in result)) return;
  expect(result.events[0]).toEqual({
    level: "info",
    step: "ui",
    msg: "keepme",
    extra: { ms: 5, source: "ui" },
  });
  expect(result.events[1]?.msg.length).toBe(MAX_MSG_LEN);
  expect(result.events[1]?.extra?.source).toBe("ui");
});

test("reserved and forged-provenance keys are stripped from extra", () => {
  const result = parseUiLogBatch({
    events: [
      {
        level: "info",
        step: "ui",
        msg: "x",
        extra: { step: "forged", pid: 9, caller: "src/evil.ts:1", source: "hook", keep: "me" },
      },
    ],
  });
  if (!("events" in result)) throw new Error("expected events");
  expect(result.events[0]?.extra).toEqual({ keep: "me", source: "ui" });
});

test("a string value in extra is control-stripped; non-strings pass through", () => {
  const result = parseUiLogBatch({
    events: [{ level: "warn", step: "ui", msg: "m", extra: { note: "a\nb", n: 1 } }],
  });
  if (!("events" in result)) throw new Error("expected events");
  expect(result.events[0]?.extra).toEqual({ note: "ab", n: 1, source: "ui" });
});

test("structurally invalid batches report 400", () => {
  expect(parseUiLogBatch(null)).toEqual({ status: 400 });
  expect(parseUiLogBatch([])).toEqual({ status: 400 });
  expect(parseUiLogBatch({ events: "no" })).toEqual({ status: 400 });
  expect(parseUiLogBatch({ events: [42] })).toEqual({ status: 400 });
  expect(parseUiLogBatch({ events: [{ level: "trace", step: "ui", msg: "x" }] })).toEqual({
    status: 400,
  });
  expect(parseUiLogBatch({ events: [{ level: "info", step: "UI", msg: "x" }] })).toEqual({
    status: 400,
  });
  expect(parseUiLogBatch({ events: [{ level: "info", step: "ui", msg: 1 }] })).toEqual({
    status: 400,
  });
  expect(parseUiLogBatch({ events: [{ level: "info", step: "ui", msg: "x", extra: [] }] })).toEqual(
    {
      status: 400,
    },
  );
});

test("over-MAX_EVENTS batches report 413", () => {
  const many = Array.from({ length: MAX_EVENTS + 1 }, () => ({
    level: "info" as const,
    step: "ui",
    msg: "x",
  }));
  expect(parseUiLogBatch({ events: many })).toEqual({ status: 413 });
});

// A CaretLogger that records every emit for assertions — the daemon-side
// counterpart of the NDJSON-file readers the hook-side tests use.
import { expect } from "bun:test";

import type { CaretLogger, ErrorCode, ErrorContext } from "@/lib/log.ts";

export interface RecordedEmit {
  level: "debug" | "info" | "warn" | "error";
  step: string;
  msg: string;
  code?: ErrorCode;
  extra?: object;
}

export function recordingLog(): { recs: RecordedEmit[]; log: CaretLogger } {
  const recs: RecordedEmit[] = [];
  return { recs, log: recorder(recs) };
}

/** A recorder into `recs`; a child records its bound ids merged under each call's extra. */
function recorder(recs: RecordedEmit[], bound?: ErrorContext): CaretLogger {
  const merged = (extra?: object) => (bound ? { ...bound, ...extra } : extra);
  return {
    debug: (step, msg, extra) => recs.push({ level: "debug", step, msg, extra: merged(extra) }),
    info: (step, msg, extra) => recs.push({ level: "info", step, msg, extra: merged(extra) }),
    warn: (step, msg, extra) => recs.push({ level: "warn", step, msg, extra: merged(extra) }),
    error: (step, code, err, extra) =>
      recs.push({
        level: "error",
        step,
        msg: err instanceof Error ? err.message : String(err),
        code,
        extra: merged(extra),
      }),
    child: (ctx) => recorder(recs, { ...bound, ...ctx }),
  };
}

/**
 * Assert exactly one "request"-step record at debug level, carrying
 * `expectedExtra`. Pinned on the record's durable shape — step, level,
 * structured extra fields — rather than its message prose, which is free to
 * be reworded.
 */
export function expectDebugRequestRecord(
  recs: RecordedEmit[],
  expectedExtra: Record<string, unknown>,
): void {
  const requests = recs.filter((r) => r.step === "request");
  expect(requests).toHaveLength(1);
  expect(requests[0]?.level).toBe("debug");
  expect(requests[0]?.extra).toMatchObject(expectedExtra);
}

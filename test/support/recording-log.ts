// A CaretLogger that records every emit for assertions — the daemon-side
// counterpart of the NDJSON-file readers the hook-side tests use. It lives in
// test/support/ (not a *.test.ts file) so bun test never collects it as a suite.
import type { CaretLogger } from "../../src/lib/log.ts";

export interface RecordedEmit {
  level: "debug" | "info" | "warn" | "error";
  step: string;
  msg: string;
  extra?: object;
}

export function recordingLog(): { recs: RecordedEmit[]; log: CaretLogger } {
  const recs: RecordedEmit[] = [];
  const log: CaretLogger = {
    debug: (step, msg, extra) => recs.push({ level: "debug", step, msg, extra }),
    info: (step, msg, extra) => recs.push({ level: "info", step, msg, extra }),
    warn: (step, msg, extra) => recs.push({ level: "warn", step, msg, extra }),
    error: (step, err, extra) =>
      recs.push({
        level: "error",
        step,
        msg: err instanceof Error ? err.message : String(err),
        extra,
      }),
  };
  return { recs, log };
}

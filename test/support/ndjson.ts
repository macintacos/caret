// Parse NDJSON log text (a logs/caret.log or logs/daemon.log body, the e2e
// daemon's stderr, or a captured recording) into the records the assertions
// read.
import { readFileSync } from "node:fs";

import { logFile } from "@/config/paths.ts";

/**
 * Split NDJSON `text` into parsed records, one per JSON line.
 *
 * Non-JSON lines are skipped — blank lines, and any raw crash output in a
 * source that carries both (the e2e daemon's stderr, or a log migrated from an
 * install that predates the daemon-stderr split).
 */
export function ndjsonRecords(text: string): Array<Record<string, unknown>> {
  return text
    .split("\n")
    .filter((l) => l.startsWith("{"))
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

/** Parse the current test's caret.log into NDJSON records ([] when the file
 * doesn't exist yet). Pairs with `setupTempStateDir` for per-test isolation. */
export function caretLogRecords(): Array<Record<string, unknown>> {
  try {
    return ndjsonRecords(readFileSync(logFile(), "utf-8"));
  } catch {
    return [];
  }
}

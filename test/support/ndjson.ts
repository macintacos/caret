// Parse NDJSON log text (a logs/caret.log or logs/daemon.log body, the e2e
// daemon's stderr, or a captured recording) into the records the assertions
// read.

/**
 * Split NDJSON `text` into parsed records, one per JSON line.
 *
 * Non-JSON lines are skipped — blank lines, and any raw crash output in a
 * source that carries both (the e2e daemon's stderr, or a log migrated from an
 * install that predates the daemon-stderr split). Only lines starting with `{`
 * are parsed, so a malformed tail never derails the parse.
 */
export function ndjsonRecords(text: string): Array<Record<string, unknown>> {
  return text
    .split("\n")
    .filter((l) => l.startsWith("{"))
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

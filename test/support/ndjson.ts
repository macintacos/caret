// Parse NDJSON log text (a daemon's stderr, a caret.log body, or a captured
// recording) into the records the assertions read.

/**
 * Split NDJSON `text` into parsed records, one per JSON line.
 *
 * Non-JSON lines (blank lines, and the raw non-JSON crash output that can
 * interleave with daemon.log) are skipped: only lines starting with `{` are
 * parsed, so a malformed tail never derails the parse.
 */
export function ndjsonRecords(text: string): Array<Record<string, unknown>> {
  return text
    .split("\n")
    .filter((l) => l.startsWith("{"))
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

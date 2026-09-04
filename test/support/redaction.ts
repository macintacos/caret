// A reusable "never-log-body" matcher for the redaction suites.
import { expect } from "bun:test";

/** Serialize `haystack` to a string for substring assertions. */
function asText(haystack: unknown): string {
  return typeof haystack === "string" ? haystack : JSON.stringify(haystack);
}

/**
 * Assert none of `secrets` appears anywhere in `haystack`.
 *
 * Plan/prompt/feedback/draft bodies and identifying paths are structurally
 * censored before they reach a log (src/redact/node.ts), so one surfacing in a
 * captured log, discovery report, or daemon wire payload is a redaction leak.
 */
export function expectNeverLogsBody(haystack: unknown, secrets: string | string[]): void {
  const text = asText(haystack);
  for (const secret of typeof secrets === "string" ? [secrets] : secrets) {
    expect(text).not.toContain(secret);
  }
}

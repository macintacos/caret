// A reusable "never-log-body" matcher: assert that sensitive content (plan,
// prompt, feedback, draft bodies, home paths) never reaches a captured log,
// report, or wire payload.
import { expect } from "bun:test";

/** Serialize `haystack` to a string for substring assertions (already a string
 * passes through; anything else is JSON-stringified). */
function asText(haystack: unknown): string {
  return typeof haystack === "string" ? haystack : JSON.stringify(haystack);
}

/**
 * Assert none of `secrets` appears anywhere in `haystack`.
 *
 * Plan/prompt/feedback/draft bodies and identifying paths are structurally
 * censored before they reach a log (src/redact.ts), so a body string surfacing
 * in a captured log, discovery report, or daemon wire payload is a redaction
 * leak. This folds the scattered `expect(...).not.toContain(secret)` checks into
 * one named assertion.
 */
export function expectNeverLogsBody(haystack: unknown, secrets: string | string[]): void {
  const text = asText(haystack);
  for (const secret of typeof secrets === "string" ? [secrets] : secrets) {
    expect(text).not.toContain(secret);
  }
}

// Stub SpawnRunners for the review-bridge callers' suites: the OpenCode plugin and caret mcp.

import type { SpawnRunner } from "@opencode/review-bridge.ts";

/** A SpawnRunner that resolves `stdout` at once, handing each call's arguments to
 * `capture`. */
export function stubRunner(
  stdout: string,
  capture?: (...args: Parameters<SpawnRunner>) => void,
): SpawnRunner {
  return async (...args) => {
    capture?.(...args);
    return { stdout, exitCode: 0 };
  };
}

/** A SpawnRunner that streams the given stderr chunks (as the real child does) before
 * resolving with the decision on stdout — exercises the review-link surfacing. */
export function streamingRunner(stdout: string, stderrChunks: string[]): SpawnRunner {
  return async (_command, _env, _stdin, onStderr) => {
    for (const chunk of stderrChunks) onStderr?.(chunk);
    return { stdout, exitCode: 0 };
  };
}

// The wire pieces the agent adapters share, on both sides of the hook. Each
// adapter's own decision payload stays its own — the envelope takes it as a
// parameter — so the Claude and Codex adapters can render the one contract they
// both implement (Codex's PermissionRequest hook is documented as ~1:1 with
// Claude's) without either learning the other's fields.
//
// Runtime-dependency-free by design (literals and JSON.stringify only), because
// permissionRequestDenyLine is what the CLI's fatal handler falls back to when an
// adapter fails to load: nothing reachable from here can take that deny down.

/** Parse a tool's raw hook stdin. Throws on input that can't be parsed — the
 * caller turns that into a fail-safe deny. */
export function parseHookStdin<T>(stdin: string): T {
  try {
    return JSON.parse(stdin) as T;
  } catch {
    throw new Error("could not parse hook stdin JSON");
  }
}

/** The agent-facing text for a request-changes decision: the reviewer's trimmed
 * feedback, or a neutral default when they typed none. */
export function denyMessage(feedback: string | undefined): string {
  return feedback?.trim() || "Plan changes requested.";
}

/** The PermissionRequest hook-output envelope, parameterized by the adapter's own
 * decision shape. */
export interface PermissionRequestOutput<D> {
  hookSpecificOutput: {
    hookEventName: "PermissionRequest";
    decision: D;
  };
}

/** Wrap an adapter's rendered decision in the PermissionRequest envelope. */
export function permissionRequest<D>(decision: D): PermissionRequestOutput<D> {
  return { hookSpecificOutput: { hookEventName: "PermissionRequest", decision } };
}

/** Last-resort PermissionRequest deny wire line for the CLI's fatal handler. */
export function permissionRequestDenyLine(reason: string): string {
  return JSON.stringify(permissionRequest({ behavior: "deny", message: reason }));
}

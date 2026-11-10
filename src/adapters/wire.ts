// The wire pieces the agent adapters share, on both sides of the hook. Each
// adapter's own vocabulary stays its own and is passed in as a parameter. Two wires
// live here: the PermissionRequest pieces the Claude and Codex adapters both
// implement (Codex's hook is documented as ~1:1 with Claude's), and the caret-owned
// envelope and flat allow/deny that OpenCode's plugin, pi's extension, and
// `caret mcp` (claude-mcp) share, where caret builds both ends.
//
// Imports nothing, because the CLI's fatal handler falls back to
// permissionRequestDenyLine when no adapter can be selected. The deny lines
// (permissionRequestDenyLine, flatDenyLine) are literals and JSON.stringify only, as
// AgentAdapter.fatalDenyLine requires.

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

/** The caret-owned review envelope a plugin-shaped host pipes to `caret review`.
 * Mirrors the snake_case session/cwd convention the Claude/Codex parsers use. Every
 * field is optional — a payload missing any of them still parses to a PlanInput, and
 * the downstream guards handle the gaps. planFilePath is set only when the agent
 * submitted a plan file rather than inline text; caret then rewrites that file with
 * the canonical plan. */
interface CaretEnvelope {
  session_id?: string;
  cwd?: string;
  tool_input?: { plan?: string; planFilePath?: string };
  /** Ids of optional approve variants the host can honor. */
  approve_variants?: unknown;
}

/** The PlanInput fields a caret envelope carries (structurally a PlanInput). */
export interface EnvelopePlanInput<V> {
  sessionId?: string;
  cwd?: string;
  plan?: string;
  planFilePath?: string;
  approveVariants?: V;
}

/** Parse a caret envelope. `declaredVariants` maps its `approve_variants` onto the
 * adapter's own vocabulary; without one the field is dropped and `caret review`
 * stamps the adapter's defaults. Throws on unparseable stdin, like parseHookStdin. */
export function parseCaretEnvelope<V = never>(
  stdin: string,
  declaredVariants?: (ids: unknown) => V | undefined,
): EnvelopePlanInput<V> {
  const envelope = parseHookStdin<CaretEnvelope>(stdin);
  return {
    sessionId: envelope.session_id,
    cwd: envelope.cwd,
    plan: envelope.tool_input?.plan,
    planFilePath: envelope.tool_input?.planFilePath,
    approveVariants: declaredVariants?.(envelope.approve_variants),
  };
}

/** The flat decision a caret-owned wire carries back to the host. `failsafe` rides
 * only a deny caret made itself because the review could not run or decide. */
export interface FlatDecision {
  behavior: "allow" | "deny";
  feedback?: string;
  acceptMode?: string;
  failsafe?: true;
}

/** Render a core decision as the flat wire decision. Only an explicit allow allows:
 * reviewer notes ride it, and `acceptModes` lists the approve-variant ids this host
 * acts on — any other is dropped, so a plain approve stays a bare allow. Anything else
 * is a deny carrying `denyMessage(feedback)`, plus `failsafe` when caret's own
 * fail-safe made it. */
export function flatDecision(
  decision: FlatDecision,
  acceptModes: readonly string[] = [],
): FlatDecision {
  if (decision.behavior === "allow") {
    const notes = decision.feedback?.trim();
    const mode =
      decision.acceptMode && acceptModes.includes(decision.acceptMode)
        ? decision.acceptMode
        : undefined;
    return {
      behavior: "allow",
      ...(notes && { feedback: notes }),
      ...(mode && { acceptMode: mode }),
    };
  }
  return {
    behavior: "deny",
    feedback: denyMessage(decision.feedback),
    ...(decision.failsafe && { failsafe: true }),
  };
}

/** Last-resort flat deny line for the CLI's fatal handler. */
export function flatDenyLine(reason: string): string {
  return JSON.stringify({ behavior: "deny", feedback: reason, failsafe: true });
}

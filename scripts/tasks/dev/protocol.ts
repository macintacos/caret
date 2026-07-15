// Pure protocol state machine for the dev driver: the side-effect-free
// functions that play the agent's side of the caret protocol — shape the hook
// stdin, thread a "Revision N" section onto a plan, retitle an extra plan, and
// decide the next submission from a decision. No daemon, no FS, no LLM, so each
// is a plain unit test. The long-running supervision loops that drive these
// live in scripts/tasks/dev/driver.ts.

import { PLAN_REJECTED_MESSAGE } from "../../../src/config/constants.ts";
import type { Decision } from "../../../src/lib/types.ts";

/** Session id for the single dev review; stable for the process lifetime so a
 * revision threads into the same review instead of forking a new one, but
 * unique per driver instance (pid suffix) so two dev sessions deliberately
 * sharing one daemon don't collide on session identity (EXC-461). */
export const DEV_SESSION = `caret-dev-${process.pid}`;

/** The hook stdin a real PermissionRequest session would pipe to `caret
 * review` — the fixed dev session by default, or an explicit session id for
 * the extra-review seeder. */
export function hookStdin(plan: string, sessionId = DEV_SESSION): string {
  return JSON.stringify({ session_id: sessionId, cwd: process.cwd(), tool_input: { plan } });
}

/** Append a "Revision N" section quoting the reviewer's feedback. The feedback
 * is fenced as `text` with a fence longer than any backtick run it contains, so
 * hostile feedback (untagged fences, indented code) can neither break out nor
 * introduce an untagged block — the plan-format gate would insta-reject the
 * revision (src/plan/format.ts). */
export function appendRevision(plan: string, feedback: string, n: number): string {
  const runs = feedback.match(/`+/g) ?? [];
  const fence = "`".repeat(Math.max(3, ...runs.map((r) => r.length + 1)));
  return [
    plan.trimEnd(),
    "",
    `## Revision ${n}`,
    "",
    "Addressing the reviewer's feedback:",
    "",
    `${fence}text`,
    feedback,
    fence,
    "",
    "Adjusted the approach accordingly; resubmitting for another look.",
    "",
  ].join("\n");
}

/** Default number of versions the primary dev review opens with — v1 plus two
 * synthetic revisions, enough for the version-compare picker to offer a
 * non-default pair. Overridable via `mise run dev --num-versions <n>`. */
export const DEFAULT_NUM_VERSIONS = 3;

/** Resolve the `--num-versions <n>` dev flag from argv: how many versions the
 * primary dev review should open with. Absent → DEFAULT_NUM_VERSIONS; a value
 * that isn't a positive integer throws, so a typo fails loudly at boot instead
 * of silently seeding the wrong shape. */
/** Validate a raw flag value as a positive integer (≥ 1), or throw with a
 * message naming the flag. Shared by parseNumVersions (driver argv) and the
 * tasks CLI's --num-versions commander coercion, so "positive integer" is
 * defined once. */
export function parsePositiveInt(raw: string | undefined, flag: string): number {
  if (raw === undefined || !/^\d+$/.test(raw) || Number(raw) < 1) {
    throw new Error(
      `${flag} expects a positive integer (got ${raw === undefined ? "no value" : `"${raw}"`})`,
    );
  }
  return Number(raw);
}

export function parseNumVersions(argv: string[]): number {
  const i = argv.indexOf("--num-versions");
  if (i === -1) return DEFAULT_NUM_VERSIONS;
  return parsePositiveInt(argv[i + 1], "--num-versions");
}

/** The sequence of plans the dev bootstrap submits to grow the primary review to
 * several versions before the interactive loop, so `mise run dev` always shows a
 * multi-version review (the version-compare picker needs one). The first entry is
 * v1; each subsequent entry threads one more synthetic revision onto the prior,
 * mirroring what a reviewer deny + resubmit would produce. With `revisions` of n
 * the result has n+1 entries (versions v1..v(n+1)). The synthetic feedback is
 * fenced exactly as appendRevision fences real feedback, so the plan-format gate
 * accepts each step. */
export function bootstrapPlans(v1: string, revisions: number): string[] {
  const plans = [v1];
  for (let n = 1; n <= revisions; n++) {
    plans.push(
      appendRevision(plans[n - 1] as string, `Bootstrap revision ${n} for the dev review.`, n),
    );
  }
  return plans;
}

/** Driver-side submission state: the plan to (re)submit and how many revision
 * sections it carries. */
export interface DriverState {
  plan: string;
  revision: number;
}

/** Pure step: from the hook's decision, compute the next submission. Approve
 * re-seeds a fresh v1 (the daemon ended the thread; reset the counter). A
 * Reject (deny carrying PLAN_REJECTED_MESSAGE, EXC-685) waits — the agent does
 * NOT re-present, simulating a wait for the user's next message. A deny whose
 * feedback starts with "caret: " is one of the hook's own fail-safe / format
 * denies, not reviewer feedback — resubmit unchanged rather than append a bogus
 * revision. Any other deny is request-changes feedback: append a Revision N
 * section. */
export function nextPlan(
  state: DriverState,
  decision: Decision,
  freshPlan: string,
): DriverState & { action: "reseed" | "revise" | "resubmit" | "wait" } {
  if (decision.behavior === "allow") return { plan: freshPlan, revision: 0, action: "reseed" };
  const feedback = decision.feedback ?? "";
  // Match on the shared constant, not a substring, so a message reword can't
  // silently turn Reject back into a request-changes revision (they share the
  // same deny wire shape — only the message distinguishes them).
  if (feedback === PLAN_REJECTED_MESSAGE) return { ...state, action: "wait" };
  if (feedback.startsWith("caret: ")) return { ...state, action: "resubmit" };
  const revision = state.revision + 1;
  return { plan: appendRevision(state.plan, feedback, revision), revision, action: "revise" };
}

/** Retitle the fake plan's h1 so an extra review is distinguishable from the
 * primary one in the switcher and in the notification body (review titles
 * derive from the plan's first heading, src/review/threading.ts). */
export function extraPlan(plan: string, n: number): string {
  return plan.replace(/^# .*$/m, (title) => `${title} — extra ${n}`);
}

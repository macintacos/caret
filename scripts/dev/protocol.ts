// Pure protocol state machine for the dev driver: the side-effect-free
// functions that play the agent's side of the caret protocol — shape the hook
// stdin, thread a "Revision N" section onto a plan, retitle an extra plan, and
// decide the next submission from a decision. No daemon, no FS, no LLM, so each
// is a plain unit test. The long-running supervision loops that drive these
// live in scripts/dev/driver.ts.

import type { Decision } from "../../src/types.ts";

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
 * revision (src/plan-format.ts). */
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

/** Driver-side submission state: the plan to (re)submit and how many revision
 * sections it carries. */
export interface DriverState {
  plan: string;
  revision: number;
}

/** Pure step: from the hook's decision, compute the next submission. Approve
 * re-seeds a fresh v1 (the daemon ended the thread; reset the counter). A deny
 * whose feedback starts with "caret: " is one of the hook's own fail-safe /
 * format denies, not reviewer feedback — resubmit unchanged rather than append
 * a bogus revision. Any other deny is reviewer feedback: append a Revision N
 * section. */
export function nextPlan(
  state: DriverState,
  decision: Decision,
  freshPlan: string,
): DriverState & { action: "reseed" | "revise" | "resubmit" } {
  if (decision.behavior === "allow") return { plan: freshPlan, revision: 0, action: "reseed" };
  const feedback = decision.feedback ?? "";
  if (feedback.startsWith("caret: ")) return { ...state, action: "resubmit" };
  const revision = state.revision + 1;
  return { plan: appendRevision(state.plan, feedback, revision), revision, action: "revise" };
}

/** Retitle the fake plan's h1 so an extra review is distinguishable from the
 * primary one in the switcher and in the notification body (review titles
 * derive from the plan's first heading, src/reviews.ts). */
export function extraPlan(plan: string, n: number): string {
  return plan.replace(/^# .*$/m, (title) => `${title} — extra ${n}`);
}

/** Default extra-review cadence; on unless explicitly disabled. */
const SEEDER_DEFAULT_MS = 15_000;

/** Resolve CARET_DEV_NEW_REVIEW_MS into a seeder interval. Unset → the
 * default (the seeder is on out of the box); a positive integer → that
 * cadence; 0 or negative → explicitly off (ms: null); anything else →
 * default with `invalid` flagged so the caller warns (settings house style:
 * set-but-invalid falls through, never silently disables). */
export function seederInterval(raw: string | undefined): { ms: number | null; invalid: boolean } {
  if (raw === undefined) return { ms: SEEDER_DEFAULT_MS, invalid: false };
  const n = Number(raw);
  if (raw === "" || !Number.isInteger(n)) return { ms: SEEDER_DEFAULT_MS, invalid: true };
  if (n <= 0) return { ms: null, invalid: false };
  return { ms: n, invalid: false };
}

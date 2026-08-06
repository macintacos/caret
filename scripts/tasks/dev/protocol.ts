// Pure protocol state machine for the dev driver: the side-effect-free
// functions that play the agent's side of the caret protocol — shape the hook
// stdin, thread a "Revision N" section onto a plan, retitle an extra plan, and
// decide the next submission from a decision. No daemon, no FS, no LLM, so each
// is a plain unit test. The long-running supervision loops that drive these
// live in scripts/tasks/dev/driver.ts.

import { PLAN_REJECTED_MESSAGE } from "@/config/constants.ts";
import type { Decision, LineAnnotation } from "@/lib/types.ts";

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

/** Default number of versions the primary dev review opens with — the final plan
 * plus three earlier drafts, one per kind of diff `demoVersions` produces (a
 * single targeted change, a few mid-sentence rewrites, and many scattered
 * changes), so the version-compare picker has all three flavors to show at a
 * glance. Overridable via `mise run dev --num-versions <n>`. */
export const DEFAULT_NUM_VERSIONS = 4;

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

/** A single reverse edit: an exact span of the FINAL plan (`from`) and the earlier
 * DRAFT wording (`to`) that replaces it when walking back to a prior version. */
interface DemoEdit {
  from: string;
  to: string;
}

/** The demo review's version history, expressed as reverse edits from the final
 * plan (fake-plan.md). Ordered NEWEST-first: applying group 0 to the final yields
 * the second-newest version, group 1 that yields the next, and so on. Each group
 * is a distinct KIND of change so the compare view has variety to render (EXC-811)
 * instead of the old append-only diffs — and because the groups run newest-first,
 * the default compare pair (current vs. previous) is the smallest, cleanest diff
 * while older pairs get progressively larger:
 *   0. a single targeted change (one table cell),
 *   1. a few mid-sentence rewrites,
 *   2. many scattered word changes across the file,
 *   3. a further scattered pass (only reached at higher --num-versions).
 * Every `from` must exist verbatim in fake-plan.md; the dev-driver unit suite
 * asserts this, so a future edit to the fixture that strands one fails loudly
 * rather than silently flattening a diff back to empty. */
const DEMO_EDITS: readonly (readonly DemoEdit[])[] = [
  [{ from: "92%", to: "88%" }],
  [
    { from: "show up at a glance", to: "are obvious at a glance" },
    { from: "often rendered close to body size", to: "usually rendered near body size" },
    { from: "there is nothing to approve here", to: "there is nothing here to approve" },
  ],
  [
    { from: "strict allowlist", to: "tight allowlist" },
    { from: "comfortable vertical rhythm", to: "even vertical rhythm" },
    { from: "awkward characters", to: "tricky characters" },
    { from: "the deepest rung", to: "the final rung" },
    { from: "stripped by DOMPurify", to: "removed by DOMPurify" },
  ],
  [
    { from: "A deliberately **wide** table", to: "A very **wide** table" },
    { from: "run well past the panel's width", to: "run far past the panel's width" },
    { from: "A paragraph that is simply long", to: "A paragraph that is merely long" },
  ],
];

/** The DEMO_EDITS groups exposed for the unit suite's fixture-drift guard. */
export const DEMO_EDIT_GROUPS = DEMO_EDITS;

/** Rewrite each `from` span to its `to` draft wording. Plain global replacement;
 * every `from` is a prose span (never inside a code fence), so the drafts stay
 * valid plans the format gate accepts. */
function applyDemoEdits(plan: string, edits: readonly DemoEdit[]): string {
  return edits.reduce((acc, { from, to }) => acc.split(from).join(to), plan);
}

/** The sequence of plans the dev bootstrap submits to grow the primary review to
 * several versions before the interactive loop, so `mise run dev` always shows a
 * multi-version review (the version-compare picker needs one). The LAST entry is
 * `final` verbatim — the polished "current" plan the reviewer lands on — and each
 * earlier entry is a DRAFT produced by applying DEMO_EDITS outward from it, so
 * consecutive versions diff in varied ways instead of only appending (EXC-811).
 * With `count` of n the result has n entries (versions v1..vn), oldest first. */
export function demoVersions(final: string, count: number): string[] {
  const versions = [final];
  for (let i = 0; i < count - 1; i++) {
    const edits = DEMO_EDITS[i];
    // Past the authored groups (an unusually large --num-versions), repeat the
    // oldest draft rather than inventing edits — the extra pair just shows no diff.
    const older = edits ? applyDemoEdits(versions[0] as string, edits) : (versions[0] as string);
    versions.unshift(older);
  }
  return versions;
}

/** The demo comments, each pinned to the span of the plan it actually talks
 * about. Positional anchors (a fixed fraction of the way down the file) put the
 * comment on whatever text happened to sit there — a code-fence line, a
 * mid-sentence wrap — so the panel read as nonsense against its own line, and
 * the compare view had nothing meaningful to reveal.
 *
 * Every `anchor` is a span the 90-col ingest reflow cannot split (a table row, a
 * list item's opening) and that no DEMO_EDITS group rewrites, so it resolves the
 * same way in every version; the dev-driver unit suite pins each to exactly one
 * fixture line and the bootstrap suite re-checks them against the STORED text.
 * Bodies stay distinct so the panel's grouping and search filter have real text
 * to work with rather than three copies of one line. */
export const DEMO_COMMENTS = [
  {
    anchor: "| carousel-refund",
    body: "this row's drift is the outlier in the table — say whether it's in scope or noise.",
  },
  {
    anchor: "| Code highlight",
    body: "give this coverage number a denominator; as written there's nothing to check it against.",
  },
  {
    anchor: "`src/does-not-exist.ts`",
    body: "spell out what a reviewer should see if this negative case ever regresses.",
  },
] as const;

/** Fake line-anchored comments for one bootstrapped dev version, one per
 * DEMO_COMMENTS entry whose anchor the plan carries — a plan that carries none
 * (anything but the fixture) gets no comments rather than arbitrary ones. Ids are
 * deterministic and dense (`dev-v{version}-c{n}`) so the unit suite can name one,
 * and bodies name their version so the compare view's version badge is visibly
 * exercised. Callers pass the STORED plan text — the daemon reflows every plan at
 * ingest, so anchors resolved against a submitted plan do not index what is served. */
export function demoAnnotations(plan: string, version: number): LineAnnotation[] {
  const lines = plan.split("\n");
  return DEMO_COMMENTS.flatMap(({ anchor, body }) => {
    const i = lines.findIndex((line) => line.includes(anchor));
    return i === -1 ? [] : [{ line: i + 1, body }];
  }).map(({ line, body }, i) => ({
    id: `dev-v${version}-c${i + 1}`,
    startLine: line,
    endLine: line,
    comment: `v${version}: ${body}`,
  }));
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

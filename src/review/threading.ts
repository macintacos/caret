// Revision threading state machine.
//
// session_id alone is insufficient: a distinct later plan in the same session
// would fold into the wrong thread. Rule: a new ExitPlanMode for a session
// APPENDS a version to its latest review ONLY IF that review is currently
// `rejected` (changes requested, awaiting revision); otherwise it starts a NEW
// thread. An approved review never returns to `rejected`, so the plan after an
// approval starts a new thread.

import { randomBytes } from "node:crypto";

import { Lexer, type Tokens } from "marked";

import { type CaretLogger, noopLogger, shortId } from "@/lib/log.ts";
import type { PlanInput, Review, RouteResult } from "@/lib/types.ts";
import { writeCanonicalPlanFile } from "@/plan/canonical-file.ts";
import { formatPlanMarkdown } from "@/plan/markdown.ts";
import type { Store } from "@/review/store.ts";

/** A fresh, opaque review id. Short and URL-safe (base64url of 8 random bytes,
 * ~11 chars, 64 bits) so the `?review=<id>` URL stays within OpenCode's ~54-col
 * toast width and word-wraps whole onto one terminal-clickable line (EXC-691).
 * Reviews are ephemeral and few-at-a-time, so 64 bits is ample against collision;
 * the id is an opaque handle (store key + URL param), never format-validated. */
export function newReviewId(): string {
  return randomBytes(8).toString("base64url");
}

/** Derive a human title from the plan: its first `#` heading, else its first `##`
 * heading, else the first line of its first paragraph. Only top-level tokens count,
 * so a `#` line inside a fenced block is never a candidate. */
export function deriveTitle(plan: string): string {
  // Block pass only: the inline pass is quadratic on emphasis runs and a title needs
  // only block text. blockTokens skips lex()'s CR normalisation, hence the replace.
  const tokens = new Lexer({ gfm: true }).blockTokens(plan.replace(/\r\n?/g, "\n"));
  const heading = (depth: number) =>
    tokens.find(
      (t): t is Tokens.Heading => t.type === "heading" && t.depth === depth && t.text.trim() !== "",
    )?.text;
  const prose = tokens
    .find((t): t is Tokens.Paragraph => t.type === "paragraph")
    ?.text.split("\n")[0];
  return (heading(1) ?? heading(2) ?? prose)?.trim().slice(0, 120) || "Untitled plan";
}

export async function routeIncomingPlan(
  input: PlanInput,
  store: Store,
  log: CaretLogger = noopLogger,
): Promise<RouteResult> {
  const sessionId = input.sessionId ?? `anon-${Date.now()}`;
  // Canonicalize once, at ingest: both version-creation sites below store this
  // value, and versions already on the review are never reformatted.
  const plan = await formatPlanMarkdown(input.plan ?? "", log);
  // Mirror the canonical text back onto the on-disk plan file the agent reads from,
  // so its plan of record matches what the human reviews. Runs for every incoming
  // version (new thread or revision); best-effort, and skipped when the agent
  // rewrote the file after caret read it.
  const planFile = input.planFilePath
    ? { planFileCurrent: writeCanonicalPlanFile(input, plan, log) }
    : {};
  const now = Date.now();

  // A pending review here is an orphan: a session has at most one outstanding
  // plan hook, so a new plan means the prior hook gave up (timeout) or died
  // without resolution (EXC-454). Expire every stale pending — not just the
  // newest, since a pre-fix orphan can hide behind a rejected latest — before
  // threading. Terminal on disk so it never rehydrates as approvable.
  const expired: string[] = [];
  for (const stale of store.bySession(sessionId).filter((r) => r.status === "pending")) {
    await store.expire(stale.id);
    expired.push(stale.id);
    log.info("review", `review superseded: ${shortId(stale.id)}`, {
      reviewId: stale.id,
      sessionId,
      action: "supersede",
    });
  }

  const latest = store.bySession(sessionId)[0];

  // Append only to a review currently awaiting revision.
  if (latest && latest.status === "rejected") {
    const version = latest.versions.length + 1;
    await store.update(latest.id, (r) => {
      r.versions.push({ version, plan, annotations: [], createdAt: now });
      r.title = deriveTitle(plan);
      r.status = "pending";
      // Re-point at the pane that actually submitted this revision; a submission
      // carrying none leaves the original in place (EXC-961).
      r.cmux = input.cmux ?? r.cmux;
      // Re-pended and awaiting a fresh decision: drop the prior rejection so the
      // daemon's /decision handler waits for the next decision instead of
      // re-serving the stale deny.
      r.decision = undefined;
    });
    // The threading decision is logged here — not in the daemon handler — so
    // append vs new is distinguishable and the resolved sessionId rides along.
    log.info("review", `review appended: ${shortId(latest.id)} v${version}`, {
      reviewId: latest.id,
      sessionId,
      action: "append",
      version,
    });
    return {
      id: latest.id,
      action: "append",
      version,
      expired,
      ...planFile,
    };
  }

  const id = newReviewId();
  const review: Review = {
    id,
    sessionId,
    cwd: input.cwd ?? "",
    title: deriveTitle(plan),
    status: "pending",
    cmux: input.cmux,
    versions: [{ version: 1, plan, annotations: [], createdAt: now }],
    createdAt: now,
    updatedAt: now,
  };
  await store.create(review);
  log.info("review", `review created: ${shortId(id)}`, {
    reviewId: id,
    sessionId,
    action: "new",
    version: 1,
  });
  return { id, action: "new", version: 1, expired, ...planFile };
}

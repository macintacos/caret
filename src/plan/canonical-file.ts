// Canonicalize the on-disk plan file the agent reads from. Claude Code writes
// each plan to `~/.claude/plans/<name>.md` and reads it back via
// normalizeToolInput, so that file — not caret's review store — is the plan of
// record the agent references. caret reformats the plan for human review; this
// rewrites the same file with the canonical text so what the agent references is
// byte-identical to what the human reviews, and a reviewer's "Line N" comment
// points at the same line on both sides.
//
// Best-effort and never fatal: a plan must survive even when the file can't be
// rewritten (read-only fs, a races, an older agent that sends no path), so every
// failure is swallowed with a logged code. The path comes from the hook (the
// agent's own planFilePath); it is still guarded to an existing regular `.md`
// file so a malformed path can never make caret clobber something else, and the
// error log never carries the path or plan text.
import { appendFileSync, existsSync, statSync, writeFileSync } from "node:fs";

import type { CaretLogger } from "@/lib/log.ts";
import { reviewerNotesSection } from "@/plan/reviewer-notes.ts";

/**
 * The shared, security-relevant guard for writing the agent's plan file: only an
 * existing regular `.md` file is touched (a malformed path can never make caret
 * clobber something else), and every failure is swallowed with a logged `.code`
 * (never the path or plan text). `write` performs the fs op inside the guard.
 * The path is the agent's own planFilePath — it runs as this user and already
 * wrote the file, so following a symlink grants no access it lacks; the guard is
 * about not clobbering a non-plan path, not a privilege boundary. Never throws.
 */
function guardedPlanFileWrite(
  planFilePath: string,
  log: Pick<CaretLogger, "warn">,
  failMsg: string,
  write: (path: string) => void,
): void {
  try {
    if (!planFilePath.endsWith(".md")) return;
    if (!existsSync(planFilePath) || !statSync(planFilePath).isFile()) return;
    write(planFilePath);
  } catch (err) {
    // An fs error's `.code` (e.g. EACCES) is safe to log; the path and plan text
    // must never reach a log record.
    const code = (err as { code?: string } | null)?.code;
    log.warn("review", failMsg, code ? { code } : {});
  }
}

/**
 * Overwrite `planFilePath` with the canonical plan text. No-op when the path is
 * absent (agents without a plan file) or fails the safety guard (must be an
 * existing regular `.md` file). Never throws.
 */
export function writeCanonicalPlanFile(
  planFilePath: string | undefined,
  canonical: string,
  log: CaretLogger,
): void {
  if (!planFilePath) return;
  guardedPlanFileWrite(planFilePath, log, "plan file canonicalize failed", (p) =>
    writeFileSync(p, canonical),
  );
}

/**
 * Append the reviewer's approval notes to the agent's plan file as a trailing,
 * clearly-labeled section, so the plan of record the agent reads carries them on
 * an approval (EXC-791). Shares writeCanonicalPlanFile's surgical guards via
 * guardedPlanFileWrite — the file already holds the canonical plan, so this only
 * adds the section. A blank note or absent path is a no-op. Never throws: notes
 * are a convenience, and losing them must not fail the review.
 */
export function appendReviewerNotesToPlanFile(
  planFilePath: string | undefined,
  notes: string,
  log: Pick<CaretLogger, "warn">,
): void {
  const section = reviewerNotesSection(notes);
  if (!planFilePath || section === "") return;
  guardedPlanFileWrite(planFilePath, log, "plan file notes append failed", (p) =>
    appendFileSync(p, section),
  );
}

// Canonicalize the on-disk plan file the agent reads from: Claude Code's
// `~/.claude/plans/<name>.md`, read for review via readPlanFile, or the file an
// OpenCode `path` review names. That file — not caret's review store — is the
// plan of record the agent references. caret reformats the plan for human review; this
// rewrites the same file with the canonical text so what the agent references is
// byte-identical to what the human reviews, and a reviewer's "Line N" comment
// points at the same line on both sides.
//
// Best-effort and never fatal: a plan must survive even when the file can't be
// rewritten (read-only fs, a race, an older agent that sends no path), so every
// failure is swallowed with a logged code. A file the agent rewrote after ingest
// is left alone.
import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";

import type { CaretLogger } from "@/lib/log.ts";
import type { PlanInput } from "@/lib/types.ts";
import { reviewerNotesSection } from "@/plan/reviewer-notes.ts";

/** Only an existing regular `.md` file counts as the agent's plan file. May throw
 * on an fs race; callers guard it. `resolvePlanSource` (opencode/caret.plugin.ts)
 * repeats this check — keep the two in sync. */
function isPlanFile(path: string): boolean {
  return path.endsWith(".md") && existsSync(path) && statSync(path).isFile();
}

/** The plan file's current text, or undefined when the path fails `isPlanFile` or
 * the read fails. Never throws. */
export function readPlanFile(path: string): string | undefined {
  try {
    return isPlanFile(path) ? readFileSync(path, "utf8") : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The shared, security-relevant guard for writing the agent's plan file: only an
 * existing regular `.md` file is touched (a malformed path can never make caret
 * clobber something else), and every failure is swallowed with a logged `.code`
 * (never the path or plan text). `write` performs the fs ops inside the guard.
 * Not a privilege boundary: caret runs as the agent's user, so following a symlink
 * grants no access it lacks; the guard only keeps a non-plan path unclobbered. A
 * model-chosen path (OpenCode's `path`) is vetted by the plugin, which asks
 * OpenCode for edit permission before sending it. Never throws.
 */
function guardedPlanFileWrite<T>(
  planFilePath: string,
  log: Pick<CaretLogger, "warn">,
  failMsg: string,
  write: (path: string) => T,
): T | undefined {
  try {
    if (!isPlanFile(planFilePath)) return undefined;
    return write(planFilePath);
  } catch (err) {
    // An fs error's `.code` (e.g. EACCES) is safe to log, as `fsCode` since `code` means
    // the triage code on every record; the path and plan text must never reach a
    // log record.
    const code = (err as { code?: string } | null)?.code;
    log.warn("review", failMsg, code ? { fsCode: code } : {});
    return undefined;
  }
}

/**
 * Overwrite the plan file with the canonical plan text, but only while it still
 * holds the `plan` caret ingested: a file the agent rewrote since is newer than the
 * review and is left alone (`"changed"`). `"skipped"` when the path fails the safety
 * guard (must be an existing regular `.md` file) or the fs op fails, which logs its
 * own warning. Never throws.
 */
export function writeCanonicalPlanFile(
  input: Pick<PlanInput, "plan"> & { planFilePath: string },
  canonical: string,
  log: CaretLogger,
): "written" | "changed" | "skipped" {
  return (
    guardedPlanFileWrite(input.planFilePath, log, "plan file canonicalize failed", (p) => {
      if (readFileSync(p, "utf8") !== (input.plan ?? "")) {
        log.info("review", "plan file changed; rewrite skipped");
        return "changed" as const;
      }
      writeFileSync(p, canonical);
      return "written" as const;
    }) ?? "skipped"
  );
}

/**
 * Append the reviewer's approval notes to the agent's plan file as a trailing,
 * clearly-labeled section, so the plan of record the agent reads carries them on
 * an approval (EXC-791). Shares writeCanonicalPlanFile's surgical guards via
 * guardedPlanFileWrite. The caller appends only when the daemon did not see the
 * file move on after ingest, so this only adds the section. A blank
 * note or absent path is a no-op. Never throws: notes are a convenience, and
 * losing them must not fail the review.
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

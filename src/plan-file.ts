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
import { existsSync, statSync, writeFileSync } from "node:fs";
import type { CaretLogger } from "./log.ts";

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
  try {
    // The path is the agent's own planFilePath: it runs as this user and already
    // wrote this file, so following a symlink here grants no access it lacks —
    // the guard is about not clobbering a non-plan path, not a privilege boundary.
    if (!planFilePath.endsWith(".md")) return;
    if (!existsSync(planFilePath) || !statSync(planFilePath).isFile()) return;
    writeFileSync(planFilePath, canonical);
  } catch (err) {
    // The path and plan text must never reach a log record; an fs error's
    // `.code` (e.g. EACCES) is safe and enough to diagnose.
    const code = (err as { code?: string } | null)?.code;
    log.warn("review", "plan file canonicalize failed", code ? { code } : {});
  }
}

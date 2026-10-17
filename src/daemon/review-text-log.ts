// Dev-only records of what a resolve sends the agent, so a developer can check the
// feedback against the selection it came from. They carry reviewer prose and plan text,
// which every other record censors, so only `mise run dev` turns them on
// (CARET_DEV_LOG_REVIEW_TEXT → createServer's `logReviewText`).

import type { CaretLogger } from "@/lib/log.ts";
import { type Decision, isLineAnnotation, type PlanVersion } from "@/lib/types.ts";

/**
 * Log the text a resolve sends the agent at info, split into lines so a pretty-printer
 * shows one per row. On a deny, also log each line-anchored comment at debug with the
 * stored lines its reference points at, whether the sent text cites it, and whether
 * the feedback quoted them.
 */
export function logReviewText(
  log: Pick<CaretLogger, "info" | "debug">,
  version: Pick<PlanVersion, "plan" | "annotations" | "agentCopyMatches">,
  decision: Pick<Decision, "behavior" | "feedback">,
): void {
  const sent = decision.feedback ?? "";
  if (sent) log.info("resolve", "text sent to agent", { text: sent.split("\n") });
  if (decision.behavior !== "deny") return;
  const planLines = version.plan.split("\n");
  // Numbered and headed like the UI's formatFeedback entries — keep the two in sync.
  // Every non-blank comment takes a number, legacy ones included.
  version.annotations
    .filter((a) => a.comment.trim())
    .forEach((a, i) => {
      if (!isLineAnnotation(a)) return;
      const n = i + 1;
      const single = a.startLine === a.endLine;
      const header = single ? `Line ${a.startLine}:` : `Lines ${a.startLine}-${a.endLine}:`;
      log.debug("resolve", `comment ${n}: ${header.slice(0, -1).toLowerCase()}`, {
        lines: planLines.slice(a.startLine - 1, a.endLine),
        comment: a.comment.trim(),
        // False when the deny carried other text: a Reject, or the dev driver's own denies.
        cited: sent.includes(`${n}. ${header}`),
        quoted: !version.agentCopyMatches,
      });
    });
}

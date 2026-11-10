// The caret_review_plan row in pi's transcript. Colours come only from pi's theme.

import { basename } from "node:path";

import { hyperlink } from "@earendil-works/pi-tui";

import type { ReviewOutcome } from "./state.ts";

/** The slice of pi's theme the review row and the doctor entry read. */
export type PiTheme = {
  fg(color: "toolTitle" | "muted" | "dim" | "warning" | "success" | "error", text: string): string;
};

export type ReviewDetails = { state: "waiting"; url: string } | { state: ReviewOutcome };

/** The plan's first `# ` heading, else the plan file's name, else "plan". */
export function planTitle(args: { plan?: string; path?: string }): string {
  return args.plan?.match(/^# (.+)$/m)?.[1] ?? (args.path ? basename(args.path) : "plan");
}

export function callLine(args: { plan?: string; path?: string }, theme: PiTheme): string {
  return `${theme.fg("toolTitle", "caret")} ${theme.fg("muted", planTitle(args))}`;
}

/** A result as pi hands it back. A call that never reached `execute` (bad schema, a
 * blocking hook, an abort) carries `details: {}` and pi's reason in `content`, and so
 * does a session written by a caret with another state set. */
export type RenderedResult = {
  content?: { type: string; text?: string }[];
  details?: Partial<ReviewDetails>;
};

export function resultLine({ content, details }: RenderedResult, theme: PiTheme): string {
  switch (details?.state) {
    case "waiting": {
      const url = details.url ?? "";
      return `${theme.fg("warning", "^")} ${theme.fg("muted", "waiting for review")} ${theme.fg("dim", hyperlink(url, url))}`;
    }
    case "approved":
      return theme.fg("success", "✓ approved");
    case "changes":
      return theme.fg("warning", "↺ changes requested");
    case "cancelled":
      return theme.fg("muted", "cancelled");
    case "failed":
      return theme.fg("error", "✕ review failed");
    default:
      details?.state satisfies undefined;
      return theme.fg("error", `✕ ${content?.[0]?.text ?? "review failed"}`);
  }
}

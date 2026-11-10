// The caret_review_plan row in pi's transcript. Colours come only from pi's theme.

import { basename } from "node:path";

import { hyperlink } from "@earendil-works/pi-tui";

import type { ReviewOutcome } from "./state.ts";

/** The slice of pi's theme the row reads. */
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

export function resultLine(details: ReviewDetails, theme: PiTheme): string {
  switch (details.state) {
    case "waiting":
      return `${theme.fg("warning", "^")} ${theme.fg("muted", "waiting for review")} ${theme.fg("dim", hyperlink(details.url, details.url))}`;
    case "approved":
      return theme.fg("success", "✓ approved");
    case "changes":
      return theme.fg("warning", "↺ changes requested");
    case "cancelled":
      return theme.fg("muted", "cancelled");
    case "failed":
      return theme.fg("error", "✕ review failed");
  }
}

// The agent-tool boundary. An adapter is the only place that knows a specific
// coding agent's wire protocol; the tool-agnostic core (src/) hands an adapter a
// core `Decision` and gets back an opaque, tool-specific stdout response, and
// hands it raw hook stdin and gets back a core `PlanInput`. The dependency runs
// one way: an adapter imports core types, never the reverse.

import type { ApproveVariant, Decision, PlanInput } from "../types.ts";

export type { ApproveVariant };

/**
 * What the adapter can report about the agent tool's local install — surfaced by
 * the discovery command. A tool-agnostic shape describing generic install facts:
 * the installed package version, whether the tool has caret enabled, and whether
 * a manual hook entry sits in the tool's user settings. Each field degrades to
 * "unknown" rather than throwing, so discovery always renders a report.
 */
export interface InstallProbe {
  /** The installed caret package version, or "unknown" if unreadable. */
  pluginVersion: string | "unknown";
  /** Whether the tool has caret enabled, or "unknown" if unreadable. */
  pluginEnabled: boolean | "unknown";
  /** Whether a manual caret hook entry sits in the tool's user settings (the
   * normally-false probe — caret's hooks ride in its own packaging), or
   * "unknown" if unreadable. */
  hookInUserSettings: boolean | "unknown";
}

/**
 * The interface a coding-agent adapter implements. The Claude adapter is the
 * first implementation; the members are declared as far as the core needs them,
 * with the parsing, install-probe, and approve-variant surfaces stable so they
 * can be filled in without reshaping the boundary.
 */
export interface AgentAdapter {
  /** The approve variants this adapter offers, in display order. */
  readonly approveVariants: readonly ApproveVariant[];

  /**
   * Normalize the tool's raw hook stdin into a core `PlanInput`. Throws on input
   * that can't be parsed — the caller turns that into a fail-safe deny.
   */
  parseHookInput(stdin: string): PlanInput;

  /**
   * Render a core `Decision` as the tool-specific stdout response the agent
   * reads. The returned string is opaque to the core (a serialized wire shape).
   */
  emitDecision(decision: Decision): string;

  /** Probe the agent tool's local install for the discovery report. */
  readInstallState(): InstallProbe;
}

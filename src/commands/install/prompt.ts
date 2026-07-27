// The questions `caret install` asks, and the copy that describes what they are about:
// the agent chooser for a run with no `--target`, and the confirm a stale OpenCode
// raises. The verdict lines live here too, beside the question they turn into, so the
// prompt, the check's settled line, and the non-interactive nudge all describe a version
// gap the same way.
//
// @clack/prompts is loaded through a dynamic import so only these paths pay for it —
// src/cli.ts is the review hook's entrypoint on every plan, and install is the one
// subcommand branch that ever renders a prompt.

import type { UpgradeVerdict } from "@/adapters/opencode/upgrade.ts";
import { INSTALL_TARGETS, type InstallTarget } from "@/commands/install/targets.ts";

/** The chooser's rows: every registry target, with the detected ones marked so the
 * pre-checked selection reads as a consequence of detection rather than a default. */
export function chooserOptions(
  detected: InstallTarget[],
): { value: InstallTarget; label: string; hint: string }[] {
  return INSTALL_TARGETS.map((t) => ({
    value: t.id,
    label: t.label,
    hint: detected.includes(t.id) ? `detected — ${t.hint}` : t.hint,
  }));
}

/** Ask which agents to act on, with the detected ones pre-checked. Returns the chosen
 * targets, or null when the user cancels (Ctrl-C / Esc) — the caller then does nothing. */
export async function promptForTargets(
  detected: InstallTarget[],
  uninstall = false,
): Promise<InstallTarget[] | null> {
  const { isCancel, multiselect } = await import("@clack/prompts");
  const chosen = await multiselect({
    message: uninstall
      ? "Remove caret from which coding agents?"
      : "Install caret into which coding agents?",
    options: chooserOptions(detected),
    initialValues: detected,
    required: true,
  });
  return isCancel(chosen) ? null : chosen;
}

/** The two verdicts with a remedy to offer — the only ones anyone is asked about. */
export type StaleVerdict = Extract<UpgradeVerdict, { kind: `stale-${string}` }>;

/** One line naming what an upgrade check found: which caret OpenCode would load, and,
 * when it is behind, which one npm publishes. `unknown` deliberately names no version —
 * the check could not be made, so any number in the line would be a claim caret cannot
 * support (the reason is reported separately, as a warning). */
export function upgradeVerdictLine(verdict: UpgradeVerdict): string {
  switch (verdict.kind) {
    case "fresh":
      return "OpenCode will resolve caret on its next start";
    case "current":
      return `OpenCode's caret is ${verdict.version} — already current`;
    case "stale-cache":
      return `OpenCode's cached caret is ${verdict.cached}; ${verdict.published} is published`;
    case "stale-pin":
      return `Your config pins ${verdict.entry}; ${verdict.published} is published`;
    case "unknown":
      return "Could not check which caret OpenCode would load";
  }
}

/** The upgrade confirm's question: the version gap, then the remedy that closes it —
 * which differs by kind, because a bare entry is unfrozen by clearing its cache and a
 * pin only by rewriting the pin. */
export function upgradePromptMessage(verdict: StaleVerdict): string {
  const remedy =
    verdict.kind === "stale-pin"
      ? "Bump the pin?"
      : "Clear the cached copy so OpenCode re-resolves?";
  return `${upgradeVerdictLine(verdict)}. ${remedy}`;
}

/** clack's confirm session, narrowed to the two functions the question needs — the seam
 * a test drives the cancel path through without a terminal. The module satisfies it. */
export interface ClackConfirm {
  confirm(opts: { message: string }): Promise<unknown>;
  isCancel(value: unknown): boolean;
}

/** Ask whether to take the published caret. Returns the answer, or null when the user
 * cancels (Ctrl-C / Esc) — which the caller treats as "no", not as a failure. */
export async function promptUpgrade(
  verdict: StaleVerdict,
  clack?: ClackConfirm,
): Promise<boolean | null> {
  const { confirm, isCancel }: ClackConfirm = clack ?? (await import("@clack/prompts"));
  const answer = await confirm({ message: upgradePromptMessage(verdict) });
  return isCancel(answer) ? null : answer === true;
}

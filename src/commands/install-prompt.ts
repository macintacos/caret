// The interactive agent chooser for a `caret install` (or `--uninstall`) with no
// `--target`: a multiselect over the install-target registry, with the agents detected
// on this machine pre-checked.
//
// @clack/prompts is loaded through a dynamic import so only this path pays for it —
// src/cli.ts is the review hook's entrypoint on every plan, and the chooser is the one
// subcommand branch that ever renders a prompt.

import { INSTALL_TARGETS, type InstallTarget } from "@/commands/install-targets.ts";

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

// The interactive agent chooser for a bare `caret install`: a multiselect over the
// install-target registry, with the agents detected on this machine pre-checked.
//
// @clack/prompts is loaded through a dynamic import so only this path pays for it —
// src/cli.ts is the review hook's entrypoint on every plan, and the chooser is the one
// subcommand branch that ever renders a prompt.

import { INSTALL_TARGETS, type InstallTarget } from "@/commands/install-targets.ts";

/** Ask which agents to install into. Returns the chosen targets, or null when the user
 * cancels (Ctrl-C / Esc) — the caller installs nothing in that case. */
export async function promptForTargets(detected: InstallTarget[]): Promise<InstallTarget[] | null> {
  const { isCancel, multiselect } = await import("@clack/prompts");
  const chosen = await multiselect({
    message: "Install caret into which coding agents?",
    options: INSTALL_TARGETS.map((t) => ({
      value: t.id,
      label: t.label,
      hint: detected.includes(t.id) ? `detected — ${t.hint}` : t.hint,
    })),
    initialValues: detected,
    required: true,
  });
  return isCancel(chosen) ? null : chosen;
}

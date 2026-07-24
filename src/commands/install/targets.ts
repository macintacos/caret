// The registry of coding agents `caret install` can install into: one descriptor per
// target, carrying its id, the copy the interactive chooser shows, and how to detect
// it on this machine. Detection mirrors scripts/install.sh's select_targets() —
// `claude` on PATH for Claude Code, `opencode` on PATH or an existing OpenCode config
// dir for OpenCode.
//
// Everything that enumerates targets (--target parsing, the chooser rows, detection)
// reads this one array, so a future agent is one descriptor, one runner module beside
// this one, and one dispatch arm in index.ts — no second list to keep in sync, and the
// arm is not optional: index.ts dispatches through an exhaustive switch, so a descriptor
// with no runner is a type error.

import { existsSync } from "node:fs";

import { opencodeConfigDir } from "@/adapters/opencode/paths.ts";

/** Every installable target id, in the order the chooser lists them. */
export const INSTALL_TARGET_IDS = ["claude", "opencode"] as const;
export type InstallTarget = (typeof INSTALL_TARGET_IDS)[number];

/** The machine probes detection runs against, injected so a test can describe a
 * machine (which commands resolve, which paths exist) without touching the real PATH
 * or config dirs. */
export interface DetectProbe {
  /** Does `name` resolve on PATH? */
  hasCommand: (name: string) => boolean;
  /** Does `path` exist on disk? */
  hasPath: (path: string) => boolean;
}

/** One installable agent: its id, its chooser copy, and its detection rule. */
export interface InstallTargetDescriptor {
  id: InstallTarget;
  /** Chooser row title — the agent's product name. */
  label: string;
  /** Chooser row hint — what installing into it does. */
  hint: string;
  detect: (probe: DetectProbe) => boolean;
}

export const INSTALL_TARGETS: readonly InstallTargetDescriptor[] = [
  {
    id: "claude",
    label: "Claude Code",
    hint: "register caret's plugin via the claude CLI",
    detect: (probe) => probe.hasCommand("claude"),
  },
  {
    id: "opencode",
    label: "OpenCode",
    // An OpenCode config dir counts even without the command: OpenCode may be run
    // through bunx/npx, so its config dir is the durable signal that it is in use.
    hint: "add caret to the plugin array + deploy /caret:* commands",
    detect: (probe) => probe.hasCommand("opencode") || probe.hasPath(opencodeConfigDir()),
  },
];

/** The real machine: PATH lookups via Bun.which, existence via the filesystem. */
const systemProbe: DetectProbe = {
  hasCommand: (name) => Bun.which(name) !== null,
  hasPath: existsSync,
};

/** The agents present on this machine, in registry order. */
export function detectTargets(probe: DetectProbe = systemProbe): InstallTarget[] {
  return INSTALL_TARGETS.filter((t) => t.detect(probe)).map((t) => t.id);
}

/** A target's product name, for step labels and the closing line — the same string the
 * chooser shows, so the run reads consistently from prompt to outro. */
export function targetLabel(target: InstallTarget): string {
  return INSTALL_TARGETS.find((t) => t.id === target)?.label ?? target;
}

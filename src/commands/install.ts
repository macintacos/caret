// The `caret install` command: install caret into one or more coding agents.
// `--target` is a comma-separated list of `opencode`, `claude`, or both; each target
// owns its own mechanism (OpenCode: a `plugin` array entry + command files; Claude
// Code: the `claude` plugin CLI). `--uninstall` / `--dry-run` apply to every selected
// target. Target parsing is a pure function so it is unit-testable, and the target
// runners are injectable so dispatch can be tested without touching a real config dir
// or the `claude` CLI.

import { runInstallClaudeTarget } from "@/commands/install-claude.ts";
import { runInstallOpencodeTarget } from "@/commands/install-opencode.ts";

const KNOWN_TARGETS = ["opencode", "claude"] as const;
export type InstallTarget = (typeof KNOWN_TARGETS)[number];

/** Parse a `--target` value ("opencode", "claude", or "opencode,claude") into a
 * deduped, order-preserving target list — or an error message for an empty/unknown
 * value. */
export function parseTargets(
  raw: string | undefined,
): { targets: InstallTarget[] } | { error: string } {
  const parts = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return {
      error: `--target is required (a comma-separated list of: ${KNOWN_TARGETS.join(", ")}).`,
    };
  }
  const unknown = parts.filter((p) => !(KNOWN_TARGETS as readonly string[]).includes(p));
  if (unknown.length > 0) {
    return {
      error: `unknown --target value(s): ${unknown.join(", ")}. Valid: ${KNOWN_TARGETS.join(", ")}.`,
    };
  }
  const targets: InstallTarget[] = [];
  for (const p of parts)
    if (!targets.includes(p as InstallTarget)) targets.push(p as InstallTarget);
  return { targets };
}

/** Injection seam for tests: override each target runner to assert dispatch without
 * touching a real config dir or the `claude` CLI. */
export interface InstallDeps {
  runOpencode?: (opts: { uninstall: boolean; dryRun: boolean }) => void;
  runClaude?: (opts: { uninstall: boolean; dryRun: boolean }) => void;
}

/** Run the install command: parse `--target`, then dispatch to each selected target.
 * On an invalid `--target`, writes the reason to stderr and sets a non-zero exit
 * code (nothing is installed). */
export function runInstallSubcommand(
  opts: { target?: string; uninstall: boolean; dryRun: boolean },
  deps: InstallDeps = {},
): void {
  const parsed = parseTargets(opts.target);
  if ("error" in parsed) {
    process.stderr.write(`caret: ${parsed.error}\n`);
    process.exitCode = 2;
    return;
  }
  const runOpencode = deps.runOpencode ?? ((o) => runInstallOpencodeTarget(o));
  const runClaude = deps.runClaude ?? ((o) => runInstallClaudeTarget(o));
  const targetOpts = { uninstall: opts.uninstall, dryRun: opts.dryRun };
  for (const target of parsed.targets) {
    if (target === "opencode") runOpencode(targetOpts);
    else runClaude(targetOpts);
  }
}

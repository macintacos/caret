// The `caret install` command: install caret into one or more coding agents.
// `--target` is a comma-separated list of the ids in the install-target registry; each
// target owns its own mechanism (OpenCode: a `plugin` array entry + command files;
// Claude Code: the `claude` plugin CLI). Omit `--target` and caret detects the agents
// on this machine and asks — on a TTY through the chooser, otherwise by installing into
// everything it detected (Claude Code when it detected nothing), so CI never hangs on a
// prompt. Every install ends by downloading the rumdl plan formatter, best-effort, the
// same eager step scripts/install.sh runs. `--uninstall` / `--dry-run` apply to every
// selected target, and neither downloads rumdl. Target parsing is a pure function so it
// is unit-testable, and detection, the chooser, TTY-ness, and the target runners are all
// injectable so selection and dispatch can be tested without touching a real config dir,
// the `claude` CLI, or a terminal.

import { runInstallClaudeTarget } from "@/commands/install-claude.ts";
import { runInstallOpencodeTarget } from "@/commands/install-opencode.ts";
import { promptForTargets } from "@/commands/install-prompt.ts";
import { runInstallRumdlSubcommand } from "@/commands/install-rumdl.ts";
import {
  detectTargets,
  INSTALL_TARGET_IDS,
  type InstallTarget,
} from "@/commands/install-targets.ts";
import { errorMessage } from "@/lib/types.ts";

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
      error: `--target names no agent (it takes a comma-separated list of: ${INSTALL_TARGET_IDS.join(", ")}) — omit it entirely to choose interactively.`,
    };
  }
  const unknown = parts.filter((p) => !(INSTALL_TARGET_IDS as readonly string[]).includes(p));
  if (unknown.length > 0) {
    return {
      error: `unknown --target value(s): ${unknown.join(", ")}. Valid: ${INSTALL_TARGET_IDS.join(", ")}.`,
    };
  }
  const targets: InstallTarget[] = [];
  for (const p of parts)
    if (!targets.includes(p as InstallTarget)) targets.push(p as InstallTarget);
  return { targets };
}

/** Injection seam for tests: override detection, the chooser, TTY-ness, and each target
 * runner to assert selection and dispatch without touching a real config dir, the
 * `claude` CLI, or a terminal. */
export interface InstallDeps {
  runOpencode?: (opts: { uninstall: boolean; dryRun: boolean }) => void;
  runClaude?: (opts: { uninstall: boolean; dryRun: boolean }) => void;
  detect?: () => InstallTarget[];
  prompt?: (detected: InstallTarget[], uninstall: boolean) => Promise<InstallTarget[] | null>;
  isInteractive?: () => boolean;
  ensureRumdl?: () => Promise<void>;
}

/** Run the install command: resolve the targets (from `--target`, the chooser, or
 * detection), then dispatch to each one. On an invalid `--target`, writes the reason to
 * stderr and sets a non-zero exit code (nothing is installed). */
export async function runInstallSubcommand(
  opts: { target?: string; uninstall: boolean; dryRun: boolean },
  deps: InstallDeps = {},
): Promise<void> {
  const targets = await selectTargets(opts, deps);
  if (targets === null) return;

  const runOpencode = deps.runOpencode ?? ((o) => runInstallOpencodeTarget(o));
  const runClaude = deps.runClaude ?? ((o) => runInstallClaudeTarget(o));
  const targetOpts = { uninstall: opts.uninstall, dryRun: opts.dryRun };
  for (const target of targets) {
    switch (target) {
      case "opencode":
        runOpencode(targetOpts);
        break;
      case "claude":
        runClaude(targetOpts);
        break;
      // Exhaustive on purpose: a new registry descriptor without a runner here is a
      // type error, not a silent install into the wrong agent.
      default:
        target satisfies never;
    }
  }

  if (opts.uninstall) return;
  if (opts.dryRun) {
    process.stdout.write("caret: [dry-run] would download the rumdl plan formatter.\n");
    return;
  }
  // Eagerly download rumdl so the first plan doesn't pay the latency, the same
  // best-effort step scripts/install.sh runs: the daemon downloads it lazily anyway, so
  // a failure here is reported and never fails the install.
  try {
    await (deps.ensureRumdl ?? (() => runInstallRumdlSubcommand()))();
  } catch (e) {
    process.stderr.write(
      `caret: could not download rumdl (${errorMessage(e)}) — caret will retry on your first plan.\n`,
    );
  }
}

/** Resolve which agents to install into. `null` means "install nothing" — either the
 * `--target` value was invalid (reported, non-zero exit) or the user cancelled the
 * chooser. The prompt is skipped whenever it can't be answered (no TTY) or shouldn't be
 * asked: `--dry-run` previews the detected agents instead, mirroring scripts/install.sh,
 * which also suppresses its prompt in dry-run. */
async function selectTargets(
  opts: { target?: string; uninstall: boolean; dryRun: boolean },
  deps: InstallDeps,
): Promise<InstallTarget[] | null> {
  if (opts.target !== undefined) {
    const parsed = parseTargets(opts.target);
    if ("error" in parsed) {
      process.stderr.write(`caret: ${parsed.error}\n`);
      process.exitCode = 2;
      return null;
    }
    return parsed.targets;
  }

  const detected = (deps.detect ?? detectTargets)();
  // Both ends must be a terminal: the chooser reads keys from stdin and draws to stdout,
  // so a piped stdout would render its UI into the pipe and look like a hang.
  const isInteractive =
    deps.isInteractive ?? (() => process.stdin.isTTY === true && process.stdout.isTTY === true);
  if (isInteractive() && !opts.dryRun) {
    const chosen = await (deps.prompt ?? promptForTargets)(detected, opts.uninstall);
    if (chosen === null) {
      process.stdout.write("caret: cancelled — nothing was changed.\n");
      return null;
    }
    return chosen;
  }

  // Non-interactive: install into everything detected, defaulting to Claude Code when
  // nothing was. Say which, so a log explains the choice nobody was there to make.
  const targets: InstallTarget[] = detected.length > 0 ? detected : ["claude"];
  const why = detected.length > 0 ? "detected" : "no agent detected, defaulting to";
  process.stdout.write(`caret: ${why} ${targets.join(", ")}.\n`);
  return targets;
}

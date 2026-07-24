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
import { ensureRumdlInstalled } from "@/commands/install-rumdl.ts";
import {
  detectTargets,
  INSTALL_TARGET_IDS,
  type InstallTarget,
  targetLabel,
} from "@/commands/install-targets.ts";
import { createInstallUI, type InstallUI } from "@/commands/install-ui.ts";
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
  runOpencode?: (opts: TargetOpts, deps: { ui: InstallUI }) => void | Promise<void>;
  runClaude?: (opts: TargetOpts, deps: { ui: InstallUI }) => void | Promise<void>;
  detect?: () => InstallTarget[];
  prompt?: (detected: InstallTarget[], uninstall: boolean) => Promise<InstallTarget[] | null>;
  isInteractive?: () => boolean;
  ensureRumdl?: () => Promise<string>;
  ui?: InstallUI;
}

interface TargetOpts {
  uninstall: boolean;
  dryRun: boolean;
}

/** Run the install command: resolve the targets (from `--target`, the chooser, or
 * detection), then dispatch to each one. On an invalid `--target`, writes the reason to
 * stderr and sets a non-zero exit code (nothing is installed). */
export async function runInstallSubcommand(
  opts: { target?: string; uninstall: boolean; dryRun: boolean },
  deps: InstallDeps = {},
): Promise<void> {
  const ui = deps.ui ?? (await createInstallUI());
  const verb = opts.uninstall ? "uninstall" : "install";
  ui.intro(`${verb}${opts.dryRun ? " (dry run)" : ""}`);

  const targets = await selectTargets(opts, deps, ui);
  if (targets === null) return;

  const runOpencode = deps.runOpencode ?? runInstallOpencodeTarget;
  const runClaude = deps.runClaude ?? runInstallClaudeTarget;
  const targetOpts = { uninstall: opts.uninstall, dryRun: opts.dryRun };
  for (const target of targets) {
    switch (target) {
      case "opencode":
        await runOpencode(targetOpts, { ui });
        break;
      case "claude":
        await runClaude(targetOpts, { ui });
        break;
      // Exhaustive on purpose: a new registry descriptor without a runner here is a
      // type error, not a silent install into the wrong agent.
      default:
        target satisfies never;
    }
  }

  await rumdlStep(opts, deps, ui);
  ui.outro(closingLine(targets, opts));
}

/** Eagerly download rumdl so the first plan doesn't pay the latency, the same
 * best-effort step scripts/install.sh runs: the daemon downloads it lazily anyway, so a
 * failure here is reported as a warning and never fails the install. Uninstalls skip it
 * (nothing is being set up), and dry-run only says it would run. */
async function rumdlStep(
  opts: { uninstall: boolean; dryRun: boolean },
  deps: InstallDeps,
  ui: InstallUI,
): Promise<void> {
  if (opts.uninstall) return;
  if (opts.dryRun) {
    ui.info("Would download the rumdl plan formatter.");
    return;
  }
  try {
    await ui.step(
      "Downloading the rumdl plan formatter",
      () => (deps.ensureRumdl ?? ensureRumdlInstalled)(),
      (summary) => summary,
    );
  } catch (e) {
    ui.warn(`Could not download rumdl (${errorMessage(e)}) — caret will retry on your first plan.`);
  }
}

/** The closing line: what happened, to which agents, and the one thing OpenCode needs
 * the user to do next. */
function closingLine(
  targets: InstallTarget[],
  opts: { uninstall: boolean; dryRun: boolean },
): string {
  const names = targets.map(targetLabel).join(" and ");
  if (opts.dryRun) return `Dry run complete — nothing was changed.`;
  if (opts.uninstall) return `caret removed from ${names}.`;
  const restart = targets.includes("opencode")
    ? " Restart OpenCode once so it installs and loads the plugin."
    : "";
  return `caret is installed in ${names}.${restart}`;
}

/** Resolve which agents to install into. `null` means "install nothing" — either the
 * `--target` value was invalid (reported, non-zero exit) or the user cancelled the
 * chooser. The prompt is skipped whenever it can't be answered (no TTY) or shouldn't be
 * asked: `--dry-run` previews the detected agents instead, mirroring scripts/install.sh,
 * which also suppresses its prompt in dry-run. */
async function selectTargets(
  opts: { target?: string; uninstall: boolean; dryRun: boolean },
  deps: InstallDeps,
  ui: InstallUI,
): Promise<InstallTarget[] | null> {
  if (opts.target !== undefined) {
    const parsed = parseTargets(opts.target);
    if ("error" in parsed) {
      ui.error(parsed.error);
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
      ui.cancel("Cancelled — nothing was changed.");
      return null;
    }
    return chosen;
  }

  // Non-interactive: act on everything detected, defaulting to Claude Code when nothing
  // was. Say which, so a log explains the choice nobody was there to make.
  const targets: InstallTarget[] = detected.length > 0 ? detected : ["claude"];
  const names = targets.map(targetLabel).join(", ");
  ui.info(detected.length > 0 ? `Detected ${names}.` : `No agent detected — using ${names}.`);
  return targets;
}

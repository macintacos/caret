// The `caret install` command: install caret into one or more coding agents. Each target
// owns its own mechanism (OpenCode: a `plugin` array entry + command files; Claude Code:
// the `claude` plugin CLI). caret detects the agents on this machine and asks — on a TTY
// through the chooser, otherwise by installing into everything it detected (Claude Code
// when it detected nothing), so CI never hangs on a prompt. Every install ends by
// acquiring the rumdl plan formatter: it is part of a working caret, not a step anyone
// can skip or forget. `--uninstall` is machine-wide — it removes caret from every agent
// in the registry, since the residency it tears down alongside them is one service for
// the whole machine. Neither it nor `--dry-run` acquires rumdl.

import { runInstallClaudeTarget } from "@/commands/install/claude.ts";
import {
  devMarketplaceDir,
  type LocalInstall,
  prewarmLocalBuild,
  resolveLocalCheckout,
} from "@/commands/install/local.ts";
import { runInstallOpencodeTarget } from "@/commands/install/opencode.ts";
import { promptForTargets } from "@/commands/install/prompt.ts";
import {
  reconcileService,
  type ServiceStepDeps,
  uninstallService,
} from "@/commands/install/service.ts";
import {
  detectTargets,
  INSTALL_TARGET_IDS,
  type InstallTarget,
  targetLabel,
} from "@/commands/install/targets.ts";
import { createInstallUI, type InstallUI, isTerminal } from "@/commands/install/ui.ts";
import { errorMessage } from "@/lib/types.ts";
import { ensureRumdl, RUMDL_VERSION } from "@/plan/rumdl.ts";

/** Injection seam for tests: override detection, the chooser, TTY-ness, each target
 * runner, and — through ServiceStepDeps — the supervisor, to assert selection and
 * dispatch without touching a real config dir, the `claude` CLI, launchd, or a
 * terminal. */
export interface InstallDeps extends ServiceStepDeps {
  /** A runner returns false to report "this target failed" (it has already said why);
   * returning nothing means it got through. */
  runOpencode?: (opts: TargetOpts, deps: { ui: InstallUI }) => unknown;
  runClaude?: (opts: TargetOpts, deps: { ui: InstallUI }) => unknown;
  detect?: () => InstallTarget[];
  prompt?: (detected: InstallTarget[]) => Promise<InstallTarget[] | null>;
  isInteractive?: () => boolean;
  /** Narrowed to what the step reports — the real `ensureRumdl` satisfies it, and a test
   * can describe an outcome without the config path it never reads. */
  ensureRumdl?: () => Promise<{ bin: string; installed: boolean }>;
  /** `--from-local` seams: which checkout is being installed, where its generated
   * marketplace goes, and the daemon hand-off. */
  resolveLocal?: (opts: { requireArtifacts: boolean }) => { repoDir: string; ref: string };
  marketplaceDir?: () => string;
  prewarm?: (repoDir: string) => Promise<void>;
  ui?: InstallUI;
}

interface TargetOpts {
  uninstall: boolean;
  dryRun: boolean;
  /** Set by `--refresh`: pre-answer the upgrade prompt a stale OpenCode raises, so a
   * non-interactive run can take the published caret without being asked. Only the
   * OpenCode target reads it — Claude Code's plugin cache is managed by Claude's own CLI,
   * so that target always updates and has no prompt to pre-answer. */
  refresh: boolean;
  /** Set by `--from-local`: install this checkout rather than the published caret. Only
   * the Claude target reads it — OpenCode's command files already resolve to the running
   * binary, so installing from a local caret is local by construction. */
  local?: LocalInstall;
}

/** How an install run ended. `ok` covers every run that got through without a reported
 * failure, a chooser the user cancelled included — cancelling changes nothing and is not
 * an error. `refused` is an invocation the run would not act on at all; `failed` is one
 * that acted and stopped partway. `src/cli.ts` maps these onto exit codes. */
export type InstallOutcome = "ok" | "refused" | "failed";

/** The exit code an outcome earns. Separate from the `process.exitCode` write in
 * `src/cli.ts` so the mapping is assertable without spawning the CLI. */
export function installExitCode(outcome: InstallOutcome): number {
  return { ok: 0, refused: 2, failed: 1 }[outcome];
}

/** Run the install command: resolve the targets (the chooser or detection), then
 * dispatch to each one. Reports every problem through `ui` and returns how the run
 * ended — never throws, and never writes `process.exitCode` itself. */
export async function runInstallSubcommand(
  opts: {
    uninstall: boolean;
    dryRun: boolean;
    fromLocal?: boolean;
    refresh?: boolean;
    /** `--no-resident`, already inverted by Commander. */
    resident?: boolean;
  },
  deps: InstallDeps = {},
): Promise<InstallOutcome> {
  const ui = deps.ui ?? (await createInstallUI());
  const verb = opts.uninstall ? "uninstall" : "install";
  ui.intro(`${verb}${opts.fromLocal ? " (local build)" : ""}${opts.dryRun ? " (dry run)" : ""}`);

  let local: LocalInstall | undefined;
  if (opts.fromLocal) {
    const resolved = resolveLocal(opts, deps, ui);
    if (resolved === null) return "refused";
    local = resolved;
  }

  const targets = await selectTargets(opts, deps, ui);
  if (targets === null) return "ok";

  const runOpencode = deps.runOpencode ?? runInstallOpencodeTarget;
  const runClaude = deps.runClaude ?? runInstallClaudeTarget;
  const targetOpts = {
    uninstall: opts.uninstall,
    dryRun: opts.dryRun,
    refresh: opts.refresh ?? false,
    local,
  };
  for (const target of targets) {
    let ok: unknown;
    try {
      switch (target) {
        case "opencode":
          ok = await runOpencode(targetOpts, { ui });
          break;
        case "claude":
          ok = await runClaude(targetOpts, { ui });
          break;
        // Exhaustive on purpose: a new registry descriptor without a runner here is a
        // type error, not a silent install into the wrong agent.
        default:
          target satisfies never;
      }
    } catch (e) {
      // A target that throws instead of reporting would otherwise escape to the CLI's
      // fail-safe handler, which renders a hook deny line — nonsense from an install.
      ui.error(`${targetLabel(target)}: ${errorMessage(e)}`);
      ok = false;
    }
    // A runner signals a reported failure by returning false; anything else (including
    // the void the OpenCode target returns) means it got through. One failure stops the
    // run: the remaining work all assumes caret is installed.
    if (ok === false) {
      ui.outro(`Stopped — ${targetLabel(target)} was not set up. Nothing further was run.`);
      return "failed";
    }
  }

  await rumdlStep(opts, deps, ui);
  // After the target runners, so `--refresh`'s restart cycles a supervisor that resolves
  // the plugin cache those runners just updated.
  if (opts.uninstall) await uninstallService({ dryRun: opts.dryRun }, deps, ui);
  else
    await reconcileService(
      { dryRun: opts.dryRun, refresh: opts.refresh ?? false, resident: opts.resident ?? true },
      deps,
      ui,
    );
  if (local && !opts.dryRun) await prewarmStep(local.repoDir, deps, ui);
  ui.outro(closingLine(targets, opts, local !== undefined));
  return "ok";
}

/** Resolve the checkout `--from-local` installs, or report why it can't and return null,
 * which the caller turns into a `refused` run that installs nothing. Runs before target
 * selection so a published binary — or a checkout nobody built — never reaches a target
 * runner. */
function resolveLocal(
  opts: { uninstall: boolean; dryRun: boolean },
  deps: InstallDeps,
  ui: InstallUI,
): LocalInstall | null {
  if (opts.uninstall) {
    ui.error(
      "--from-local installs the checkout caret is running from; it has no uninstall. Run `caret install --uninstall` to remove caret from an agent.",
    );
    return null;
  }
  try {
    // A preview changes nothing, so it does not need the artifacts a real run reuses —
    // `--from-local --dry-run` stays usable in a checkout nobody has built yet.
    const { repoDir, ref } = (deps.resolveLocal ?? resolveLocalCheckout)({
      requireArtifacts: !opts.dryRun,
    });
    ui.info(`Installing the local build at ${repoDir} (${ref}).`);
    return { repoDir, marketplaceDir: (deps.marketplaceDir ?? devMarketplaceDir)() };
  } catch (e) {
    ui.error(errorMessage(e));
    return null;
  }
}

/** Hand the daemon to the freshly built binary. Best-effort like every other part of the
 * hand-off: a hiccup here leaves an otherwise-clean install standing, and the next review
 * spawns the daemon anyway. The step reports only that prewarm ran — it cannot know
 * whether the running daemon was retired or merely reused (see local.ts). */
async function prewarmStep(repoDir: string, deps: InstallDeps, ui: InstallUI): Promise<void> {
  try {
    await ui.step(
      "Prewarming the daemon on the fresh build",
      () => (deps.prewarm ?? prewarmLocalBuild)(repoDir),
      () => "Ran the fresh build's prewarm",
    );
  } catch (e) {
    ui.warn(`Could not prewarm (${errorMessage(e)}) — the next review starts the daemon.`);
  }
}

/** Acquire rumdl, the plan formatter every reviewed plan is reflowed through. Part of
 * installing caret rather than a step of its own: ensureRumdl puts the pinned version at
 * caret's own path, replacing an older binary a previous caret left there, so plans are
 * always reflowed by the rumdl caret expects. Doing it here keeps the first plan off the
 * download latency, so a failure is a warning rather than a failed install — the lazy
 * path stores the plan raw meanwhile, though a failure here also cools the daemon's own
 * acquisition down for RUMDL_RETRY_COOLDOWN_MS.
 * Uninstalls skip it (nothing is being set up), and dry-run only says it would run. */
async function rumdlStep(
  opts: { uninstall: boolean; dryRun: boolean },
  deps: InstallDeps,
  ui: InstallUI,
): Promise<void> {
  if (opts.uninstall) return;
  if (opts.dryRun) {
    ui.info("Would install the rumdl plan formatter.");
    return;
  }
  try {
    await ui.step(
      "Installing the rumdl plan formatter",
      () => (deps.ensureRumdl ?? ensureRumdl)(),
      // Name the version, not just the path: "already present" is a claim about which
      // rumdl will format your plans. `installed` is ensureRumdl's own signal, so it stays
      // honest across a fresh download, an already-pinned binary, and a CARET_RUMDL_BIN
      // override alike.
      ({ bin, installed }) =>
        `rumdl ${RUMDL_VERSION} ${installed ? "installed" : "already present"} at ${bin}`,
    );
  } catch (e) {
    ui.warn(
      `Could not install rumdl (${errorMessage(e)}) — plans are stored unformatted until it installs.`,
    );
  }
}

/** The closing line: what happened, to which agents, and the one thing each agent needs
 * the user to do next. */
function closingLine(
  targets: InstallTarget[],
  opts: { uninstall: boolean; dryRun: boolean },
  local = false,
): string {
  const names = targets.map(targetLabel).join(" and ");
  if (opts.dryRun) return `Dry run complete — nothing was changed.`;
  if (opts.uninstall) return `caret removed from ${names}.`;
  const restart = targets.includes("opencode")
    ? " Restart OpenCode once so it installs and loads the plugin."
    : "";
  // The local build lands in Claude's plugin cache at install time, so the running
  // Claude Code session keeps the previous copy until it reloads.
  const reload =
    local && targets.includes("claude")
      ? " Run /reload-plugins (or restart Claude Code) to pick it up."
      : "";
  return `caret${local ? " (local build)" : ""} is installed in ${names}.${reload}${restart}`;
}

/** Resolve which agents to act on. `null` means "do nothing" — the user cancelled the
 * chooser.
 *
 * An uninstall takes every registry target and asks nothing: residency is a single
 * machine-wide service, so removing caret from one agent while leaving it in another
 * would leave that agent's caret non-resident. The install prompt is skipped whenever it
 * can't be answered (no TTY) or shouldn't be asked: `--dry-run` previews the detected
 * agents instead of asking about a run that changes nothing. */
async function selectTargets(
  opts: { uninstall: boolean; dryRun: boolean },
  deps: InstallDeps,
  ui: InstallUI,
): Promise<InstallTarget[] | null> {
  if (opts.uninstall) return [...INSTALL_TARGET_IDS];

  const detected = (deps.detect ?? detectTargets)();
  const isInteractive = deps.isInteractive ?? isTerminal;
  if (isInteractive() && !opts.dryRun) {
    const chosen = await (deps.prompt ?? promptForTargets)(detected);
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

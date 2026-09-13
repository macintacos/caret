// The install step that makes a machine resident: it registers the platform unit that
// serves the review UI from login onward, or removes it for someone who runs caret
// themselves (EXC-1167). The choice is asked on every install at a terminal and saved
// nowhere, so an install nobody could ask leaves the machine as it found it. An install
// and an uninstall share only the supervisor lookup and the never-fail shell, so each is
// its own entry point rather than a flag the other reads.
//
// Two facts are only reliably available here. `serviceEnvironment(process.env)` captures
// the shell's world-defining variables, which a supervisor-started daemon inherits none
// of; and installLauncher records the `bun` this install is running under when there is
// one — a compiled install records nothing and the launcher searches.

import {
  type LauncherDeps,
  installLauncher as realInstallLauncher,
  uninstallLauncher,
} from "@/commands/install/launcher.ts";
import type { InstallUI } from "@/commands/install/ui.ts";
import type { ServiceTarget } from "@/commands/service-target.ts";
import { VANITY_HOST } from "@/config/constants.ts";
import { launcherPath } from "@/config/paths.ts";
import { getPort, loadSettings } from "@/config/settings.ts";
import { DAEMON_CWD } from "@/daemon/lifecycle.ts";
import { errorMessage } from "@/lib/types.ts";
import { SERVICE_TERMINAL_EXIT_STATUS, serviceEnvironment } from "@/service/manager.ts";

export interface ServiceStepDeps {
  /** The supervisor to reconcile against, wired by src/cli.ts. A thunk because resolving
   * the platform throws on a host that is neither darwin nor linux — called inside
   * withService's try/catch, that is one warning rather than a stack trace out of an
   * otherwise-clean install. Absent means there is no supervisor to reconcile and both
   * steps do nothing: these are the install steps whose real effects tear a running
   * service down, so driving the machine's own launchd is something a caller opts into
   * rather than something a test has to remember to opt out of. */
  service?: () => ServiceTarget;
  installLauncher?: (deps: LauncherDeps) => { unpinned: boolean };
}

/** Run `body` against the supervisor this machine installs under, if there is one to
 * drive. Every failure is a warning: a machine that could not go resident still has a
 * working caret. */
async function withService(
  deps: ServiceStepDeps,
  ui: InstallUI,
  body: (target: ServiceTarget) => Promise<void>,
): Promise<void> {
  if (deps.service === undefined) return;
  try {
    await body(deps.service());
  } catch (e) {
    ui.warn(
      `Could not update the caret service (${errorMessage(e)}) — caret still starts on demand.`,
    );
  }
}

/** Remove the caret service and the launcher it ran, reporting through `ui`. */
export async function uninstallService(
  opts: { dryRun: boolean },
  deps: ServiceStepDeps,
  ui: InstallUI,
): Promise<void> {
  await withService(deps, ui, async ({ manager }) => {
    if (opts.dryRun) {
      ui.info("Would remove the caret service and the launcher it runs.");
      return;
    }
    await manager.uninstall();
    uninstallLauncher();
    ui.info("Removed the caret service and the launcher it ran.");
  });
}

/** What this install does about the caret service: the prompt's two answers, or — when
 * nobody was asked — the machine left as found. */
export type ServiceChoice = "always-on" | "run-yourself" | "as-found";

/** `caret serve` from the published package, for someone running caret themselves. */
const SERVE_COMMAND = "bunx --no-cache @macintacos/caret@latest serve";

/** Bring the caret service in line with this install's choice, reporting through `ui`. */
export async function reconcileService(
  opts: {
    dryRun: boolean;
    refresh: boolean;
    choice: ServiceChoice;
    /** The checkout `--from-local` pins the service's launcher to. Absent for a published
     * install, which clears any pin. */
    pinnedRoot?: string;
  },
  deps: ServiceStepDeps,
  ui: InstallUI,
): Promise<void> {
  let removed = false;
  await withService(deps, ui, async (target) => {
    const { manager, label, visibleIn, optOutSurface, visibleToggleCaveat } = target;
    const status = await manager.status();
    if (opts.choice === "run-yourself") {
      // The launcher goes with the unit: what it records is the unit's name, and nothing
      // but a supervisor runs it.
      if (status.installed && !opts.dryRun) {
        await manager.uninstall();
        uninstallLauncher();
        removed = true;
      }
      return;
    }
    if (status.unsupported) {
      ui.info(`Not registering the caret service: ${status.unsupported}.`);
      return;
    }
    if (opts.choice === "as-found" && !status.installed) {
      ui.info(
        "No caret service is registered — run `caret install` at a terminal to choose whether caret keeps the review UI running.",
      );
      return;
    }
    if (status.disabled) {
      ui.info(`The caret service is turned off with ${optOutSurface} — leaving it that way.`);
      return;
    }
    if (opts.dryRun) {
      ui.info("Would install the caret service, so the review UI is up from login onward.");
      return;
    }

    // The unit names the launcher, so the launcher has to be there first.
    const { unpinned } = (deps.installLauncher ?? realInstallLauncher)({
      serviceLabel: label,
      pinnedRoot: opts.pinnedRoot,
    });
    await manager.install({
      launcherPath: launcherPath(),
      label,
      workingDirectory: DAEMON_CWD,
      environment: serviceEnvironment(process.env),
      terminalExitStatus: SERVICE_TERMINAL_EXIT_STATUS,
    });
    // install() is a no-op on an unchanged unit, so a new build or pin serves only once the
    // supervisor cycles. `--from-local` cycles even onto the same pin: hooks never cycle a
    // pinned daemon. Unpinning cycles because hooks attach to a checkout newer than them.
    if (opts.refresh || opts.pinnedRoot !== undefined || unpinned) await manager.restart();

    const announcement = `The review UI is now always up at ${reviewUrl()} — it appears in ${visibleIn}. To turn it off, run \`caret install\` again and choose to run caret yourself.`;
    ui.info([announcement, visibleToggleCaveat].filter(Boolean).join(" "));
  });
  // Outside withService, so a supervisor that cannot even be looked up still leaves the
  // user knowing how to reach the review UI.
  if (opts.choice !== "run-yourself") return;
  const serve =
    opts.pinnedRoot === undefined ? SERVE_COMMAND : `${opts.pinnedRoot}/bin/caret serve`;
  ui.info(
    `caret will not keep the review UI running${removed ? " — its service was removed" : ""}. Run \`${serve}\` in a terminal to keep it up at ${reviewUrl()} until you stop it with Ctrl+C; without it, caret still starts when your agent submits a plan.`,
  );
}

function reviewUrl(): string {
  return `http://${VANITY_HOST}:${getPort(loadSettings())}`;
}

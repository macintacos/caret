// The install step that makes a machine resident: it registers the platform unit that
// serves the review UI from login onward, or removes it for someone who runs caret
// themselves (EXC-1167). The choice is asked on every install at a terminal and saved
// nowhere, so an install nobody could ask leaves the machine as it found it.
// `--uninstall` stays its own entry point because it removes caret from every agent too.
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
 * working caret. Resolves to what `body` returned — undefined where there was no
 * supervisor to drive, or looking it up or driving it threw. */
async function withService<T>(
  deps: ServiceStepDeps,
  ui: InstallUI,
  body: (target: ServiceTarget) => Promise<T>,
): Promise<T | undefined> {
  if (deps.service === undefined) return undefined;
  try {
    return await body(deps.service());
  } catch (e) {
    ui.warn(
      `Could not update the caret service (${errorMessage(e)}) — caret still starts on demand.`,
    );
    return undefined;
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

/** `caret serve` from the published package — the same command README § Running caret
 * yourself documents. */
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
  const reviewUrl = `http://${VANITY_HOST}:${getPort(loadSettings())}`;
  if (opts.choice === "run-yourself") return runYourself({ ...opts, reviewUrl }, deps, ui);
  await withService(deps, ui, async (target) => {
    const { manager, label, visibleIn, optOutSurface, visibleToggleCaveat } = target;
    const status = await manager.status();
    if (status.unsupported) {
      ui.info(`Not registering the caret service: ${status.unsupported}.`);
      return;
    }
    if (opts.choice === "as-found" && !status.installed) {
      ui.info(
        "No caret service is registered — a `caret install` at a terminal, without `--dry-run`, asks whether caret keeps the review UI running.",
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

    // One short line per fact: clack draws its gutter only on explicit breaks.
    const announcement = [
      `The review UI now stays up at ${reviewUrl}`,
      `It's listed in ${visibleIn}.`,
      `To turn it off, run \`caret install\` and answer "I'll run it myself".`,
      visibleToggleCaveat,
    ];
    ui.info(announcement.filter(Boolean).join("\n"));
  });
}

/** Leave the review UI to the user: take down whatever service a previous install
 * registered, then say how to serve it by hand. */
async function runYourself(
  opts: { dryRun: boolean; pinnedRoot?: string; reviewUrl: string },
  deps: ServiceStepDeps,
  ui: InstallUI,
): Promise<void> {
  const removed = await withService(deps, ui, async ({ manager }) => {
    const status = await manager.status();
    if (status.unsupported) return false;
    if (opts.dryRun) {
      if (status.installed) ui.info("Would remove the caret service and the launcher it runs.");
      return false;
    }
    // Not gated on `installed`: on macOS that is loadedness, and a plist the launcher's
    // terminal exit booted out is still on disk to load at the next login. Both managers
    // tolerate a unit that is not there. The launcher goes with the unit: nothing but a
    // supervisor runs it.
    await manager.uninstall();
    uninstallLauncher();
    return status.installed;
  });
  // Outside withService, so a supervisor that cannot even be looked up still leaves the
  // user knowing how to reach the review UI.
  const serve =
    opts.pinnedRoot === undefined ? SERVE_COMMAND : `${opts.pinnedRoot}/bin/caret serve`;
  ui.info(
    `caret will not keep the review UI running${removed ? " — its service was removed" : ""}. Run \`${serve}\` in a terminal to keep it up at ${opts.reviewUrl} until you stop it with Ctrl+C; without it, caret still starts when your agent submits a plan.`,
  );
}

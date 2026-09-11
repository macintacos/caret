// The install step that makes a machine resident: it registers the platform unit that
// serves the review UI from login onward, and reconciles that against the user's
// persisted intent on every run (EXC-1167). An install and an uninstall share only the
// supervisor lookup and the never-fail shell, so each is its own entry point rather than
// a flag the other reads.
//
// Two facts are only reliably available here. `serviceEnvironment(process.env)` captures
// the shell's world-defining variables, which a supervisor-started daemon inherits none
// of; and installLauncher records the `bun` this install is running under when there is
// one — a compiled install records nothing and the launcher searches.
//
// Reconciliation runs in both directions. Intent off with a unit present tears the unit
// down: leaving it would have the supervised daemon read `resident = false`, idle-exit,
// and be respawned about once a minute.

import {
  type LauncherDeps,
  installLauncher as realInstallLauncher,
  uninstallLauncher,
} from "@/commands/install/launcher.ts";
import type { InstallUI } from "@/commands/install/ui.ts";
import type { ServiceTarget } from "@/commands/service-target.ts";
import { VANITY_HOST } from "@/config/constants.ts";
import { launcherPath } from "@/config/paths.ts";
import { writeDaemonResident } from "@/config/resident.ts";
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
  installLauncher?: (deps: LauncherDeps) => void;
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

/** Reconcile the caret service against the user's residency intent, in both directions,
 * reporting through `ui`. */
export async function reconcileService(
  opts: {
    dryRun: boolean;
    refresh: boolean;
    /** `--no-resident`, already inverted by the CLI. Sugar for the config key rather than
     * a per-invocation flag, so the next plain `--refresh` cannot overrule someone who
     * deliberately opted out. */
    resident: boolean;
  },
  deps: ServiceStepDeps,
  ui: InstallUI,
): Promise<void> {
  await withService(deps, ui, async ({ manager, label, optOutSurface }) => {
    if (!opts.resident && !opts.dryRun) {
      try {
        writeDaemonResident(false);
      } catch (e) {
        // Its own catch: withService's would report a supervisor that would not take the
        // unit, which is the opposite of what failed, and would leave the user believing
        // an opt-out persisted that the next `--refresh` will overrule.
        ui.warn(
          `Could not record the opt-out (${errorMessage(e)}) — set \`[daemon] resident = false\` in config.toml yourself, or a later install registers the service again.`,
        );
        return;
      }
    }
    const settings = loadSettings();
    // `--no-resident` short-circuits rather than reading the write back, so a dry run
    // previews the opt-out it would have persisted instead of the install it would not.
    const resident = opts.resident && settings.daemon.resident;

    const status = await manager.status();
    if (status.unsupported) {
      ui.info(`Not registering the caret service: ${status.unsupported}.`);
      return;
    }
    if (!resident) {
      // The launcher goes with the unit: what it records is the unit's name, and nothing
      // but a supervisor runs it.
      if (status.installed && !opts.dryRun) {
        await manager.uninstall();
        uninstallLauncher();
      }
      ui.info(
        `caret is not resident${status.installed ? `, so ${opts.dryRun ? "the service would be removed" : "its service was removed"}` : ""} — set \`[daemon] resident = true\` in config.toml to opt back in.`,
      );
      return;
    }
    if (status.disabled) {
      ui.info(`The caret service is turned off in ${optOutSurface} — leaving it that way.`);
      return;
    }
    if (opts.dryRun) {
      ui.info("Would install the caret service, so the review UI is up from login onward.");
      return;
    }

    // The unit names the launcher, so the launcher has to be there first.
    (deps.installLauncher ?? realInstallLauncher)({ serviceLabel: label });
    await manager.install({
      launcherPath: launcherPath(),
      label,
      workingDirectory: DAEMON_CWD,
      environment: serviceEnvironment(process.env),
      terminalExitStatus: SERVICE_TERMINAL_EXIT_STATUS,
    });
    // install() is a no-op on a unit that did not change, which is every upgrade: the
    // supervisor keeps running the old binary until it is cycled.
    if (opts.refresh) await manager.restart();

    ui.info(
      `The review UI is now always up at http://${VANITY_HOST}:${getPort(settings)} — it appears in ${optOutSurface}, and \`caret install --no-resident\` turns it off.`,
    );
  });
}

// The install step that makes a machine resident: it registers the platform unit that
// serves the review UI from login onward, and reconciles that against the user's
// persisted intent on every run (EXC-1167).
//
// Two facts are only reliably available here. `serviceEnvironment(process.env)` captures
// the shell's world-defining variables, which a supervisor-started daemon inherits none
// of; and installLauncher records the absolute `bun` running this install, which a
// compiled unit has no other way to find.
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
import { VANITY_HOST } from "@/config/constants.ts";
import { launcherPath } from "@/config/paths.ts";
import { writeDaemonResident } from "@/config/resident.ts";
import { getPort, loadSettings } from "@/config/settings.ts";
import { DAEMON_CWD } from "@/daemon/lifecycle.ts";
import { errorMessage } from "@/lib/types.ts";
import { SERVICE_LABELS, type ServicePlatform, selectServiceManager } from "@/service/index.ts";
import { createLaunchdManager } from "@/service/launchd-manager.ts";
import {
  SERVICE_TERMINAL_EXIT_STATUS,
  type ServiceManager,
  serviceEnvironment,
} from "@/service/manager.ts";
import { createSystemdManager } from "@/service/systemd-manager.ts";

/** The supervisor this machine installs under: what to drive, and the unit name that
 * manager accepts. */
export interface ServiceTarget {
  manager: ServiceManager;
  label: string;
}

export interface ServiceStepDeps {
  /** The supervisor to reconcile against, wired by src/cli.ts. A thunk because resolving
   * the platform throws on a host that is neither darwin nor linux — called inside this
   * step's own try/catch, that is one warning rather than a stack trace out of an
   * otherwise-clean install. Absent means there is no supervisor to reconcile and the
   * step does nothing: this is the one install step whose real effects tear a running
   * service down, so driving the machine's own launchd is something a caller opts into
   * rather than something a test has to remember to opt out of. */
  service?: () => ServiceTarget;
  installLauncher?: (deps: LauncherDeps) => void;
}

export interface ServiceStepOpts {
  uninstall: boolean;
  dryRun: boolean;
  refresh: boolean;
  /** `--no-resident`, already inverted by the CLI. Sugar for the config key rather than
   * a per-invocation flag, so the next plain `--refresh` cannot overrule someone who
   * deliberately opted out. */
  resident: boolean;
}

/** Register (or tear down) the caret service, reporting through `ui`. Every failure is a
 * warning: a machine that could not go resident still has a working caret. */
export async function serviceStep(
  opts: ServiceStepOpts,
  deps: ServiceStepDeps,
  ui: InstallUI,
): Promise<void> {
  if (deps.service === undefined) return;
  try {
    const { manager, label } = deps.service();

    if (opts.uninstall) {
      await manager.uninstall();
      uninstallLauncher();
      return;
    }

    if (!opts.resident && !opts.dryRun) writeDaemonResident(false);
    const settings = loadSettings();

    const status = await manager.status();
    if (status.unsupported) {
      ui.info(`Not registering the caret service: ${status.unsupported}.`);
      return;
    }
    if (!settings.daemon.resident) {
      if (status.installed && !opts.dryRun) await manager.uninstall();
      ui.info("caret is not resident — `caret install` on its own will not change that.");
      return;
    }
    if (status.disabled) {
      ui.info(`The caret service is turned off (${OPT_OUT_SURFACE}) — leaving it that way.`);
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
      `The review UI is now always up at http://${VANITY_HOST}:${getPort(settings)}${
        process.platform === "darwin" ? ` (${OPT_OUT_SURFACE})` : ""
      } — run \`caret install --no-resident\` to turn it off.`,
    );
  } catch (e) {
    ui.warn(
      `Could not register the caret service (${errorMessage(e)}) — caret still starts on demand.`,
    );
  }
}

/** Where the user turns the service off outside caret, which is also what they see the
 * moment it is registered: macOS posts its own "Background Items Added" notice. */
const OPT_OUT_SURFACE =
  process.platform === "darwin" ? "System Settings › Login Items" : "systemctl --user";

/** The running platform's manager and unit name. Both managers are constructed because
 * selectServiceManager takes the pair; construction only resolves paths and the uid. */
export function prodService(): ServiceTarget {
  const platform = process.platform;
  const manager = selectServiceManager(
    { darwin: createLaunchdManager(), linux: createSystemdManager() },
    platform,
  );
  // Unreachable for anything else: selectServiceManager threw on the line above.
  return { manager, label: SERVICE_LABELS[platform as ServicePlatform] };
}

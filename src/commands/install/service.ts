// The install step that makes a machine resident: it registers the platform unit that
// serves the review UI from login onward, or removes it for someone who runs caret
// themselves (EXC-1167). The choice is asked on every install at a terminal and saved
// nowhere, so an install nobody could ask leaves the machine as it found it.
// `--uninstall` stays its own entry point because it removes caret from every agent too.
//
// Three facts are only reliably available here. `serviceEnvironment(process.env)` captures
// the shell's world-defining variables, which a supervisor-started daemon inherits none
// of; installLauncher records the `bun` this install is running under when there is
// one — a compiled install records nothing and the launcher searches; and the installing
// root, which bunx deletes on exit, is still there for installLauncher to copy.

import {
  type LauncherDeps,
  type LauncherRoot,
  pruneOwnedRoots,
  installLauncher as realInstallLauncher,
  uninstallLauncher,
} from "@/commands/install/launcher.ts";
import type { InstallUI } from "@/commands/install/ui.ts";
import type { ServiceTarget } from "@/commands/service-target.ts";
import { daemonStderrLogFile, launcherPath } from "@/config/paths.ts";
import { getPort, loadSettings } from "@/config/settings.ts";
import { daemonBaseUrl, publicHostname } from "@/daemon/address.ts";
import { DaemonAuthError, httpHealth } from "@/daemon/client.ts";
import { DAEMON_CWD } from "@/daemon/lifecycle.ts";
import { VERSION } from "@/lib/build-id.ts";
import { isNewer } from "@/lib/semver.ts";
import { errorMessage, type HealthIdentity } from "@/lib/types.ts";
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
  /** What reads the port once the service is in place, wired by src/cli.ts. Absent means
   * nothing is probed and the install announces as-is: a test must not read whatever real
   * daemon holds the port. */
  watch?: ServiceWatch;
  /** What the launcher will start, answered the way bin/caret-launcher answers it — wired
   * by src/cli.ts. A root is named in a cycling install's announcement; `null` means
   * nothing is runnable, so the step warns and skips the restart; absent (or throwing),
   * the step carries on naming no root. The real one reads Claude's and OpenCode's
   * caches under the real HOME, which no test should. */
  launcherRoot?: () => LauncherRoot | null;
}

/** The installing caret's version and the probes that read what the port serves. */
export interface ServiceWatch {
  /** The installing caret's version — VERSION in prod. */
  version: string;
  health: (baseUrl: string) => Promise<HealthIdentity | null>;
  sleep: (ms: number) => Promise<void>;
}

/** The installing caret's own version and the live health probe. */
export function prodServiceWatch(): ServiceWatch {
  return { version: VERSION, health: httpHealth, sleep: Bun.sleep };
}

// Outlasts launchd's ~10 s respawn throttle, the launcher's two 5 s root retries, and the
// replaced daemon's drain. The real bound adds up to 500 ms per probe that times out.
const SETTLE_POLL_MS = 500;
const SETTLE_WINDOW_MS = 30_000;
const SETTLE_ATTEMPTS = SETTLE_WINDOW_MS / SETTLE_POLL_MS;

/** What the port served when the wait ended. */
type Served =
  /** The service's caret, at least as new as the installer. */
  | { kind: "ready"; version: string }
  /** The service's caret, older than the installer. */
  | { kind: "stale"; version: string }
  /** Only the instance the restart replaced still answers. */
  | { kind: "replaced"; version?: string }
  /** A caret the service did not start holds the port. */
  | { kind: "unsupervised"; version?: string }
  /** A caret refused the token. */
  | { kind: "unauthorized"; message: string }
  /** Nothing, or only a non-caret squatter. */
  | { kind: "silent" };

function classify(
  health: HealthIdentity | DaemonAuthError | null,
  installerVersion: string,
  replaced: string | undefined,
): Served {
  // The outgoing daemon refuses a shell with no token file yet while it drains.
  if (health instanceof DaemonAuthError) return { kind: "unauthorized", message: health.message };
  if (health?.service !== "caret") return { kind: "silent" };
  const answeringVersion = health.version;
  if (replaced !== undefined && health.instanceId === replaced) {
    return { kind: "replaced", version: answeringVersion };
  }
  // The predicate lifecycle.ts uses to recognise the service's daemon.
  if ((health.supervised ?? health.resident) !== true)
    return { kind: "unsupervised", version: answeringVersion };
  if (answeringVersion === undefined) return { kind: "silent" };
  return isNewer(installerVersion, answeringVersion)
    ? { kind: "stale", version: answeringVersion }
    : { kind: "ready", version: answeringVersion };
}

/** What one probe saw: caret's identity, null for nothing, or the token refusal. */
async function probe(
  baseUrl: string,
  watch: ServiceWatch,
): Promise<HealthIdentity | DaemonAuthError | null> {
  try {
    return await watch.health(baseUrl);
  } catch (e) {
    if (e instanceof DaemonAuthError) return e;
    throw e;
  }
}

/** Poll until the service's caret, at least as new as the installer and other than the
 * `replaced` instance a restart is draining, answers. Resolves to `ready` the moment one
 * does, else to what the last probe saw. */
async function awaitServed(
  baseUrl: string,
  watch: ServiceWatch,
  replaced: string | undefined,
): Promise<Served> {
  let served: Served = { kind: "silent" };
  for (let attempt = 0; attempt < SETTLE_ATTEMPTS; attempt++) {
    served = classify(await probe(baseUrl, watch), watch.version, replaced);
    if (served.kind === "ready") return served;
    await watch.sleep(SETTLE_POLL_MS);
  }
  return served;
}

/** The warning for a wait that ended on `served`, or null when the service is ready.
 * `cycled` says whether this install already restarted the service. */
function servedWarning(served: Served, installerVersion: string, cycled: boolean): string | null {
  const log = `Read ${daemonStderrLogFile()}; caret still starts on demand.`;
  const at = (v?: string) => (v === undefined ? "" : ` (caret ${v})`);
  switch (served.kind) {
    case "ready":
      return null;
    case "stale":
      return [
        `The caret service is serving caret ${served.version}, not ${installerVersion}.`,
        cycled ? undefined : "Run `caret install --refresh` to cycle it.",
        `If it persists, read ${daemonStderrLogFile()}.`,
      ]
        .filter(Boolean)
        .join("\n");
    case "replaced":
      return `The daemon the restart replaced${at(served.version)} is still answering.\n${log}`;
    case "unsupervised":
      return `A caret the service did not start${at(served.version)} holds the port.\nThe service takes over once it exits.`;
    case "unauthorized":
      return `${served.message.charAt(0).toUpperCase()}${served.message.slice(1)}.`;
    case "silent":
      return `No caret daemon answered within ${SETTLE_WINDOW_MS / 1000} seconds.\n${log}`;
  }
}

/** Wait for the service's caret to answer, warning when it does not. Resolves to whether
 * the install should announce the review UI. */
async function settleService(
  baseUrl: string,
  watch: ServiceWatch,
  replaced: string | undefined,
  cycled: boolean,
  ui: InstallUI,
): Promise<boolean> {
  const served = await ui.step(
    "Waiting for the caret service",
    () => awaitServed(baseUrl, watch, replaced),
    (s) => (s.kind === "ready" ? `caret ${s.version} answered` : "The caret service is not up yet"),
  );
  const warning = servedWarning(served, watch.version, cycled);
  if (warning !== null) ui.warn(warning);
  return warning === null;
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
  const s = loadSettings();
  const reviewUrl = `http://${publicHostname(s.daemon)}:${getPort(s)}`;
  const baseUrl = daemonBaseUrl(s);
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
    const nextRoot = predictLauncherRoot(deps);
    if (nextRoot === null) {
      // Cycling into nothing only makes the launcher exit or evict the service.
      ui.warn(
        "No runnable caret was found for the caret service to start — run `caret install` again once an agent has installed caret.",
      );
      return;
    }
    // install() is a no-op on an unchanged unit, so a new build or pin serves only once the
    // supervisor cycles. `--from-local` cycles even onto the same pin: hooks never cycle a
    // pinned daemon. Unpinning cycles because hooks attach to a checkout newer than them.
    const cycles = opts.refresh || opts.pinnedRoot !== undefined || unpinned;
    const { watch } = deps;
    // A draining daemon keeps answering until it lets the port go, so remember which
    // instance the restart replaces.
    const replaced =
      cycles && watch
        ? await probe(baseUrl, watch).then((h) =>
            h instanceof DaemonAuthError ? undefined : h?.instanceId,
          )
        : undefined;
    if (cycles) await manager.restart();
    // ponytail: a no-cycle install over an older daemon waits the full window before
    // warning; stop at the first answer when nothing cycled if that ever bites.
    const settled = !watch || (await settleService(baseUrl, watch, replaced, cycles, ui));
    // After the settle, the daemon the restart replaced no longer serves from its root.
    if (cycles) pruneOwnedRoots();
    if (!settled) return;

    // One short line per fact: clack draws its gutter only on explicit breaks.
    const announcement = [
      `The review UI now stays up at ${reviewUrl}`,
      // Only a cycle makes the prediction the serving caret; "ready" alone doesn't.
      cycles && nextRoot && `It starts caret ${nextRoot.version} from ${nextRoot.root}.`,
      `It's listed in ${visibleIn}.`,
      `To turn it off, run \`caret install\` and answer "I'll run it myself".`,
      visibleToggleCaveat,
    ];
    ui.info(announcement.filter(Boolean).join("\n"));
  });
}

/** The seam's prediction: a root, `null` when nothing is runnable (skip the restart), or
 * undefined when there is no prediction — no seam, or it threw. */
function predictLauncherRoot(deps: ServiceStepDeps): LauncherRoot | null | undefined {
  try {
    return deps.launcherRoot?.();
  } catch {
    // A bug in the prediction must never cost the restart.
    return undefined;
  }
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

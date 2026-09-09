// Which supervisor caret runs under. The managers arrive as an argument rather
// than an import so the platform decision stays in one place while the values come
// from the composition layer (EXC-1167) — the same shape prodReviewDeps uses to
// hand the core an adapter capability it names nowhere.

import { LAUNCHD_LABEL, type ServiceManager, SYSTEMD_UNIT } from "@/service/manager.ts";

export type ServicePlatform = "darwin" | "linux";

/** The unit name each platform's manager accepts and the launcher's `service` record
 * holds — the same platform decision selectServiceManager makes, over the other half
 * of what installing a unit needs. */
export const SERVICE_LABELS: Record<ServicePlatform, string> = {
  darwin: LAUNCHD_LABEL,
  linux: SYSTEMD_UNIT,
};

/** The manager for a platform, defaulting to the current process. Throws on anything
 * but darwin/linux — residency has no third implementation, and a silent no-op would
 * leave the caller believing caret is resident.
 *
 * The managers arrive as constructors so only the running platform's is built: the
 * launchd one throws without a POSIX uid, which on Windows would otherwise pre-empt the
 * unsupported-platform message with a launchd error. */
export function selectServiceManager(
  managers: Record<ServicePlatform, () => ServiceManager>,
  platform: string = process.platform,
): ServiceManager {
  if (platform !== "darwin" && platform !== "linux") {
    throw new Error(`caret service: unsupported platform ${platform} (darwin/linux only)`);
  }
  return managers[platform]();
}

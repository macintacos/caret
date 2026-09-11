// The platforms caret can run resident on, and the unit name each one's manager takes.
// Building a manager is the composition layer's job (src/commands/service-target.ts).

import { LAUNCHD_LABEL, SYSTEMD_UNIT } from "@/service/manager.ts";

export type ServicePlatform = "darwin" | "linux";

/** The unit name each platform's manager accepts, and what the launcher's `service`
 * record holds. */
export const SERVICE_LABELS: Record<ServicePlatform, string> = {
  darwin: LAUNCHD_LABEL,
  linux: SYSTEMD_UNIT,
};

/** The running platform, narrowed — or a throw naming it. Residency has no third
 * implementation, and a silent no-op would leave the caller believing caret is resident.
 * Callers that build a manager narrow first, so only the platform's own constructor runs:
 * the launchd one throws without a POSIX uid, which on Windows would otherwise pre-empt
 * this message with a launchd error. */
export function servicePlatform(platform: string = process.platform): ServicePlatform {
  if (platform !== "darwin" && platform !== "linux") {
    throw new Error(`caret service: unsupported platform ${platform} (darwin/linux only)`);
  }
  return platform;
}

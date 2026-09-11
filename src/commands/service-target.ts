// The running platform's supervisor, wired for the install steps and the hooks alike.

import { SERVICE_LABELS, type ServicePlatform, servicePlatform } from "@/service/index.ts";
import { createLaunchdManager } from "@/service/launchd-manager.ts";
import type { ServiceManager } from "@/service/manager.ts";
import { createSystemdManager } from "@/service/systemd-manager.ts";

/** The supervisor this machine installs under: what to drive, the unit name that manager
 * accepts, and where the user sees it outside caret. */
export interface ServiceTarget {
  manager: ServiceManager;
  label: string;
  /** Where the user turns this off themselves — Login Items on macOS, systemctl on Linux.
   * Carried here rather than branched on in the step, so the platform decision stays in
   * one place and both messages that name it are testable on either host. */
  optOutSurface: string;
}

/** Where each platform surfaces the service to the user — macOS posts its own
 * "Background Items Added" notice naming this the moment it is registered. */
const OPT_OUT_SURFACES: Record<ServicePlatform, string> = {
  darwin: "System Settings › Login Items",
  linux: "`systemctl --user`",
};

/** The running platform's supervisor. */
export function prodService(): ServiceTarget {
  const platform = servicePlatform();
  return {
    manager: platform === "darwin" ? createLaunchdManager() : createSystemdManager(),
    label: SERVICE_LABELS[platform],
    optOutSurface: OPT_OUT_SURFACES[platform],
  };
}

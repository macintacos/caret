// The platform supervisor as the composition layer builds it, shared by every subcommand
// that drives the service.

import { SERVICE_LABELS, type ServicePlatform, servicePlatform } from "@/service/index.ts";
import { createLaunchdManager } from "@/service/launchd-manager.ts";
import type { ServiceManager } from "@/service/manager.ts";
import { createSystemdManager } from "@/service/systemd-manager.ts";

/** The supervisor this machine installs under: what to drive, the unit name that manager
 * accepts, and the surfaces the install step names back to the user. Surfaces are fields
 * rather than a branch in the install step, so the platform decision stays in one place. */
export interface ServiceTarget {
  manager: ServiceManager;
  label: string;
  /** Where the user sees the service outside caret. */
  visibleIn: string;
  /** What status().disabled detected, so the message that leaves an opted-out service
   * alone names what turned it off rather than a switch that cannot undo it. */
  optOutSurface: string;
  /** Set where `visibleIn` offers a switch caret cannot read. */
  visibleToggleCaveat?: string;
}

/** How each platform's surfaces are named back to the user. */
export const SURFACES: Record<ServicePlatform, Omit<ServiceTarget, "manager" | "label">> = {
  darwin: {
    // macOS posts its own "Background Items Added" notice naming this the moment the unit
    // registers.
    visibleIn: "System Settings › Login Items",
    optOutSurface: "`launchctl disable`",
    visibleToggleCaveat:
      "The System Settings switch is not one caret can read: a later `caret install` registers the service again. `--no-resident` above is the off switch that sticks; `caret install --uninstall` removes caret from every agent and this machine.",
  },
  linux: {
    visibleIn: "`systemctl --user`",
    optOutSurface: "`systemctl --user`",
  },
};

/** The running platform's supervisor. */
export function prodService(): ServiceTarget {
  const platform = servicePlatform();
  return {
    manager: platform === "darwin" ? createLaunchdManager() : createSystemdManager(),
    label: SERVICE_LABELS[platform],
    ...SURFACES[platform],
  };
}

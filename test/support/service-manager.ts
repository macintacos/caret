// A ServiceManager that records what it was asked to do, for the suites that drive a
// supervisor without touching the machine's own launchd or systemd.
import type { ServiceConfig, ServiceManager, ServiceStatus } from "@/service/manager.ts";

export function fakeServiceManager(
  over: {
    /** Fields over a unit that is not installed, or the whole read. */
    status?: Partial<ServiceStatus> | ServiceManager["status"];
    restart?: ServiceManager["restart"];
    /** The caller's own list, to order these verbs against its other steps. */
    calls?: string[];
  } = {},
): {
  manager: ServiceManager;
  /** install / uninstall / restart, in call order — the verbs that change the machine. */
  calls: string[];
  statusReads: () => number;
  installedConfig: () => ServiceConfig | undefined;
} {
  const calls = over.calls ?? [];
  let statusReads = 0;
  let installedConfig: ServiceConfig | undefined;
  const { status, restart = async () => {} } = over;
  const readStatus =
    typeof status === "function"
      ? status
      : async () => ({
          installed: false,
          running: false,
          disabled: false,
          keepsAlive: false,
          ...status,
        });
  const manager: ServiceManager = {
    install: async (cfg) => {
      calls.push("install");
      installedConfig = cfg;
    },
    uninstall: async () => void calls.push("uninstall"),
    status: () => {
      statusReads++;
      return readStatus();
    },
    restart: () => {
      calls.push("restart");
      return restart();
    },
  };
  return { manager, calls, statusReads: () => statusReads, installedConfig: () => installedConfig };
}

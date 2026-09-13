// A ServiceManager that records what it was asked to do, and a ServiceTarget over it, for
// the suites that drive a supervisor without touching the machine's own launchd or systemd.
import type { ServiceTarget } from "@/commands/service-target.ts";
import type { ServiceConfig, ServiceManager, ServiceStatus } from "@/service/manager.ts";

export function fakeServiceManager(
  over: {
    /** Fields over a unit that is not installed — `keepsAlive` follows
     * `installed && !disabled` unless the case states it — or the whole read. */
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
      : async () => {
          const s = { installed: false, running: false, disabled: false, ...status };
          return { ...s, keepsAlive: status?.keepsAlive ?? (s.installed && !s.disabled) };
        };
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

/** A ServiceTarget over fakeServiceManager, wearing systemd's surfaces, with the fake's
 * recorders beside it — for the suites that drive the install steps. */
export function fakeServiceTarget(over: Parameters<typeof fakeServiceManager>[0] = {}) {
  const fake = fakeServiceManager(over);
  const target = (): ServiceTarget => ({
    manager: fake.manager,
    label: "caret.service",
    visibleIn: "`systemctl --user`",
    optOutSurface: "`systemctl --user`",
  });
  return { ...fake, target };
}

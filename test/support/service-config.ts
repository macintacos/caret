// A fixed ServiceConfig for the unit-file builder suites, so a test asserting a
// whole plist or unit file states only the field it is varying.
import {
  LAUNCHD_LABEL,
  SERVICE_TERMINAL_EXIT_STATUS,
  type ServiceConfig,
} from "@/service/manager.ts";

export function fakeServiceConfig(overrides: Partial<ServiceConfig> = {}): ServiceConfig {
  return {
    launcherPath: "/home/ada/.local/state/caret/bin/caret",
    label: LAUNCHD_LABEL,
    workingDirectory: "/",
    environment: {
      HOME: "/home/ada",
      XDG_STATE_HOME: "/home/ada/.local/state",
      CARET_SUPERVISED: "1",
    },
    terminalExitStatus: SERVICE_TERMINAL_EXIT_STATUS,
    ...overrides,
  };
}

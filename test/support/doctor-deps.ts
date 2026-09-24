// Happy-path fakes for every probe collectReport injects; each test overrides only what
// it exercises.
import { DEFAULTS } from "@/config/settings.ts";
import type { DoctorDeps } from "@/doctor/report.ts";

export function doctorDeps(over: Partial<DoctorDeps> = {}): DoctorDeps {
  return {
    now: () => new Date("2026-06-04T12:00:00.000Z"),
    version: "1.2.3",
    system: () => ({ platform: "darwin", os: "macos", arch: "arm64" }),
    install: () => ({ kind: "dev", binaryPath: "/bin/caret", bunVersion: "0.0.0" }),
    settings: () => DEFAULTS,
    configPath: "/cfg/config.toml",
    configExists: () => true,
    effective: () => ({
      port: 42718,
      idleMs: 60000,
      reviewTimeoutMs: 3600000,
      heartbeatMs: 8000,
    }),
    baseUrl: "http://localhost:42718",
    health: async () => ({ service: "caret", version: "1.2.3", build: "abc", commit: "def" }),
    serviceInstalled: () => false,
    readLock: () => ({ pid: 111, port: 42718, build: "abc", version: "1.2.3", startedAt: 9 }),
    readBootMarker: () => null,
    isPidAlive: () => true,
    listProcesses: () => [{ pid: 111, name: "caret-native" }],
    listReviewFiles: () => [{ id: "abcdef12-0000", status: "pending" }],
    readAgentInstallState: () => ({
      agent: "test-agent",
      pluginVersion: "0.0.3",
      pluginEnabled: true,
      hookInUserSettings: false,
    }),
    logStats: async (path: string) => ({ path, exists: true, size: 10, errors: 0, warns: 0 }),
    logErrorRecords: async () => [],
    logPaths: {
      caret: "/state/logs/caret.log",
      daemon: "/state/logs/daemon.log",
      daemonStderr: "/state/logs/daemon-stderr.log",
    },
    ...over,
  };
}

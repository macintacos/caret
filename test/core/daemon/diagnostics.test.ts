import { expect, test } from "bun:test";

import { buildDiagnostics, type DiagnosticsDeps } from "@/daemon/diagnostics.ts";
import { CENSOR } from "@/redact/core.ts";

/** Baseline deps; each test overrides only the surface it asserts on. */
function deps(over: Partial<DiagnosticsDeps> = {}): DiagnosticsDeps {
  return {
    now: () => 5000,
    startedAt: 1000,
    system: () => ({ platform: "darwin", arch: "arm64", runtime: "bun 1.2.0" }),
    settings: () => ({ logging: { level: "info" } }),
    configPath: "/home/u/.config/caret/config.toml",
    configExists: () => true,
    envOverrides: () => [],
    ...over,
  };
}

test("uptimeMs is now() minus startedAt", () => {
  expect(buildDiagnostics(deps({ now: () => 5000, startedAt: 1000 })).uptimeMs).toBe(4000);
});

test("system, config path/exists, and env pass through untouched", () => {
  const d = buildDiagnostics(
    deps({
      system: () => ({ platform: "linux", arch: "x64", runtime: "bun 1.2.0" }),
      configPath: "/etc/caret/config.toml",
      configExists: () => false,
      envOverrides: () => [{ name: "CARET_PORT", value: "6000" }],
    }),
  );
  expect(d.system).toEqual({ platform: "linux", arch: "x64", runtime: "bun 1.2.0" });
  expect(d.config.path).toBe("/etc/caret/config.toml");
  expect(d.config.exists).toBe(false);
  expect(d.config.env).toEqual([{ name: "CARET_PORT", value: "6000" }]);
});

test("the settings dump rides scrubGraph — a DENY_KEYS value is censored", () => {
  const d = buildDiagnostics(
    deps({ settings: () => ({ plan: "top secret", logging: { level: "warn" } }) }),
  );
  expect((d.settings as { plan: string }).plan).toBe(CENSOR);
  expect((d.settings as { logging: { level: string } }).logging.level).toBe("warn");
});

test("settings() is read on every call (reflects live hot-reload)", () => {
  let level = "info";
  const d = deps({ settings: () => ({ logging: { level } }) });
  const read = () => (buildDiagnostics(d).settings as { logging: { level: string } }).logging.level;
  expect(read()).toBe("info");
  level = "debug";
  expect(read()).toBe("debug");
});

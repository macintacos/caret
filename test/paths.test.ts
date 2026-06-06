import { expect, test } from "bun:test";
import pkg from "../package.json" with { type: "json" };
import { buildHash, configDir, configFile, daemonLock, stateDir, VERSION } from "../src/paths.ts";
import { homedir } from "node:os";
import { withEnv } from "./support/env.ts";

// The CARET_* accessor and invalidEnvVars tests moved to test/settings.test.ts
// with the EXC-430 accessors themselves.

test("VERSION reflects package.json (honest identity, not the stale 0.0.1 hardcode)", () => {
  expect(VERSION).toBe(pkg.version);
});

test("daemonLock resolves under stateDir and honors XDG_STATE_HOME", () => {
  withEnv({ XDG_STATE_HOME: "/tmp/caret-xdg-paths-test" }, () => {
    expect(daemonLock()).toBe(`${stateDir()}/daemon.lock`);
    expect(daemonLock()).toBe("/tmp/caret-xdg-paths-test/caret/daemon.lock");
  });
});

test("configDir honors XDG_CONFIG_HOME", () => {
  withEnv({ XDG_CONFIG_HOME: "/tmp/caret-xdg-config-test" }, () => {
    expect(configDir()).toBe("/tmp/caret-xdg-config-test/caret");
  });
});

test("configDir falls back to ~/.config/caret when XDG_CONFIG_HOME is unset", () => {
  withEnv({ XDG_CONFIG_HOME: undefined }, () => {
    expect(configDir()).toBe(`${homedir()}/.config/caret`);
  });
});

test("configFile resolves config.toml under configDir", () => {
  withEnv({ XDG_CONFIG_HOME: "/tmp/caret-xdg-config-test" }, () => {
    expect(configFile()).toBe(`${configDir()}/config.toml`);
    expect(configFile()).toBe("/tmp/caret-xdg-config-test/caret/config.toml");
  });
});

test("buildHash is stable for identical input and differs for changed input", () => {
  expect(buildHash("<html>a</html>")).toBe(buildHash("<html>a</html>"));
  expect(buildHash("<html>a</html>")).not.toBe(buildHash("<html>b</html>"));
});

test("buildHash returns 'no-ui' when the UI is undefined", () => {
  expect(buildHash(undefined)).toBe("no-ui");
});

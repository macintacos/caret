import { expect, test } from "bun:test";
import { homedir } from "node:os";
import { configDir, configFile, daemonLock, stateDir } from "../src/paths.ts";
import { withEnv } from "./support/env.ts";

// The CARET_* accessor and invalidEnvVars tests moved to test/settings.test.ts
// with the EXC-430 accessors themselves. The VERSION/buildHash identity tests
// live in test/build-id.test.ts alongside those symbols.

test("stateDir honors XDG_STATE_HOME and falls back to ~/.local/state/caret", () => {
  withEnv({ XDG_STATE_HOME: "/tmp/caret-xdg-state-test" }, () => {
    expect(stateDir()).toBe("/tmp/caret-xdg-state-test/caret");
  });
  withEnv({ XDG_STATE_HOME: undefined }, () => {
    expect(stateDir()).toBe(`${homedir()}/.local/state/caret`);
  });
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

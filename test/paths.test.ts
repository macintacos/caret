import { afterEach, beforeEach, expect, test } from "bun:test";
import pkg from "../package.json" with { type: "json" };
import {
  buildHash,
  configDir,
  configFile,
  daemonLock,
  heartbeatMs,
  reviewTimeoutMs,
  stateDir,
  VERSION,
} from "../src/paths.ts";
import { homedir } from "node:os";

let saved: string | undefined;
let savedHb: string | undefined;
beforeEach(() => {
  saved = process.env.CARET_TIMEOUT;
  savedHb = process.env.CARET_HEARTBEAT_MS;
  delete process.env.CARET_TIMEOUT;
  delete process.env.CARET_HEARTBEAT_MS;
});
afterEach(() => {
  if (saved === undefined) delete process.env.CARET_TIMEOUT;
  else process.env.CARET_TIMEOUT = saved;
  if (savedHb === undefined) delete process.env.CARET_HEARTBEAT_MS;
  else process.env.CARET_HEARTBEAT_MS = savedHb;
});

test("reviewTimeoutMs defaults to one hour when CARET_TIMEOUT is unset", () => {
  expect(reviewTimeoutMs()).toBe(3_600_000);
});

test("reviewTimeoutMs honors CARET_TIMEOUT (seconds → ms)", () => {
  process.env.CARET_TIMEOUT = "120";
  expect(reviewTimeoutMs()).toBe(120_000);
});

test("reviewTimeoutMs falls back to the default on a non-positive or invalid value", () => {
  for (const bad of ["0", "-5", "nope", ""]) {
    process.env.CARET_TIMEOUT = bad;
    expect(reviewTimeoutMs()).toBe(3_600_000);
  }
});

test("heartbeatMs defaults to 8s when CARET_HEARTBEAT_MS is unset", () => {
  expect(heartbeatMs()).toBe(8_000);
});

test("heartbeatMs honors a positive integer CARET_HEARTBEAT_MS", () => {
  process.env.CARET_HEARTBEAT_MS = "250";
  expect(heartbeatMs()).toBe(250);
});

test("heartbeatMs falls back to the default on a non-positive or invalid value", () => {
  for (const bad of ["0", "-1", "1.5", "nope", ""]) {
    process.env.CARET_HEARTBEAT_MS = bad;
    expect(heartbeatMs()).toBe(8_000);
  }
});

test("VERSION reflects package.json (honest identity, not the stale 0.0.1 hardcode)", () => {
  expect(VERSION).toBe(pkg.version);
});

test("daemonLock resolves under stateDir and honors XDG_STATE_HOME", () => {
  const savedXdg = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = "/tmp/caret-xdg-paths-test";
  try {
    expect(daemonLock()).toBe(`${stateDir()}/daemon.lock`);
    expect(daemonLock()).toBe("/tmp/caret-xdg-paths-test/caret/daemon.lock");
  } finally {
    if (savedXdg === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = savedXdg;
  }
});

test("configDir honors XDG_CONFIG_HOME", () => {
  const savedXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = "/tmp/caret-xdg-config-test";
  try {
    expect(configDir()).toBe("/tmp/caret-xdg-config-test/caret");
  } finally {
    if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = savedXdg;
  }
});

test("configDir falls back to ~/.config/caret when XDG_CONFIG_HOME is unset", () => {
  const savedXdg = process.env.XDG_CONFIG_HOME;
  delete process.env.XDG_CONFIG_HOME;
  try {
    expect(configDir()).toBe(`${homedir()}/.config/caret`);
  } finally {
    if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = savedXdg;
  }
});

test("configFile resolves config.toml under configDir", () => {
  const savedXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = "/tmp/caret-xdg-config-test";
  try {
    expect(configFile()).toBe(`${configDir()}/config.toml`);
    expect(configFile()).toBe("/tmp/caret-xdg-config-test/caret/config.toml");
  } finally {
    if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = savedXdg;
  }
});

test("buildHash is stable for identical input and differs for changed input", () => {
  expect(buildHash("<html>a</html>")).toBe(buildHash("<html>a</html>"));
  expect(buildHash("<html>a</html>")).not.toBe(buildHash("<html>b</html>"));
});

test("buildHash returns 'no-ui' when the UI is undefined", () => {
  expect(buildHash(undefined)).toBe("no-ui");
});

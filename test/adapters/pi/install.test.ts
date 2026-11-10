import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { piAgentDir, readPiInstallState, readPiSettings } from "@/adapters/pi/install.ts";

const FIXTURES = join(import.meta.dir, "fixtures", "install");
const UNKNOWN = {
  pluginVersion: "unknown",
  pluginEnabled: "unknown",
  hookInUserSettings: false,
} as const;

function invalidJsonAgentDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "caret-pi-install-"));
  writeFileSync(join(dir, "settings.json"), "{ not json");
  return dir;
}

test.each([
  ["npm-entry", "1.8.1", true],
  ["pinned-entry", "1.8.0", true],
  ["local-entry", "1.9.0", true],
  ["no-extensions", "1.8.1", false],
  ["no-entry", "unknown", false],
])("reads caret's install state from the %s fixture", (fixture, pluginVersion, pluginEnabled) => {
  expect(readPiInstallState(join(FIXTURES, fixture))).toEqual({
    pluginVersion,
    pluginEnabled,
    hookInUserSettings: false,
  });
});

test("degrades to unknown when settings.json is unreadable, malformed, or absent", () => {
  expect(readPiInstallState(join(FIXTURES, "unreadable"))).toEqual(UNKNOWN);
  expect(readPiInstallState(invalidJsonAgentDir())).toEqual(UNKNOWN);
  expect(readPiInstallState(mkdtempSync(join(tmpdir(), "caret-pi-install-")))).toEqual(UNKNOWN);
});

function localCheckout(root: string): string {
  const dir = join(root, "checkout");
  mkdirSync(dir);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "@macintacos/caret", version: "2.0.0" }),
  );
  return dir;
}

function agentDirWithSource(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), "caret-pi-agent-"));
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ packages: [source] }));
  return dir;
}

test("resolves a ~-prefixed local entry against the given home", () => {
  const home = mkdtempSync(join(tmpdir(), "caret-pi-home-"));
  localCheckout(home);
  expect(readPiInstallState(agentDirWithSource("~/checkout"), home)).toEqual({
    pluginVersion: "2.0.0",
    pluginEnabled: true,
    hookInUserSettings: false,
  });
});

test("resolves an absolute local entry as-is", () => {
  const checkout = localCheckout(mkdtempSync(join(tmpdir(), "caret-pi-abs-")));
  const home = mkdtempSync(join(tmpdir(), "caret-pi-home-"));
  expect(readPiInstallState(agentDirWithSource(checkout), home)).toEqual({
    pluginVersion: "2.0.0",
    pluginEnabled: true,
    hookInUserSettings: false,
  });
});

test("readPiSettings returns the parsed settings object, or null when unreadable", () => {
  expect(readPiSettings(join(FIXTURES, "npm-entry"))).toEqual({
    packages: ["npm:@macintacos/caret"],
  });
  expect(readPiSettings(join(FIXTURES, "unreadable"))).toBeNull();
  expect(readPiSettings(invalidJsonAgentDir())).toBeNull();
});

test("piAgentDir honours PI_CODING_AGENT_DIR with pi's tilde expansion", () => {
  const home = "/home/me";
  expect(piAgentDir({}, home)).toBe(join(home, ".pi", "agent"));
  expect(piAgentDir({ PI_CODING_AGENT_DIR: "" }, home)).toBe(join(home, ".pi", "agent"));
  expect(piAgentDir({ PI_CODING_AGENT_DIR: "~" }, home)).toBe(home);
  expect(piAgentDir({ PI_CODING_AGENT_DIR: "~/agents/pi" }, home)).toBe(join(home, "agents/pi"));
  expect(piAgentDir({ PI_CODING_AGENT_DIR: "/abs/dir" }, home)).toBe("/abs/dir");
});

import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readPiCaretEntries, readPiInstallState, readPiSettings } from "@/adapters/pi/install.ts";

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

test("readPiCaretEntries reads an unpinned npm entry", () => {
  const agentDir = join(FIXTURES, "npm-entry");
  expect(readPiCaretEntries(agentDir)).toEqual([
    {
      source: "npm:@macintacos/caret",
      dir: join(agentDir, "npm", "node_modules", "@macintacos", "caret"),
      version: "1.8.1",
      extensions: undefined,
      form: "npm",
      pinned: false,
    },
  ]);
});

test("readPiCaretEntries marks a versioned npm source as pinned", () => {
  expect(readPiCaretEntries(join(FIXTURES, "pinned-entry"))).toMatchObject([
    { source: "npm:@macintacos/caret@1.8.0", form: "npm", pinned: true, version: "1.8.0" },
  ]);
});

test("readPiCaretEntries resolves a relative local entry from the agent dir", () => {
  const agentDir = join(FIXTURES, "local-entry");
  expect(readPiCaretEntries(agentDir)).toMatchObject([
    { source: "./checkout", form: "local", dir: join(agentDir, "checkout"), version: "1.9.0" },
  ]);
});

test("readPiCaretEntries lists every caret entry in settings order, skipping others", () => {
  const checkout = localCheckout(mkdtempSync(join(tmpdir(), "caret-pi-abs-")));
  const agentDir = mkdtempSync(join(tmpdir(), "caret-pi-agent-"));
  writeFileSync(
    join(agentDir, "settings.json"),
    JSON.stringify({ packages: ["npm:pi-other-tools", "npm:@macintacos/caret", checkout] }),
  );
  expect(readPiCaretEntries(agentDir)).toMatchObject([
    { source: "npm:@macintacos/caret", form: "npm" },
    { source: checkout, form: "local", dir: checkout, version: "2.0.0" },
  ]);
});

test("readPiCaretEntries reports a null version when the listed npm package is missing", () => {
  const agentDir = agentDirWithSource("npm:@macintacos/caret");
  expect(readPiCaretEntries(agentDir)).toMatchObject([{ form: "npm", version: null }]);
  expect(readPiInstallState(agentDir)).toEqual({
    pluginVersion: "unknown",
    pluginEnabled: true,
    hookInUserSettings: false,
  });
});

test("readPiCaretEntries is empty when settings list no caret entry or can't be read", () => {
  expect(readPiCaretEntries(join(FIXTURES, "no-entry"))).toEqual([]);
  expect(readPiCaretEntries(join(FIXTURES, "unreadable"))).toEqual([]);
  expect(readPiCaretEntries(mkdtempSync(join(tmpdir(), "caret-pi-install-")))).toEqual([]);
});

test("readPiSettings returns the parsed settings object, or null when unreadable", () => {
  expect(readPiSettings(join(FIXTURES, "npm-entry"))).toEqual({
    packages: ["npm:@macintacos/caret"],
  });
  expect(readPiSettings(join(FIXTURES, "unreadable"))).toBeNull();
  expect(readPiSettings(invalidJsonAgentDir())).toBeNull();
});

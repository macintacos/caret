// The launcher installer's contract: the shipped script lands executable at the stable
// path a service unit names, and the `bun` it should prefer is recorded where the script
// looks for it. The source is a fixture, so none of this needs a resolvable caret root.

import { expect, test } from "bun:test";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { setupTempStateDir } from "@test/support/env.ts";
import { installLauncher, uninstallLauncher } from "@/commands/install/launcher.ts";
import {
  launcherBunFile,
  launcherPath,
  launcherRecordDir,
  launcherServiceFile,
  stateDir,
} from "@/config/paths.ts";

const xdgStateHome = setupTempStateDir("caret-launcher-");

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");
const SCRIPT = '#!/usr/bin/env bash\nexec caret "$@"\n';

/** A stand-in for the shipped bin/caret-launcher, written beside the state dir rather
 * than inside it so it never perturbs an assertion about what the install created. */
function shippedScript(): string {
  const path = join(xdgStateHome(), "caret-launcher");
  writeFileSync(path, SCRIPT);
  return path;
}

function perms(path: string): number {
  return statSync(path).mode & 0o777;
}

test("the launcher lands at the stable path, byte-for-byte and executable", () => {
  installLauncher({ bunPath: "/opt/bun/bin/bun", source: shippedScript });

  expect(readFileSync(launcherPath(), "utf8")).toBe(SCRIPT);
  // The fixture is written 0644, so this fails if the copy doesn't chmod.
  expect(perms(launcherPath())).toBe(0o755);
});

test("the install leaves no temp file beside the launcher it renamed into place", () => {
  installLauncher({ bunPath: "/opt/bun/bin/bun", source: shippedScript });

  expect(existsSync(`${launcherPath()}.${process.pid}.tmp`)).toBe(false);
});

test("bun-path records the given bun, newline-terminated for the launcher's `read -r`", () => {
  installLauncher({ bunPath: "/opt/bun/bin/bun", source: shippedScript });

  expect(readFileSync(launcherBunFile(), "utf8")).toBe("/opt/bun/bin/bun\n");
  expect(perms(launcherBunFile())).toBe(0o600);
});

test("bun-path defaults to the bun running the install", () => {
  // The suite runs under `bun test`, so argv[1] is a .ts entry — never the binary kind
  // that has no bun to record.
  installLauncher({ source: shippedScript });

  expect(readFileSync(launcherBunFile(), "utf8")).toBe(`${process.execPath}\n`);
});

test("both destinations sit under the state dir, which stays 0700", () => {
  installLauncher({ bunPath: "/opt/bun/bin/bun", source: shippedScript });

  expect(launcherPath().startsWith(`${stateDir()}/`)).toBe(true);
  expect(launcherBunFile().startsWith(`${stateDir()}/`)).toBe(true);
  expect(perms(stateDir())).toBe(0o700);
  expect(perms(dirname(launcherPath()))).toBe(0o700);
  expect(perms(launcherRecordDir())).toBe(0o700);
});

test("the service record names the unit, newline-terminated like bun-path", () => {
  installLauncher({
    bunPath: "/opt/bun/bin/bun",
    serviceLabel: "caret.service",
    source: shippedScript,
  });

  expect(readFileSync(launcherServiceFile(), "utf8")).toBe("caret.service\n");
  expect(perms(launcherServiceFile())).toBe(0o600);
});

test("an install naming no unit leaves no service record for the launcher to act on", () => {
  installLauncher({ bunPath: "/opt/bun/bin/bun", source: shippedScript });

  expect(existsSync(launcherServiceFile())).toBe(false);
});

test("uninstallLauncher removes the launcher and its records, leaving the state dir", () => {
  installLauncher({
    bunPath: "/opt/bun/bin/bun",
    serviceLabel: "caret.service",
    source: shippedScript,
  });

  uninstallLauncher();

  expect(existsSync(launcherPath())).toBe(false);
  expect(existsSync(launcherRecordDir())).toBe(false);
  expect(existsSync(stateDir())).toBe(true);
});

test("uninstallLauncher on a machine that never had one is not an error", () => {
  expect(() => uninstallLauncher()).not.toThrow();
});

test("the default source names a script this repo actually ships", () => {
  // Every other case injects a fixture, so nothing else would catch the shipped script
  // being renamed out from under the default.
  expect(existsSync(join(REPO_ROOT, "bin", "caret-launcher"))).toBe(true);
});

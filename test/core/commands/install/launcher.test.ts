// The launcher installer's contract: the shipped script lands executable at the stable
// path a service unit names, and the `bun` it should prefer is recorded where the script
// looks for it. The source is a fixture, so none of this needs a resolvable caret root.

import { expect, test } from "bun:test";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { setupTempStateDir } from "@test/support/env.ts";
import { installLauncher } from "@/commands/install/launcher.ts";
import { launcherBunFile, launcherPath, launcherRecordDir, stateDir } from "@/config/paths.ts";

const xdgStateHome = setupTempStateDir("caret-launcher-");

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
  installLauncher("/opt/bun/bin/bun", shippedScript());

  expect(readFileSync(launcherPath(), "utf8")).toBe(SCRIPT);
  // The fixture is written 0644, so this fails if the copy doesn't chmod.
  expect(perms(launcherPath())).toBe(0o755);
});

test("bun-path records the given bun, newline-terminated for the launcher's `read -r`", () => {
  installLauncher("/opt/bun/bin/bun", shippedScript());

  expect(readFileSync(launcherBunFile(), "utf8")).toBe("/opt/bun/bin/bun\n");
});

test("bun-path defaults to the bun running the install", () => {
  installLauncher(undefined, shippedScript());

  expect(readFileSync(launcherBunFile(), "utf8")).toBe(`${process.execPath}\n`);
});

test("both destinations sit under the state dir, which stays 0700", () => {
  installLauncher("/opt/bun/bin/bun", shippedScript());

  expect(launcherPath().startsWith(`${xdgStateHome()}/`)).toBe(true);
  expect(launcherBunFile().startsWith(`${xdgStateHome()}/`)).toBe(true);
  expect(perms(stateDir())).toBe(0o700);
  expect(perms(dirname(launcherPath()))).toBe(0o700);
  expect(perms(launcherRecordDir())).toBe(0o700);
});

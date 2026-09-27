// Each unit directory is spelled twice: the platform manager's default in TypeScript
// writes the unit there, and evict() in bin/caret-launcher deletes it from there in bash.
// Let them drift and a self-evicting launcher stops removing the file the manager wrote,
// leaving a unit the supervisor loads at every login. Only this suite makes the shell half
// falsifiable.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import {
  launcherPath,
  launcherPinnedRootFile,
  launcherRecordDir,
  launcherServiceFile,
  ownedRootsDir,
} from "@/config/paths.ts";

const LAUNCHER = readFileSync(join(import.meta.dir, "..", "..", "bin", "caret-launcher"), "utf8");

test("bin/caret-launcher removes the plist from the directory the manager writes it to", () => {
  expect(LAUNCHER).toContain("Library/LaunchAgents");
});

test("bin/caret-launcher removes the unit from the directory the manager writes it to", () => {
  expect(LAUNCHER).toContain("systemd/user");
});

test("bin/caret-launcher reads the service record the install writes", () => {
  expect(LAUNCHER).toContain(`$records/${basename(launcherServiceFile())}`);
});

test("bin/caret-launcher reads the pinned-root record the install writes", () => {
  expect(LAUNCHER).toContain(`$records/${basename(launcherPinnedRootFile())}`);
});

test("bin/caret-launcher's self-eviction removes what uninstallLauncher removes", () => {
  // Both delete the launcher, its records and the owned roots; evict() spells those
  // directories in bash, uninstallLauncher() derives them from paths.ts.
  expect(LAUNCHER).toContain(`\${state:?}/${basename(dirname(launcherPath()))}`);
  expect(LAUNCHER).toContain(`\${state:?}/${basename(launcherRecordDir())}`);
  expect(LAUNCHER).toContain(`\${state:?}/${basename(ownedRootsDir())}`);
});

test("bin/caret-launcher scans the owned roots caret install stages", () => {
  expect(LAUNCHER).toContain(`owned_roots="$state/${basename(ownedRootsDir())}"`);
  expect(LAUNCHER).toContain('"$owned_roots"/*');
});

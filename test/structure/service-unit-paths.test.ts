// Each unit directory is spelled twice: the platform manager's default in TypeScript
// writes the unit there, and evict() in bin/caret-launcher deletes it from there in bash.
// Let them drift and a self-evicting launcher stops removing the file the manager wrote,
// leaving a unit the supervisor loads at every login. Only this suite makes the shell half
// falsifiable.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const LAUNCHER = readFileSync(join(import.meta.dir, "..", "..", "bin", "caret-launcher"), "utf8");

test("bin/caret-launcher removes the plist from the directory the manager writes it to", () => {
  expect(LAUNCHER).toContain("Library/LaunchAgents");
});

test("bin/caret-launcher removes the unit from the directory the manager writes it to", () => {
  expect(LAUNCHER).toContain("systemd/user");
});

// The LaunchAgents directory is spelled twice: createLaunchdManager's default in
// TypeScript writes the plist there, and evict() in bin/caret-launcher deletes it from
// there in bash. Let them drift and a self-evicting launcher stops removing the file the
// manager wrote, leaving a plist launchd loads at every login. Only this suite makes the
// shell half falsifiable.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const LAUNCHER = join(import.meta.dir, "..", "..", "bin", "caret-launcher");

test("bin/caret-launcher removes the plist from the directory the manager writes it to", () => {
  expect(readFileSync(LAUNCHER, "utf8")).toContain("Library/LaunchAgents");
});

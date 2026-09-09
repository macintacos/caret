// The daemon's stderr destination is spelled twice: src/config/paths.ts resolves it in
// TypeScript, and bin/caret-launcher opens it in bash before any TypeScript can run. Let
// them drift and a supervised daemon writes somewhere its own rotation never visits and
// `caret redact` never finds. Only this suite makes the shell half falsifiable.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { withEnv } from "@test/support/env.ts";
import { daemonStderrLogFile } from "@/config/paths.ts";

const LAUNCHER = readFileSync(join(import.meta.dir, "..", "..", "bin", "caret-launcher"), "utf8");

const STATE_HOME = "/home/ada/.local/state";

test("bin/caret-launcher opens the path daemonStderrLogFile resolves", () => {
  withEnv({ XDG_STATE_HOME: STATE_HOME }, () => {
    const tail = daemonStderrLogFile().slice(`${STATE_HOME}/caret/`.length);
    expect(LAUNCHER).toContain(tail);
  });
});

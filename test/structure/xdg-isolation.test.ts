// The unit suite must never resolve caret's XDG dirs into the developer's home. A test
// that logs, or reads a config, without first calling setupTempStateDir writes to the
// real ~/.local/state/caret or reads the real ~/.config/caret — and nothing fails when it
// does, so the mistake survives review and keeps costing on every run.
//
// This file deliberately calls neither setupTempStateDir nor setupTempConfigFile: the
// floor it asserts is the one a suite gets for free, from the preload in bunfig.toml.

import { expect, test } from "bun:test";
import { homedir, tmpdir } from "node:os";

import { configDir, configFile, logFile, stateDir } from "@/config/paths.ts";

test("caret's state and config dirs resolve under tmpdir without a suite asking", () => {
  for (const path of [stateDir(), logFile(), configDir(), configFile()]) {
    expect(path).toStartWith(tmpdir());
  }
});

test("no caret path resolves into the developer's home", () => {
  for (const path of [stateDir(), logFile(), configDir(), configFile()]) {
    expect(path).not.toStartWith(homedir());
  }
});

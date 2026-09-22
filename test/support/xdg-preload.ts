// Test preload (registered in bunfig.toml's `[test] preload`): give every test process
// XDG roots under tmpdir, so caret's state and config dirs resolve away from the
// developer's own before a single suite is imported.
//
// This is a floor, not a replacement for setupTempStateDir / setupTempConfigFile — those
// still give per-test isolation, and a suite that writes something it later reads needs
// them. What the floor buys is that forgetting them costs a shared temp dir rather than
// the developer's real ~/.local/state/caret: an unisolated suite that logs an error
// appends to the live caret.log on every run, which nothing fails on and nobody sees.
//
// One fixed directory rather than mkdtemp per process: bun runs each test file in its own
// process and fires neither `exit` nor `beforeExit` in any of them, so a per-process dir
// would strand one per file on every run with nothing able to sweep them.
//
// An already-set root is left alone, so a harness that wants its own keeps it.

import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function redirectToTempDir(envVar: string, name: string): void {
  if (process.env[envVar] !== undefined) return;
  const dir = join(tmpdir(), "caret-test-xdg", name);
  mkdirSync(dir, { recursive: true });
  process.env[envVar] = dir;
}

redirectToTempDir("XDG_STATE_HOME", "state");
redirectToTempDir("XDG_CONFIG_HOME", "config");

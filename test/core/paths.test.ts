import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import {
  configDir,
  configFile,
  daemonLock,
  ensureStateDir,
  reviewsDir,
  stateDir,
} from "../../src/config/paths.ts";
import { setupTempStateDir, withEnv } from "../support/env.ts";

// The CARET_* accessor and invalidEnvVars tests live in settings.test.ts with
// the EXC-430 accessors themselves. The VERSION/buildHash identity tests live in
// build-id.test.ts alongside those symbols.

test("stateDir honors XDG_STATE_HOME and falls back to ~/.local/state/caret", () => {
  withEnv({ XDG_STATE_HOME: "/tmp/caret-xdg-state-test" }, () => {
    expect(stateDir()).toBe("/tmp/caret-xdg-state-test/caret");
  });
  withEnv({ XDG_STATE_HOME: undefined }, () => {
    expect(stateDir()).toBe(`${homedir()}/.local/state/caret`);
  });
});

test("daemonLock resolves under stateDir and honors XDG_STATE_HOME", () => {
  withEnv({ XDG_STATE_HOME: "/tmp/caret-xdg-paths-test" }, () => {
    expect(daemonLock()).toBe(`${stateDir()}/daemon.lock`);
    expect(daemonLock()).toBe("/tmp/caret-xdg-paths-test/caret/daemon.lock");
  });
});

test("configDir honors XDG_CONFIG_HOME", () => {
  withEnv({ XDG_CONFIG_HOME: "/tmp/caret-xdg-config-test" }, () => {
    expect(configDir()).toBe("/tmp/caret-xdg-config-test/caret");
  });
});

test("configDir falls back to ~/.config/caret when XDG_CONFIG_HOME is unset", () => {
  withEnv({ XDG_CONFIG_HOME: undefined }, () => {
    expect(configDir()).toBe(`${homedir()}/.config/caret`);
  });
});

test("configFile resolves config.toml under configDir", () => {
  withEnv({ XDG_CONFIG_HOME: "/tmp/caret-xdg-config-test" }, () => {
    expect(configFile()).toBe(`${configDir()}/config.toml`);
    expect(configFile()).toBe("/tmp/caret-xdg-config-test/caret/config.toml");
  });
});

// --- state-dir mode enforcement (EXC-539) ---

// Stat the low 9 permission bits, masking off the file-type/sticky bits so a
// dir-umask quirk in CI can't perturb the assertion.
function perms(path: string): number {
  return statSync(path).mode & 0o777;
}

describe("ensureStateDir", () => {
  // Side effect only: wires a fresh XDG_STATE_HOME per test so stateDir()/
  // reviewsDir() resolve under a temp dir wiped at teardown.
  setupTempStateDir("caret-ensure-");

  test("creates the state dir at 0700", () => {
    ensureStateDir();
    expect(perms(stateDir())).toBe(0o700);
  });

  test("creates a child (reviewsDir) at 0700 and tightens the root too", () => {
    ensureStateDir(reviewsDir());
    expect(perms(reviewsDir())).toBe(0o700);
    expect(perms(stateDir())).toBe(0o700);
  });

  test("tightens an already-existing 0755 state dir (closes the create-order race)", () => {
    // Simulate a no-mode caller (prefs/lock/spawn) winning the race: the root is
    // created first, then forced to 0755 (chmod, not mkdir-mode, so the
    // precondition holds regardless of the runner's umask).
    mkdirSync(stateDir(), { recursive: true });
    chmodSync(stateDir(), 0o755);
    expect(perms(stateDir())).toBe(0o755);
    // ensureStateDir must chmod the pre-existing dir down — recursive mkdir alone
    // would leave it 0755. This assertion FAILS if the helper omits the chmod.
    ensureStateDir(reviewsDir());
    expect(perms(stateDir())).toBe(0o700);
  });
});

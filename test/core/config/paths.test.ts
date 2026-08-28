import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";

import { setupTempStateDir, withEnv } from "@test/support/env.ts";
import {
  configDir,
  configFile,
  daemonLock,
  daemonLogFile,
  daemonStderrLogFile,
  devConfigFile,
  ensureLogsDir,
  ensureStateDir,
  logArchiveDir,
  logFile,
  logsDir,
  reviewsDir,
  stateDir,
  updateCheckFile,
} from "@/config/paths.ts";

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

test("updateCheckFile resolves under stateDir, beside prefs.json", () => {
  withEnv({ XDG_STATE_HOME: "/tmp/caret-xdg-paths-test" }, () => {
    expect(updateCheckFile()).toBe(`${stateDir()}/update-check.json`);
  });
});

test("the live logs resolve under a logs/ dir inside stateDir (EXC-1068)", () => {
  withEnv({ XDG_STATE_HOME: "/tmp/caret-xdg-paths-test" }, () => {
    expect(logsDir()).toBe(`${stateDir()}/logs`);
    expect(logArchiveDir()).toBe(`${stateDir()}/logs/archive`);
    expect(logFile()).toBe(`${stateDir()}/logs/caret.log`);
    expect(daemonLogFile()).toBe(`${stateDir()}/logs/daemon.log`);
    expect(daemonStderrLogFile()).toBe(`${stateDir()}/logs/daemon-stderr.log`);
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
  withEnv({ CARET_CONFIG_FILE: undefined, XDG_CONFIG_HOME: "/tmp/caret-xdg-config-test" }, () => {
    expect(configFile()).toBe(`${configDir()}/config.toml`);
    expect(configFile()).toBe("/tmp/caret-xdg-config-test/caret/config.toml");
  });
});

test("configFile honors CARET_CONFIG_FILE, treating a blank value as unset", () => {
  // The dev task points this at config.dev.toml (and, under --fresh, at a
  // nonexistent path so loadSettings falls back to defaults).
  withEnv({ CARET_CONFIG_FILE: "/tmp/caret-alt/config.dev.toml" }, () => {
    expect(configFile()).toBe("/tmp/caret-alt/config.dev.toml");
  });
  withEnv({ CARET_CONFIG_FILE: "", XDG_CONFIG_HOME: "/tmp/caret-xdg-config-test" }, () => {
    expect(configFile()).toBe("/tmp/caret-xdg-config-test/caret/config.toml");
  });
});

test("devConfigFile resolves config.dev.toml under configDir", () => {
  withEnv({ XDG_CONFIG_HOME: "/tmp/caret-xdg-config-test" }, () => {
    expect(devConfigFile()).toBe("/tmp/caret-xdg-config-test/caret/config.dev.toml");
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

// --- logs/ dir + the one-time move off the legacy top-level paths (EXC-1068) ---

describe("ensureLogsDir", () => {
  setupTempStateDir("caret-logsdir-");

  test("creates logs/ at 0700 and tightens the state dir", () => {
    ensureLogsDir();
    expect(perms(logsDir())).toBe(0o700);
    expect(perms(stateDir())).toBe(0o700);
  });

  test("moves a legacy top-level caret.log/daemon.log into logs/ at 0600", () => {
    mkdirSync(stateDir(), { recursive: true });
    writeFileSync(`${stateDir()}/caret.log`, "hook records\n", { mode: 0o644 });
    writeFileSync(`${stateDir()}/daemon.log`, "daemon records\n", { mode: 0o644 });

    ensureLogsDir();

    expect(existsSync(`${stateDir()}/caret.log`)).toBe(false);
    expect(existsSync(`${stateDir()}/daemon.log`)).toBe(false);
    expect(Bun.file(logFile()).text()).resolves.toBe("hook records\n");
    expect(Bun.file(daemonLogFile()).text()).resolves.toBe("daemon records\n");
    expect(perms(logFile())).toBe(0o600);
    expect(perms(daemonLogFile())).toBe(0o600);
  });

  test("leaves an already-migrated log alone when both copies exist", async () => {
    mkdirSync(logsDir(), { recursive: true });
    writeFileSync(`${stateDir()}/caret.log`, "stale legacy\n");
    writeFileSync(logFile(), "live records\n");

    ensureLogsDir();

    expect(await Bun.file(logFile()).text()).toBe("live records\n");
  });

  test("is a no-op when there is nothing to migrate", () => {
    ensureLogsDir();
    ensureLogsDir();
    expect(existsSync(logFile())).toBe(false);
    expect(perms(logsDir())).toBe(0o700);
  });
});

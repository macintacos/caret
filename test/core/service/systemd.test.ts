import { expect, test } from "bun:test";

import { fakeServiceConfig } from "@test/support/service-config.ts";
import { serviceEnvironment } from "@/service/manager.ts";
import { buildSystemdUnit } from "@/service/systemd.ts";

test("buildSystemdUnit emits the whole user unit", () => {
  expect(buildSystemdUnit(fakeServiceConfig())).toBe(`[Unit]
Description=caret review daemon
After=default.target
StartLimitIntervalSec=60
StartLimitBurst=5

[Service]
Type=simple
ExecStart="/home/ada/.local/state/caret/bin/caret" "daemon"
WorkingDirectory=/
Restart=always
RestartSec=5
RestartPreventExitStatus=78
StandardOutput=append:/home/ada/.local/state/caret/logs/daemon-stderr.log
StandardError=append:/home/ada/.local/state/caret/logs/daemon-stderr.log
Environment="CARET_SUPERVISED=1"
Environment="HOME=/home/ada"
Environment="XDG_STATE_HOME=/home/ada/.local/state"

[Install]
WantedBy=default.target
`);
});

test("buildSystemdUnit takes RestartPreventExitStatus from the config", () => {
  expect(buildSystemdUnit(fakeServiceConfig({ terminalExitStatus: 42 }))).toContain(
    "RestartPreventExitStatus=42",
  );
});

test("buildSystemdUnit emits one Environment line per entry, in a stable order", () => {
  const unit = buildSystemdUnit(
    fakeServiceConfig({ environment: { ZULU: "z", ALPHA: "a", MIKE: "m" } }),
  );
  expect(unit.split("\n").filter((line) => line.startsWith("Environment="))).toEqual([
    'Environment="ALPHA=a"',
    'Environment="MIKE=m"',
    'Environment="ZULU=z"',
  ]);
});

test("buildSystemdUnit quotes command words and environment assignments", () => {
  const unit = buildSystemdUnit(
    fakeServiceConfig({
      launcherPath: "/opt/my caret/bin/caret",
      environment: { CARET_CONFIG_FILE: 'C:\\caret\\"conf".toml' },
    }),
  );
  expect(unit).toContain('ExecStart="/opt/my caret/bin/caret" "daemon"');
  expect(unit).toContain('Environment="CARET_CONFIG_FILE=C:\\\\caret\\\\\\"conf\\".toml"');
});

test("buildSystemdUnit doubles % specifiers at every emission site", () => {
  const unit = buildSystemdUnit(
    fakeServiceConfig({
      launcherPath: "/opt/50%off/bin/caret",
      logPath: "/var/log/50%off.log",
      workingDirectory: "/srv/50%off",
      environment: { HOME: "/home/50%off" },
    }),
  );
  // systemd resolves %-specifiers before anything else and quoting does not suppress
  // it, so an unescaped % either expands or fails the whole unit load.
  expect(unit).toContain('ExecStart="/opt/50%%off/bin/caret" "daemon"');
  expect(unit).toContain("WorkingDirectory=/srv/50%%off");
  expect(unit).toContain("StandardOutput=append:/var/log/50%%off.log");
  expect(unit).toContain("StandardError=append:/var/log/50%%off.log");
  expect(unit).toContain('Environment="HOME=/home/50%%off"');
});

test("buildSystemdUnit doubles $ only in ExecStart, where systemd expands it", () => {
  const unit = buildSystemdUnit(
    fakeServiceConfig({
      launcherPath: "/opt/$HOME/bin/caret",
      environment: { CARET_CONFIG_FILE: "/tmp/$literal.toml" },
    }),
  );
  expect(unit).toContain('ExecStart="/opt/$$HOME/bin/caret" "daemon"');
  expect(unit).toContain('Environment="CARET_CONFIG_FILE=/tmp/$literal.toml"');
});

test("buildSystemdUnit escapes a newline rather than ending the directive", () => {
  const unit = buildSystemdUnit(
    fakeServiceConfig({ environment: { X: "a\nExecStartPre=/bin/sh -c evil" } }),
  );
  expect(unit).toContain('Environment="X=a\\nExecStartPre=/bin/sh -c evil"');
  expect(unit.split("\n").filter((line) => line.startsWith("ExecStartPre="))).toEqual([]);
});

test("buildSystemdUnit carries every variable serviceEnvironment captured", () => {
  const shell = {
    HOME: "/home/ada",
    CLAUDE_CONFIG_DIR: "/home/ada/.claude-alt",
    XDG_STATE_HOME: "/home/ada/.local/state",
    XDG_CACHE_HOME: "/home/ada/.cache",
    XDG_DATA_HOME: "/home/ada/.local/share",
  };
  const unit = buildSystemdUnit(fakeServiceConfig({ environment: serviceEnvironment(shell) }));
  for (const [key, value] of Object.entries(shell)) {
    expect(unit).toContain(`Environment="${key}=${value}"`);
  }
  expect(unit).toContain('Environment="CARET_SUPERVISED=1"');
});

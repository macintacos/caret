import { expect, test } from "bun:test";

import { fakeServiceConfig } from "@test/support/service-config.ts";
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

test("buildSystemdUnit quotes values that would otherwise break systemd's parser", () => {
  const unit = buildSystemdUnit(
    fakeServiceConfig({
      launcherPath: "/opt/my caret/bin/caret",
      environment: { CARET_CONFIG_FILE: 'C:\\caret\\"conf".toml' },
    }),
  );
  expect(unit).toContain('ExecStart="/opt/my caret/bin/caret" "daemon"');
  expect(unit).toContain('Environment="CARET_CONFIG_FILE=C:\\\\caret\\\\\\"conf\\".toml"');
});

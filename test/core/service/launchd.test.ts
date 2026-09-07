import { expect, test } from "bun:test";

import { fakeServiceConfig } from "@test/support/service-config.ts";
import { buildLaunchdPlist } from "@/service/launchd.ts";

test("buildLaunchdPlist emits the whole agent definition", () => {
  expect(buildLaunchdPlist(fakeServiceConfig())).toBe(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>dev.excessive.caret</string>
  <key>ProgramArguments</key>
  <array>
    <string>/home/ada/.local/state/caret/bin/caret</string>
    <string>daemon</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>WorkingDirectory</key>
  <string>/</string>
  <key>StandardOutPath</key>
  <string>/home/ada/.local/state/caret/logs/daemon-stderr.log</string>
  <key>StandardErrorPath</key>
  <string>/home/ada/.local/state/caret/logs/daemon-stderr.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>CARET_SUPERVISED</key>
    <string>1</string>
    <key>HOME</key>
    <string>/home/ada</string>
    <key>XDG_STATE_HOME</key>
    <string>/home/ada/.local/state</string>
  </dict>
</dict>
</plist>
`);
});

test("buildLaunchdPlist starts the launcher with the shared service arguments", () => {
  const plist = buildLaunchdPlist(fakeServiceConfig({ launcherPath: "/opt/caret/bin/caret" }));
  expect(plist).toContain(
    "  <array>\n    <string>/opt/caret/bin/caret</string>\n    <string>daemon</string>\n  </array>",
  );
});

test("buildLaunchdPlist escapes XML metacharacters everywhere they can appear", () => {
  const plist = buildLaunchdPlist(
    fakeServiceConfig({
      logPath: "/tmp/a&b/<log>.log",
      environment: { CARET_CONFIG_FILE: "/tmp/x&y/<c>.toml" },
    }),
  );
  expect(plist).toContain("<string>/tmp/a&amp;b/&lt;log&gt;.log</string>");
  expect(plist).toContain("<string>/tmp/x&amp;y/&lt;c&gt;.toml</string>");
  expect(plist).not.toContain("a&b");
  expect(plist).not.toContain("<log>");
  expect(plist).not.toContain("<c>");
});

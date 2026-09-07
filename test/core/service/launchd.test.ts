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

test("buildLaunchdPlist escapes XML metacharacters at every emission site", () => {
  const plist = buildLaunchdPlist(
    fakeServiceConfig({
      label: "dev.excessive.caret<&>",
      launcherPath: "/tmp/a&b/<bin>/caret",
      logPath: "/tmp/a&b/<log>.log",
      workingDirectory: "/tmp/a&b/<wd>",
      environment: { "A&B<C>": "/tmp/x&y/<c>.toml" },
    }),
  );
  expect(plist).toContain("<string>dev.excessive.caret&lt;&amp;&gt;</string>");
  expect(plist).toContain("<string>/tmp/a&amp;b/&lt;bin&gt;/caret</string>");
  expect(plist).toContain("<string>/tmp/a&amp;b/&lt;log&gt;.log</string>");
  expect(plist).toContain("<string>/tmp/a&amp;b/&lt;wd&gt;</string>");
  expect(plist).toContain("<key>A&amp;B&lt;C&gt;</key>");
  expect(plist).toContain("<string>/tmp/x&amp;y/&lt;c&gt;.toml</string>");
  // Nothing survives raw: an unescaped `&` alone is a plist launchd will not parse.
  expect(plist).not.toMatch(/&(?!amp;|lt;|gt;)/);
  expect(plist.split("\n").filter((line) => /<(bin|log|wd|C)>/.test(line))).toEqual([]);
});

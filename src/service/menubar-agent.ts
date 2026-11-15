// The menubar app's LaunchAgent: its plist text and the launchctl I/O that loads it. A
// job of its own, separate from the service's, so a Quit of the app never touches the
// daemon.

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { commandError } from "@/lib/run.ts";
import { escapeXml, stringEntry } from "@/service/launchd.ts";
import { type LaunchdDeps, RUNNING, spawnLaunchctl } from "@/service/launchd-manager.ts";
import { unitUnchanged } from "@/service/unit-file.ts";

/** The menubar app's LaunchAgent label — its CFBundleIdentifier (menubar/Info.plist), and
 * never LAUNCHD_LABEL. */
export const MENUBAR_LABEL = "dev.excessive.caret.menubar";

/** Whether this host runs the menubar app: macOS 13 (Darwin 22) or later, the bundle's
 * LSMinimumSystemVersion. `release` is os.release(). */
export function menubarSupported(platform: string, release: string): boolean {
  return platform === "darwin" && Number.parseInt(release, 10) >= 22;
}

/** What the LaunchAgent starts: the copied app's executable and its three flags. */
export interface MenubarLaunch {
  executable: string;
  baseUrl: string;
  reviewUrl: string;
  tokenFile: string;
}

/** The LaunchAgent plist for `launch`. KeepAlive on a failed exit only, so a crash
 * relaunches the app and a Quit sticks until the next login. */
export function buildMenubarPlist(launch: MenubarLaunch): string {
  const args = [
    launch.executable,
    "--base-url",
    launch.baseUrl,
    "--review-url",
    launch.reviewUrl,
    "--token-file",
    launch.tokenFile,
  ]
    .map((arg) => `    <string>${escapeXml(arg)}</string>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${stringEntry("Label", MENUBAR_LABEL, "  ")}
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
${stringEntry("LimitLoadToSessionType", "Aqua", "  ")}
${stringEntry("ProcessType", "Interactive", "  ")}
</dict>
</plist>
`;
}

/** Whether install() may start a stopped app: "start" for a yes, "leave-stopped" for a
 * refresh that leaves the app as found, so a Quit sticks until the next login. */
export type MenubarStart = "start" | "leave-stopped";

export interface MenubarAgent {
  /** Whether the LaunchAgent's plist is on disk — a Quit leaves it installed. */
  installed(): boolean;
  /** Write a changed plist, and reload the job unless it is running an unchanged one or
   * `start` is "leave-stopped" and it is stopped. Loading starts the app. */
  install(launch: MenubarLaunch, start: MenubarStart): Promise<void>;
  /** Stop the app and remove its plist. Idempotent. */
  uninstall(): Promise<void>;
}

export function createMenubarAgent(deps: LaunchdDeps = {}): MenubarAgent {
  const launchAgentsDir = deps.launchAgentsDir ?? join(homedir(), "Library", "LaunchAgents");
  const launchctl = deps.launchctl ?? spawnLaunchctl;
  const uid = deps.uid ?? process.getuid?.();
  if (uid === undefined) throw new Error("caret menubar: launchd needs a POSIX uid");
  const domain = `gui/${uid}`;
  const target = `${domain}/${MENUBAR_LABEL}`;
  const plistPath = join(launchAgentsDir, `${MENUBAR_LABEL}.plist`);

  return {
    installed: () => existsSync(plistPath),

    async install(launch, start) {
      const text = buildMenubarPlist(launch);
      const changed = !unitUnchanged(plistPath, text);
      const printed = await launchctl(["print", target]);
      const running = printed.code === 0 && RUNNING.some((p) => p.test(printed.stdout));
      if (!changed && running) return;

      if (changed) {
        mkdirSync(launchAgentsDir, { recursive: true });
        writeFileSync(plistPath, text);
      }
      if (!running && start === "leave-stopped") return;

      // Best-effort, ahead of bootstrap, as the service's install does.
      await launchctl(["bootout", target]);
      const bootstrapped = await launchctl(["bootstrap", domain, plistPath]);
      if (bootstrapped.code !== 0) throw commandError("launchctl", "bootstrap", bootstrapped);
    },

    async uninstall() {
      await launchctl(["bootout", target]);
      rmSync(plistPath, { force: true });
    },
  };
}

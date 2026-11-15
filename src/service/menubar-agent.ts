// The menubar app's LaunchAgent: its plist text and the launchctl I/O that loads it. A
// job of its own, separate from the service's, so a Quit of the app never touches the
// daemon.

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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

/** What the LaunchAgent starts — the copied app's executable and its three flags — and
 * where its stderr goes. */
export interface MenubarLaunch {
  executable: string;
  baseUrl: string;
  reviewUrl: string;
  tokenFile: string;
  stderrLog: string;
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
${stringEntry("StandardErrorPath", launch.stderrLog, "  ")}
</dict>
</plist>
`;
}

/** Whether install() may start a stopped app: "start" for a yes, "leave-stopped" for a
 * refresh that leaves the app as found, so a Quit sticks until the next login. */
export type MenubarStart = "start" | "leave-stopped";

/** What install() left launchd doing: "unchanged" (already running this plist),
 * "reloaded" (booted out and bootstrapped onto it), or "deferred" (plist written, the
 * stopped job left alone until the next login). */
export type MenubarInstallOutcome = "unchanged" | "reloaded" | "deferred";

export interface MenubarAgent {
  /** Whether the LaunchAgent's plist is on disk — a Quit leaves it installed. */
  installed(): boolean;
  /** Write a changed plist, and reload the job unless it is running an unchanged one or
   * `start` is "leave-stopped" and it is stopped. Loading starts the app. A "start" is
   * never "deferred". */
  install(launch: MenubarLaunch, start: MenubarStart): Promise<MenubarInstallOutcome>;
  /** Stop the app and remove its plist. Idempotent. */
  uninstall(): Promise<void>;
}

/** The menubar app's LaunchAgent, driven over launchctl in the gui/<uid> domain. Throws
 * without a POSIX uid. */
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
      if (!changed && running) return "unchanged";

      if (changed) {
        mkdirSync(launchAgentsDir, { recursive: true });
        writeFileSync(plistPath, text);
      }
      if (!running && start === "leave-stopped") return "deferred";

      // Best-effort, ahead of bootstrap, as the service's install does.
      await launchctl(["bootout", target]);
      const { code, stderr } = await launchctl(["bootstrap", domain, plistPath]);
      if (code !== 0) {
        throw new Error(`caret menubar: launchctl bootstrap failed (${code}): ${stderr.trim()}`);
      }
      return "reloaded";
    },

    async uninstall() {
      // Best-effort: nothing loaded is the ordinary case.
      await launchctl(["bootout", target]);
      rmSync(plistPath, { force: true });
    },
  };
}

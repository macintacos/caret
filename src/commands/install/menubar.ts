// The install step that shows caret's menubar app: copies the shipped bundle into caret's
// state directory and loads a LaunchAgent of its own that starts it at login. It follows
// the service step's shapes — asked at a terminal, left as found when nobody was asked.

import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

import { resolveCaretRoot } from "@/adapters/opencode/packaging.ts";
import type { InstallUI } from "@/commands/install/ui.ts";
import { daemonTokenFile, ensureStateDir, menubarDir } from "@/config/paths.ts";
import { getPort, loadSettings } from "@/config/settings.ts";
import { daemonBaseUrl, isExposed, publicUrl } from "@/daemon/address.ts";
import { errorMessage } from "@/lib/types.ts";
import type { MenubarAgent } from "@/service/menubar-agent.ts";

// Keep in sync with menubar/Info.plist CFBundleExecutable and the build's MENUBAR_APP.
const APP_NAME = "caret-menubar.app";
const EXECUTABLE = "Contents/MacOS/CaretMenubar";

export type MenubarChoice = "yes" | "no" | "as-found";

export interface MenubarStepDeps {
  /** The menubar app's LaunchAgent, wired by src/cli.ts on macOS 13 or later. Absent —
   * another platform, an older macOS, or a test that didn't opt in — the install neither
   * asks about the app nor touches it. */
  menubar?: MenubarAgent;
  /** The running caret's package root, which ships bin/caret-menubar.app. Defaults to
   * resolveCaretRoot(). */
  packageRoot?: () => string;
}

/** Run `body` against the menubar agent, if there is one. Every failure is a warning. */
async function withMenubar(
  deps: MenubarStepDeps,
  ui: InstallUI,
  body: (agent: MenubarAgent) => Promise<void>,
): Promise<void> {
  if (deps.menubar === undefined) return;
  try {
    await body(deps.menubar);
  } catch (e) {
    ui.warn(
      `Could not update the caret menubar app (${errorMessage(e)}) — the rest of the install stands.`,
    );
  }
}

/** Bring the menubar app in line with this install's choice, reporting through `ui`. */
export async function reconcileMenubar(
  opts: { dryRun: boolean; choice: MenubarChoice; localRoot?: string },
  deps: MenubarStepDeps,
  ui: InstallUI,
): Promise<void> {
  await withMenubar(deps, ui, async (agent) => {
    const installed = agent.installed();
    if (opts.choice === "no") {
      await removeMenubar(agent);
      if (installed) ui.info("Removed the caret menubar app.");
      return;
    }
    if (opts.choice === "as-found" && !installed) {
      ui.info(
        "The caret menubar app isn't installed — a `caret install` at a terminal, without `--dry-run`, asks whether to add it.",
      );
      return;
    }
    if (opts.dryRun) {
      ui.info("Would refresh the caret menubar app and its login item.");
      return;
    }

    const source = join(
      opts.localRoot ?? (deps.packageRoot ?? resolveCaretRoot)(),
      "bin",
      APP_NAME,
    );
    if (!existsSync(join(source, EXECUTABLE))) {
      const build = opts.localRoot
        ? " Run `mise run build menubar` in the checkout to build it."
        : "";
      ui.warn(`No menubar app at ${source} — skipping it.${build}`);
      return;
    }

    const s = loadSettings();
    const baseUrl = daemonBaseUrl(s);
    const reviewUrl = publicUrl(s.daemon, getPort(s));
    if (isExposed(new URL(baseUrl).hostname.replace(/^\[(.*)\]$/, "$1"))) {
      ui.warn(
        "The caret menubar app reaches caret over loopback only, and caret is bound to another host — leaving the app as it is.",
      );
      return;
    }

    // A stopped job left by "leave-stopped" still names the pruned path in launchd's
    // memory, but nothing starts it before the next login, which reads the new plist.
    const app = stageMenubarApp(source);
    await agent.install(
      { executable: join(app, EXECUTABLE), baseUrl, reviewUrl, tokenFile: daemonTokenFile() },
      opts.choice === "yes" ? "start" : "leave-stopped",
    );
    pruneMenubarApps(app);

    ui.info(
      opts.choice === "yes"
        ? 'The caret menubar app is in the menu bar and starts at login.\nTo remove it, run `caret install` and answer "No".'
        : "Refreshed the caret menubar app — if you quit it, it stays quit until the next login.",
    );
  });
}

/** Remove the menubar app and its LaunchAgent, reporting through `ui`. */
export async function uninstallMenubar(
  opts: { dryRun: boolean },
  deps: MenubarStepDeps,
  ui: InstallUI,
): Promise<void> {
  await withMenubar(deps, ui, async (agent) => {
    const installed = agent.installed();
    if (opts.dryRun) {
      if (installed) ui.info("Would remove the caret menubar app.");
      return;
    }
    await removeMenubar(agent);
    if (installed) ui.info("Removed the caret menubar app.");
  });
}

/** Stop the app and delete caret's own copies — never a path read from a plist. */
async function removeMenubar(agent: MenubarAgent): Promise<void> {
  await agent.uninstall();
  rmSync(menubarDir(), { recursive: true, force: true });
}

/** Copy `source` to menubarDir()/<id>/, keyed by its executable's hash; the copy lands
 * whole or not at all. Returns the copied app's path. */
function stageMenubarApp(source: string): string {
  const id = createHash("sha256")
    .update(readFileSync(join(source, EXECUTABLE)))
    .digest("hex")
    .slice(0, 12);
  const dest = join(menubarDir(), id, APP_NAME);
  if (existsSync(join(dest, EXECUTABLE))) return dest;

  ensureStateDir(menubarDir());
  // Dot-prefixed so pruneMenubarApps leaves another install's in-flight copy alone.
  const tmp = mkdtempSync(join(menubarDir(), `.${id}.`));
  try {
    cpSync(source, join(tmp, APP_NAME), { recursive: true });
    rmSync(join(menubarDir(), id), { recursive: true, force: true });
    renameSync(tmp, join(menubarDir(), id));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return dest;
}

/** Remove every copy but `keep`'s. Best-effort. */
function pruneMenubarApps(keep: string): void {
  const keepId = basename(dirname(keep));
  for (const name of readdirSync(menubarDir())) {
    if (name.startsWith(".") || name === keepId) continue;
    try {
      rmSync(join(menubarDir(), name), { recursive: true, force: true });
    } catch {
      // A leftover copy costs only disk.
    }
  }
}

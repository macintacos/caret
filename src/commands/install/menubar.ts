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

// Keep in sync with menubar/Info.plist CFBundleExecutable and the build's MENUBAR_APP and
// MENUBAR_EXECUTABLE (scripts/tasks/build.ts).
const APP_NAME = "caret-menubar.app";
const EXECUTABLE = "Contents/MacOS/CaretMenubar";

/** What this install does about the menubar app: the question's two answers, or — when
 * nobody was asked — the app left as found. */
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
    if (opts.choice === "no") return removeReported(agent, opts.dryRun, ui);
    if (opts.choice === "as-found" && !agent.installed()) {
      ui.info(
        "The caret menubar app isn't installed — a `caret install` at a terminal, without `--dry-run`, asks whether to add it.",
      );
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
    // The app exits 2 on a base URL its isLoopback (LaunchConfig.swift) refuses — a crash
    // loop under KeepAlive. isExposed is that check's TS twin.
    const hostname = new URL(baseUrl).hostname.replace(/^\[(.*)\]$/, "$1");
    if (isExposed(hostname)) {
      ui.warn(
        "The caret menubar app reaches caret over loopback only, and caret is bound to another host — leaving the app as it is.",
      );
      return;
    }

    if (opts.dryRun) {
      ui.info("Would refresh the caret menubar app and its login item.");
      return;
    }

    const app = stageMenubarApp(source);
    const outcome = await agent.install(
      { executable: join(app, EXECUTABLE), baseUrl, reviewUrl, tokenFile: daemonTokenFile() },
      opts.choice === "yes" ? "start" : "leave-stopped",
    );
    // launchd still holds the old path for a deferred job; keep that copy until a reload.
    if (outcome !== "deferred") pruneMenubarApps(app);

    ui.info(
      outcome === "deferred"
        ? "Refreshed the caret menubar app — it stays quit until your next login."
        : 'The caret menubar app is in the menu bar and starts at login.\nTo remove it, run `caret install` and answer "No".',
    );
  });
}

/** Remove the menubar app and its LaunchAgent, reporting through `ui`. */
export async function uninstallMenubar(
  opts: { dryRun: boolean },
  deps: MenubarStepDeps,
  ui: InstallUI,
): Promise<void> {
  await withMenubar(deps, ui, (agent) => removeReported(agent, opts.dryRun, ui));
}

/** Remove the app, or under a dry run say so; report only when it was installed. */
async function removeReported(agent: MenubarAgent, dryRun: boolean, ui: InstallUI) {
  const installed = agent.installed();
  if (dryRun) {
    if (installed) ui.info("Would remove the caret menubar app.");
    return;
  }

  await removeMenubar(agent);
  if (installed) ui.info("Removed the caret menubar app.");
}

/** Stop the app and delete caret's own copies — never a path read from a plist. */
async function removeMenubar(agent: MenubarAgent): Promise<void> {
  await agent.uninstall();
  rmSync(menubarDir(), { recursive: true, force: true });
}

/** Copy `source` to menubarDir()/<id>/ unless that copy exists; the copy lands whole or
 * not at all. Returns the copied app's path. <id> hashes only the executable, whose
 * ad-hoc signature seals the rest of the bundle. A fresh path per build keeps an
 * unchanged re-run's plist byte-identical and never overwrites the bundle launchd runs. */
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

// OpenCode's install probe for the discovery command: a best-effort, strictly
// read-only read of caret's OpenCode plugin state from OpenCode's config dir.
// Mirrors claude/install.ts and codex/install.ts's degrade-to-"unknown" discipline
// — every field degrades to "unknown" rather than throwing, so discovery always
// renders the install-state section. Reads ONLY caret's own plugin file and the
// user's plugin array — never any other config key (privacy).
//
// caret installs into OpenCode as an AUTO-LOADED plugin file in the plugin dir (the
// install subcommand writes it; see deploy.ts + packaging.ts), NOT as an entry in
// the user's `plugin` config array — so the array is scanned only to surface a
// MANUAL entry a user added by hand (the normally-false `hookInUserSettings`
// probe). The reader and the writer share path resolution via paths.ts.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readJsonFileSync } from "../../json-file.ts";
import type { InstallProbe } from "../adapter.ts";
import { CONFIG_FILENAMES, opencodeConfigDir, pluginFilePath } from "./paths.ts";

/** The version marker the installer embeds in the deployed plugin file, read back
 * here so discovery can report the installed plugin version. */
const VERSION_MARKER = /CARET_PLUGIN_VERSION\s*=\s*["']([^"']+)["']/;

/** Best-effort read of caret's OpenCode install state. Every miss degrades to
 * "unknown". Reads ONLY caret's own plugin file / the user's plugin array — never
 * any other config key (privacy). */
export function readOpencodeInstallState(): InstallProbe {
  const dir = opencodeConfigDir();
  if (!existsSync(dir)) {
    return { pluginVersion: "unknown", pluginEnabled: "unknown", hookInUserSettings: "unknown" };
  }
  const pluginFile = pluginFilePath(dir);
  return {
    pluginVersion: readPluginVersion(pluginFile),
    // "Enabled" for an auto-loaded plugin == the plugin file is present.
    pluginEnabled: existsSync(pluginFile),
    hookInUserSettings: readManualPluginEntry(dir),
  };
}

/** Read caret's deployed plugin file and extract its embedded version marker.
 * "unknown" when the file is absent/unreadable or carries no marker. Reads ONLY
 * caret's own plugin file. */
function readPluginVersion(path: string): string | "unknown" {
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch {
    return "unknown";
  }
  return text.match(VERSION_MARKER)?.[1] ?? "unknown";
}

/** Scan the user's OpenCode config `plugin` array(s) for a MANUAL caret entry —
 * the normally-false probe, since caret installs as the auto-loaded plugin file
 * rather than an array entry. Checks EVERY candidate config filename and returns
 * true if any lists a caret plugin, so an entry in `opencode.json` isn't masked by
 * an earlier, caret-less `config.json`. Returns false when at least one config file
 * parses but none list caret; "unknown" only when no config file is readable. */
function readManualPluginEntry(dir: string): boolean | "unknown" {
  let sawConfig = false;
  for (const name of CONFIG_FILENAMES) {
    const json = readJsonFileSync(join(dir, name)) as { plugin?: unknown } | null;
    if (json === null) continue; // absent/unreadable/unparseable — try the next name
    sawConfig = true;
    const arr = json.plugin;
    if (Array.isArray(arr) && arr.some((e) => typeof e === "string" && e.includes("caret"))) {
      return true; // a manual caret entry in any config file the user keeps
    }
  }
  return sawConfig ? false : "unknown";
}

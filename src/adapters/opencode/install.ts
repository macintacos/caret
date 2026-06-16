// OpenCode's install probe for the discovery command: a best-effort, strictly
// read-only read of caret's OpenCode plugin state from OpenCode's config dir.
// Mirrors claude/install.ts and codex/install.ts's degrade-to-"unknown" discipline
// — every field degrades to "unknown" rather than throwing, so discovery always
// renders the install-state section. Reads ONLY caret's own plugin file and the
// user's plugin array — never any other config key (privacy).
//
// caret installs into OpenCode as an AUTO-LOADED plugin file in the global plugin
// dir (the installer writes `<config-dir>/plugin/caret.js`, see the opencode/
// packaging + the install subcommand), NOT as an entry in the user's `plugin`
// config array — so the array is scanned only to surface a MANUAL entry a user
// added by hand (the normally-false `hookInUserSettings` probe).

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { readJsonFileSync } from "../../json-file.ts";
import type { InstallProbe } from "../adapter.ts";

/** The OpenCode config dir: OPENCODE_CONFIG_DIR override, else
 * $XDG_CONFIG_HOME/opencode, else ~/.config/opencode. */
function opencodeConfigDir(): string {
  const override = process.env.OPENCODE_CONFIG_DIR?.trim();
  if (override) return override;
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  return join(xdg || join(homedir(), ".config"), "opencode");
}

/** caret's deployed OpenCode plugin file, relative to the config dir — the
 * installer drops it into OpenCode's auto-loaded global plugin dir. */
const PLUGIN_SUBPATH = ["plugin", "caret.js"] as const;

/** The version marker the installer embeds in the deployed plugin file, read back
 * here so discovery can report the installed plugin version. */
const VERSION_MARKER = /CARET_PLUGIN_VERSION\s*=\s*["']([^"']+)["']/;

/** Config filenames OpenCode may use in its config dir: the global `config.json`
 * this machine uses, or the `opencode.json` / `.jsonc` forms. Probed in order; the
 * first that parses is used for the manual-entry scan. */
const CONFIG_FILES = ["config.json", "opencode.json", "opencode.jsonc"] as const;

/** Best-effort read of caret's OpenCode install state. Every miss degrades to
 * "unknown". Reads ONLY caret's own plugin file / the user's plugin array — never
 * any other config key (privacy). */
export function readOpencodeInstallState(): InstallProbe {
  const dir = opencodeConfigDir();
  if (!existsSync(dir)) {
    return { pluginVersion: "unknown", pluginEnabled: "unknown", hookInUserSettings: "unknown" };
  }
  const pluginFile = join(dir, ...PLUGIN_SUBPATH);
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

/** Scan the user's OpenCode config `plugin` array for a MANUAL caret entry — the
 * normally-false probe, since caret installs as the auto-loaded plugin file rather
 * than an array entry. "unknown" only when no config file is present/readable;
 * false when one parses but holds no caret entry; true when a caret plugin is
 * listed. */
function readManualPluginEntry(dir: string): boolean | "unknown" {
  for (const name of CONFIG_FILES) {
    const json = readJsonFileSync(join(dir, name)) as { plugin?: unknown } | null;
    if (json === null) continue; // absent/unreadable/unparseable — try the next name
    const arr = json.plugin;
    if (!Array.isArray(arr)) return false; // parses but no plugin array → no manual entry
    return arr.some((e) => typeof e === "string" && e.includes("caret"));
  }
  return "unknown";
}

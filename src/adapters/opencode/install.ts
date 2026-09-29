// OpenCode's install probe for the doctor command: a best-effort, strictly
// read-only snapshot of caret's OpenCode install. caret installs as a plugin entry
// (@macintacos/caret) — in v1's `plugin` array or v2's `plugins` key — that OpenCode
// installs into its own cache, with the installed version recorded in
// `node_modules/@macintacos/caret/package.json` under the entry's cache dir; a
// `--from-local` `file:` entry pointing at a caret checkout is caret's entry too, its
// version read through OpenCode's cache symlink to the checkout. Mirrors claude/codex
// install.ts's degrade-to-"unknown" discipline — every field degrades rather than
// throwing, so doctor always renders. Reads only caret's own cache dirs, the user's plugin
// lists, and whether each `file:` entry's path holds caret's plugin — never any other
// config key.
//
// The probe never runs `opencode`, so it picks the cache layout from the key alone: v2's
// `npm/` for a `plugins` entry, v1's `packages/<specifier>/` for a `plugin` one. It
// therefore agrees with the `opencode-caret-version` check except in the mismatch state
// — a `plugin` entry on a v2 host — where the probe reads v1's leftover cache and the
// check, which knows the host, reads v2's; the `opencode-host` check fails on that state.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parse as parseJsonc } from "jsonc-parser";

import type { InstallProbe } from "@/adapters/adapter.ts";
import {
  type CaretEntry,
  caretEntries,
  isCaretCheckout,
  readLoadedCaretEntry,
} from "@/adapters/opencode/entries.ts";
import {
  CONFIG_FILENAMES,
  opencodeConfigDir,
  resolveConfigFile,
} from "@/adapters/opencode/paths.ts";
import { readEntryCachedVersion } from "@/adapters/opencode/upgrade.ts";
import { parseVersionTriple } from "@/lib/semver.ts";

/** Best-effort read of caret's OpenCode install state. Every miss degrades to
 * "unknown". */
export function readOpencodeInstallState(): InstallProbe {
  const dir = opencodeConfigDir();
  if (!existsSync(dir)) {
    return { pluginVersion: "unknown", pluginEnabled: "unknown", hookInUserSettings: "unknown" };
  }
  // First existing config file only, not readCaretInPluginArray's all-files scan, so for a
  // package entry pluginVersion agrees with the opencode-caret-version check.
  let entry: CaretEntry | null;
  try {
    entry = readLoadedCaretEntry(resolveConfigFile(dir));
  } catch {
    return {
      pluginVersion: "unknown",
      pluginEnabled: "unknown",
      hookInUserSettings: readCaretInPluginArray(dir),
    };
  }
  const cached = readEntryCachedVersion(entry);
  // A range shim reads as "unknown", same as a miss.
  const version = cached !== null && parseVersionTriple(cached) !== null ? cached : "unknown";
  return {
    pluginVersion: version,
    // A cache dir survives an interrupted install, so presence alone
    // isn't proof — only a resolved version is.
    pluginEnabled: version !== "unknown",
    // caret listed in either plugin key == caret is configured for OpenCode.
    hookInUserSettings: readCaretInPluginArray(dir),
  };
}

/** Whether any OpenCode config file's `plugin` or `plugins` key lists an entry `caretEntries`
 * counts as caret's. Scans every candidate config file (so an entry in one isn't masked
 * by a caret-less earlier file), parsing JSONC so a commented config still reads. false
 * when at least one config parses but none list caret; "unknown" only when none is
 * readable. */
function readCaretInPluginArray(dir: string): boolean | "unknown" {
  let sawConfig = false;
  for (const name of CONFIG_FILENAMES) {
    const path = join(dir, name);
    if (!existsSync(path)) continue;
    let text: string;
    try {
      text = readFileSync(path, "utf-8");
    } catch {
      continue; // unreadable — try the next candidate
    }
    const cfg: unknown = parseJsonc(text);
    if (cfg === undefined || cfg === null) continue;
    sawConfig = true;
    if (caretEntries(text, isCaretCheckout).length > 0) return true;
  }
  return sawConfig ? false : "unknown";
}

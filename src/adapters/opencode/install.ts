// OpenCode's install probe for the doctor command: a best-effort, strictly
// read-only snapshot of caret's OpenCode install. caret installs as a `plugin` array
// entry (@macintacos/caret) that OpenCode installs into its own cache, one
// `packages/<specifier>/` dir per array entry with the installed version recorded in
// that dir's `node_modules/@macintacos/caret/package.json`. Mirrors claude/codex install.ts's
// degrade-to-"unknown" discipline — every field degrades rather than throwing, so
// doctor always renders. Reads only caret's own cache dirs and the user's plugin
// array — never any other config key.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parse as parseJsonc } from "jsonc-parser";

import type { InstallProbe } from "@/adapters/adapter.ts";
import { findPluginEntry } from "@/adapters/opencode/config-plugin.ts";
import {
  CARET_PACKAGE,
  CONFIG_FILENAMES,
  opencodeCachePackageDir,
  opencodeConfigDir,
  resolveConfigFile,
} from "@/adapters/opencode/paths.ts";
import { readCachedCaretVersion, readConfigText } from "@/adapters/opencode/upgrade.ts";
import { parseVersionTriple } from "@/lib/semver.ts";

/** Best-effort read of caret's OpenCode install state. Every miss degrades to
 * "unknown". */
export function readOpencodeInstallState(): InstallProbe {
  const dir = opencodeConfigDir();
  if (!existsSync(dir)) {
    return { pluginVersion: "unknown", pluginEnabled: "unknown", hookInUserSettings: "unknown" };
  }
  const entry = readCaretEntry(dir);
  const cached = entry === null ? null : readCachedCaretVersion(opencodeCachePackageDir(entry));
  // A range shim or a miss both read as "unknown": only an exact version is reported.
  const version = cached !== null && parseVersionTriple(cached) !== null ? cached : "unknown";
  return {
    pluginVersion: version,
    // A `packages/<specifier>/` dir survives an interrupted install, so presence alone
    // isn't proof — only a resolved version is.
    pluginEnabled: version !== "unknown",
    // caret listed in the user's `plugin` array == caret is configured for OpenCode.
    hookInUserSettings: readCaretInPluginArray(dir),
  };
}

/** caret's `plugin` entry in the config install and doctor resolve, or null when there
 * is none or the config cannot be read. */
function readCaretEntry(dir: string): string | null {
  try {
    return findPluginEntry(readConfigText(resolveConfigFile(dir)), CARET_PACKAGE);
  } catch {
    return null;
  }
}

/** Whether caret is listed in any OpenCode config file's `plugin` array. Scans every
 * candidate config file (so an entry in one isn't masked by a caret-less earlier
 * file), parsing JSONC so a commented config still reads. false when at least one
 * config parses but none list caret; "unknown" only when none is readable. */
function readCaretInPluginArray(dir: string): boolean | "unknown" {
  let sawConfig = false;
  for (const name of CONFIG_FILENAMES) {
    const path = join(dir, name);
    if (!existsSync(path)) continue;
    let cfg: { plugin?: unknown } | undefined;
    try {
      cfg = parseJsonc(readFileSync(path, "utf-8")) as { plugin?: unknown } | undefined;
    } catch {
      continue; // unreadable/unparseable — try the next candidate
    }
    if (cfg === undefined || cfg === null) continue;
    sawConfig = true;
    const arr = cfg.plugin;
    // Loose "caret" substring on purpose (a diagnostics probe, not the exact writer
    // match): also surfaces a dev/local caret entry (a `bun link` path or a pinned
    // `@macintacos/caret@x`), so doctor reports "configured" for those too.
    if (Array.isArray(arr) && arr.some((e) => typeof e === "string" && e.includes("caret"))) {
      return true;
    }
  }
  return sawConfig ? false : "unknown";
}

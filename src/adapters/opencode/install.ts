// OpenCode's install probe for the discovery command: a best-effort, strictly
// read-only snapshot of caret's OpenCode install. caret installs as a `plugin` array
// entry (@macintacos/caret) that OpenCode `bun install`s into its own cache, so the
// probe reports: the version from that cache, whether the cache package is present
// (installed), and whether caret is listed in the user's config `plugin` array
// (configured). Mirrors claude/codex install.ts's degrade-to-"unknown" discipline —
// every field degrades rather than throwing, so discovery always renders. Reads only
// caret's own cache package and the user's plugin array — never any other config key.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parse as parseJsonc } from "jsonc-parser";

import type { InstallProbe } from "@/adapters/adapter.ts";
import {
  CONFIG_FILENAMES,
  opencodeCachePackageDir,
  opencodeConfigDir,
} from "@/adapters/opencode/paths.ts";

/** Best-effort read of caret's OpenCode install state. Every miss degrades to
 * "unknown". Reads ONLY caret's own cache package / the user's plugin array. */
export function readOpencodeInstallState(): InstallProbe {
  const dir = opencodeConfigDir();
  if (!existsSync(dir)) {
    return { pluginVersion: "unknown", pluginEnabled: "unknown", hookInUserSettings: "unknown" };
  }
  const cacheDir = opencodeCachePackageDir();
  return {
    pluginVersion: readCachedVersion(cacheDir),
    // Present in OpenCode's plugin cache == OpenCode has installed the array entry.
    pluginEnabled: existsSync(cacheDir),
    // caret listed in the user's `plugin` array == caret is configured for OpenCode.
    hookInUserSettings: readCaretInPluginArray(dir),
  };
}

/** caret's installed version from OpenCode's plugin-cache package.json; "unknown"
 * when the cache package is absent/unreadable/versionless. */
function readCachedVersion(cachePackageDir: string): string | "unknown" {
  try {
    const v = (
      JSON.parse(readFileSync(join(cachePackageDir, "package.json"), "utf-8")) as {
        version?: unknown;
      }
    ).version;
    return typeof v === "string" ? v : "unknown";
  } catch {
    return "unknown";
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
    // `@macintacos/caret@x`), so discovery reports "configured" for those too.
    if (Array.isArray(arr) && arr.some((e) => typeof e === "string" && e.includes("caret"))) {
      return true;
    }
  }
  return sawConfig ? false : "unknown";
}

// OpenCode's install probe for the discovery command: a best-effort, strictly
// read-only snapshot of caret's OpenCode install. caret installs as a `plugin` array
// entry (@macintacos/caret) that OpenCode installs into its own cache, one
// `packages/<specifier>/` dir per array entry with the resolved version recorded in
// that dir's top-level shim manifest. Mirrors claude/codex install.ts's
// degrade-to-"unknown" discipline — every field degrades rather than throwing, so
// discovery always renders. Reads only caret's own cache dirs and the user's plugin
// array — never any other config key.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parse as parseJsonc } from "jsonc-parser";

import type { InstallProbe } from "@/adapters/adapter.ts";
import {
  CONFIG_FILENAMES,
  existingOpencodeCachePackageDirs,
  opencodeConfigDir,
} from "@/adapters/opencode/paths.ts";
import { readCachedCaretVersion } from "@/adapters/opencode/upgrade.ts";

/** Best-effort read of caret's OpenCode install state. Every miss degrades to
 * "unknown". */
export function readOpencodeInstallState(): InstallProbe {
  const dir = opencodeConfigDir();
  if (!existsSync(dir)) {
    return { pluginVersion: "unknown", pluginEnabled: "unknown", hookInUserSettings: "unknown" };
  }
  // The probe's vocabulary is "unknown", the upgrade module's is null; the boundary is
  // this one coercion.
  const version = readCachedCaretVersion(existingOpencodeCachePackageDirs()) ?? "unknown";
  return {
    pluginVersion: version,
    // A `packages/<specifier>/` dir survives an interrupted install, so presence alone
    // isn't proof — only a resolved version is.
    pluginEnabled: version !== "unknown",
    // caret listed in the user's `plugin` array == caret is configured for OpenCode.
    hookInUserSettings: readCaretInPluginArray(dir),
  };
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

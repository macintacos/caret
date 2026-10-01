// Which OpenCode is installed, and what that means for where caret's entry goes: v2 loads
// caret from `plugins`, while v1 before 1.18.16 refuses to start on that key at all, so an
// unreadable version falls back to `plugin`, which every OpenCode loads.

import { basename } from "node:path";

import type { PluginKey } from "@/adapters/opencode/config-plugin.ts";
import { CONFIG_FILENAMES, type ConfigFilename } from "@/adapters/opencode/paths.ts";
import type { Check } from "@/doctor/report.ts";
import { isNewer, parseVersionTriple, type VersionTriple } from "@/lib/semver.ts";

/** Covers a cold v1 start (npm's node wrapper took 1.6 s) with margin. */
const OPENCODE_VERSION_TIMEOUT_MS = 5_000;

/** "opencode v2.0.18" (v2) or a bare "1.14.17" (v1); null for anything else. */
export function parseOpencodeVersion(stdout: string): VersionTriple | null {
  return parseVersionTriple(stdout.trim().replace(/^opencode /, ""));
}

/** Runs `<bin> --version`; null when bin is null, the exit is non-zero, the output does
 * not parse, or the bound kills it. Leaving `bin` out means the first `opencode` on
 * `PATH`; an explicit `null` means there is none. Never throws. */
export function readOpencodeVersion(
  opts: { bin?: string | null; timeoutMs?: number } = {},
): VersionTriple | null {
  const bin = opts.bin === undefined ? Bun.which("opencode") : opts.bin;
  if (bin === null) return null;
  try {
    // Synchronous on purpose: async `Bun.spawn`'s timeout kills only the direct child, and
    // a grandchild holding stdout (npm v1's node wrapper) keeps a pipe read waiting.
    const res = Bun.spawnSync([bin, "--version"], {
      timeout: opts.timeoutMs ?? OPENCODE_VERSION_TIMEOUT_MS,
      stdin: "ignore",
      stderr: "ignore",
    });
    return res.exitCode === 0 ? parseOpencodeVersion(res.stdout.toString()) : null;
  } catch {
    return null;
  }
}

/** Whether `version` is OpenCode v2 or later; an unreadable version is not. */
export function isV2Host(version: VersionTriple | null): boolean {
  return version !== null && version[0] >= 2;
}

/** The key caret writes on this host: `plugins` on v2, else `plugin`, which every
 * OpenCode loads, so an unreadable version is safe. */
export function pluginKeyFor(version: VersionTriple | null): PluginKey {
  return isV2Host(version) ? "plugins" : "plugin";
}

/** The global config filenames `host` loads, in caret's write preference: all three on a
 * known v1; without `config.json` on v2, which ignores it, and on an unreadable version,
 * where `opencode.jsonc` and `opencode.json` are the files every OpenCode loads. */
export function hostConfigFilenames(host: VersionTriple | null): readonly ConfigFilename[] {
  return host !== null && !isV2Host(host)
    ? CONFIG_FILENAMES
    : CONFIG_FILENAMES.filter((name) => name !== "config.json");
}

/** The files among `configFiles` whose basename `host` loads. */
export function loadedConfigFiles(
  configFiles: readonly string[],
  host: VersionTriple | null,
): string[] {
  const names: readonly string[] = hostConfigFilenames(host);
  return configFiles.filter((p) => names.includes(basename(p)));
}

/** v1.3.4 is the first loader that accepts the plugin's object default. */
const V1_FLOOR = "1.3.4";

/** doctor's `opencode-host` check: whether the OpenCode on `PATH` loads caret from the keys
 * its entries in loaded files sit in, and whether any `ignoredFiles` — config files holding
 * caret that this host never loads — exist. Every fault joins into one fail, each with its
 * remedy. */
export function hostCheck(
  version: VersionTriple | null,
  keys: readonly PluginKey[],
  ignoredFiles: readonly string[],
): Check {
  const base = { id: "opencode-host", title: "OpenCode host" };
  if (version === null) {
    return { ...base, status: "unknown", detail: "", reason: "couldn't read `opencode --version`" };
  }
  const shownVersion = version.join(".");
  const faults: string[] = [];
  const remedies: string[] = [];
  if (!isV2Host(version) && isNewer(V1_FLOOR, shownVersion)) {
    faults.push(`OpenCode ${shownVersion} is older than ${V1_FLOOR}, the first that loads caret`);
    remedies.push(`upgrade OpenCode to ${V1_FLOOR} or later`);
  }
  const wrongKey = keys.find((k) => k !== pluginKeyFor(version));
  if (wrongKey === "plugins") {
    faults.push(
      `caret is in \`plugins\`, which OpenCode v1 never loads (before 1.18.16 it refuses to start with the key)`,
    );
    remedies.push("run `caret install`");
  } else if (wrongKey === "plugin") {
    faults.push(`caret is in the legacy \`plugin\` key on OpenCode ${shownVersion}`);
    remedies.push("run `caret install`");
  }
  if (ignoredFiles.length > 0) {
    const names = ignoredFiles.map((p) => basename(p)).join(", ");
    faults.push(`caret is in ${names}, which OpenCode ${shownVersion} doesn't load`);
    remedies.push("run `caret install`");
  }
  if (faults.length === 0) {
    return {
      ...base,
      status: "pass",
      detail: `OpenCode ${shownVersion} loads caret from \`${keys.join("`, `")}\``,
    };
  }
  return { ...base, status: "fail", detail: faults.join("; "), remedy: remedies.join("; ") };
}

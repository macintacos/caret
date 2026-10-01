// Which OpenCodes are on `PATH`, and what that means for where caret's entry goes: v2 loads
// caret from `plugins`, while v1 before 1.18.16 refuses to start on that key at all and later
// v1 ignores it, so anything short of every `opencode` reading as v2 falls back to `plugin`,
// which every OpenCode loads.

import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { basename, delimiter, isAbsolute, join } from "node:path";

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

/** Runs `<bin> --version`; null when the exit is non-zero, the output does not parse, or
 * the bound kills it. Never throws. */
export function readOpencodeVersion(opts: {
  bin: string;
  timeoutMs?: number;
}): VersionTriple | null {
  const { bin } = opts;
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

/** One `opencode` found on `PATH`, and what its `--version` read as. */
export interface OpencodeHost {
  /** The PATH spelling, never the realpath: a mise shim dispatches on its own name. */
  bin: string;
  version: VersionTriple | null;
}

/** Every executable `opencode` under `path`'s absolute entries, in PATH order, once per
 * realpath (first spelling wins). */
export function opencodeBinsOnPath(path: string): string[] {
  const seen = new Set<string>();
  return path
    .split(delimiter)
    .filter((dir) => isAbsolute(dir))
    .map((dir) => join(dir, "opencode"))
    .filter((bin) => {
      const real = executableRealpath(bin);
      if (real === null || seen.has(real)) return false;
      seen.add(real);
      return true;
    });
}

/** realpath of `bin` when it is an executable file; null when missing, a dir, a broken
 * link, or not executable. */
function executableRealpath(bin: string): string | null {
  try {
    if (!statSync(bin).isFile()) return null;
    accessSync(bin, constants.X_OK);
    return realpathSync(bin);
  } catch {
    return null;
  }
}

/** Probes every `opencode` on `path`, each under its own bound; one that fails or hangs
 * reads as null and the rest still run. */
export function readOpencodeHosts(
  path = process.env.PATH ?? "",
  timeoutMs?: number,
): OpencodeHost[] {
  return opencodeBinsOnPath(path).map((bin) => ({
    bin,
    version: readOpencodeVersion({ bin, timeoutMs }),
  }));
}

/** The version that stands for every host when each reads and all share a major — all the
 * key, config-filename, and cache-layout rules turn on. Null for no host, an unreadable
 * one, or v1 beside v2; each rule answers null with what every OpenCode loads. */
export function sharedHost(hosts: readonly OpencodeHost[]): VersionTriple | null {
  const versions = hosts.map((h) => h.version);
  const [first] = versions;
  if (first == null || versions.some((v) => v === null || isV2Host(v) !== isV2Host(first))) {
    return null;
  }
  return first;
}

/** Each host as "OpenCode 2.0.18 at /a/opencode" or "couldn't read `/b/opencode --version`",
 * comma-joined; "no `opencode` on PATH" for none. */
export function describeHosts(hosts: readonly OpencodeHost[]): string {
  if (hosts.length === 0) return "no `opencode` on PATH";
  return hosts
    .map(({ bin, version }) =>
      version === null
        ? `couldn't read \`${bin} --version\``
        : `OpenCode ${version.join(".")} at ${bin}`,
    )
    .join(", ");
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

/** doctor's `opencode-host` check: whether every `opencode` on `PATH` loads caret from the
 * keys its entries in loaded files sit in, and whether any `ignoredFiles` — config files
 * holding caret that OpenCode v2 never loads — exist. Every fault joins into one fail, each
 * with its remedy. */
export function hostCheck(
  hosts: readonly OpencodeHost[],
  keys: readonly PluginKey[],
  ignoredFiles: readonly string[],
): Check {
  const base = { id: "opencode-host", title: "OpenCode host" };
  const found = describeHosts(hosts);
  if (hosts.every((h) => h.version === null)) {
    return { ...base, status: "unknown", detail: "", reason: found };
  }
  const faults: string[] = [];
  const remedies: string[] = [];
  for (const { bin, version } of hosts) {
    if (version === null || isV2Host(version)) continue;
    const shown = version.join(".");
    if (isNewer(V1_FLOOR, shown)) {
      faults.push(
        `OpenCode ${shown} at ${bin} is older than ${V1_FLOOR}, the first that loads caret`,
      );
      remedies.push(`upgrade OpenCode to ${V1_FLOOR} or later`);
    }
  }
  const wrongKey = keys.find((k) => k !== pluginKeyFor(sharedHost(hosts)));
  if (wrongKey === "plugins") {
    faults.push(
      `caret is in \`plugins\`, which OpenCode v1 never loads (before 1.18.16 it refuses to start with the key)`,
    );
    remedies.push("run `caret install`");
  } else if (wrongKey === "plugin") {
    faults.push("caret is in the legacy `plugin` key on OpenCode v2");
    remedies.push("run `caret install`");
  }
  if (ignoredFiles.length > 0) {
    const names = ignoredFiles.map((p) => basename(p)).join(", ");
    faults.push(`caret is in ${names}, which OpenCode v2 doesn't load`);
    remedies.push("run `caret install`");
  }
  if (faults.length === 0) {
    return {
      ...base,
      status: "pass",
      detail: `${found} — loads caret from \`${keys.join("`, `")}\``,
    };
  }
  return {
    ...base,
    status: "fail",
    detail: `${found} — ${faults.join("; ")}`,
    remedy: [...new Set(remedies)].join("; "),
  };
}

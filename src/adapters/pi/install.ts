// Reads caret's entries in pi's user settings, and names them as pi's package commands
// take them, for the doctor probe and `caret install`'s pi target; strictly read-only,
// degrades rather than throws.

import { homedir } from "node:os";
import { join, resolve } from "node:path";

import type { InstallProbe } from "@/adapters/adapter.ts";
import { readJsonFileSync } from "@/lib/json-file.ts";

const CARET_PACKAGE = "@macintacos/caret";
/** caret's unpinned npm source, as `pi install` takes it; installing it over a pinned
 * entry unpins it. */
export const CARET_NPM_SOURCE = `npm:${CARET_PACKAGE}`;
const NPM_SOURCE = /^npm:@macintacos\/caret(@[^/]+)?$/;

/** pi's user `settings.json`; `packages` is the one key caret interprets. */
export interface PiSettings {
  packages?: unknown;
  [key: string]: unknown;
}

/** pi's agent dir: `PI_CODING_AGENT_DIR`, tilde-expanded as pi does, else
 * `~/.pi/agent`. */
export function piAgentDir(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const overrideDir = env.PI_CODING_AGENT_DIR;
  if (!overrideDir) return join(home, ".pi", "agent");
  return expandTilde(overrideDir, home);
}

function expandTilde(path: string, home: string): string {
  if (path === "~") return home;
  if (path.startsWith("~/")) return join(home, path.slice(2));
  return path;
}

/** pi's user `settings.json` under `agentDir`, or null when unreadable or not a
 * JSON object. */
export function readPiSettings(agentDir: string): PiSettings | null {
  const json = readJsonFileSync(join(agentDir, "settings.json"));
  return json !== null && typeof json === "object" && !Array.isArray(json)
    ? (json as PiSettings)
    : null;
}

/** Best-effort read of caret's pi install state. `hookInUserSettings` is always
 * false: pi has no hook entries, only packages. Interprets ONLY caret's own
 * `packages` entry — never any other settings key (privacy). */
export function readPiInstallState(agentDir: string, home = homedir()): InstallProbe {
  const settings = readPiSettings(agentDir);
  if (!settings) {
    return { pluginVersion: "unknown", pluginEnabled: "unknown", hookInUserSettings: false };
  }
  const entry = caretEntries(settings.packages, { agentDir, home })[0];
  return {
    pluginVersion: entry?.version ?? "unknown",
    pluginEnabled: entry !== undefined && !filtersOutExtensions(entry),
    hookInUserSettings: false,
  };
}

/** One caret entry in pi's `packages`, in settings order. */
export type PiCaretEntry = {
  /** The source exactly as settings.json stores it. */
  source: string;
  /** The package dir pi loads: the npm install root's copy, or the local path
   * resolved from the agent dir. */
  dir: string;
  /** `dir`'s package.json version; null when pi lists the entry but the package
   * isn't there to read. */
  version: string | null;
  /** The entry's raw `extensions` filter, uninterpreted. */
  extensions: unknown;
} & (
  | {
      form: "npm";
      /** Any `@<spec>` suffix — exact version, range, or tag — counts; all are
       * hand-written. */
      pinned: boolean;
    }
  | { form: "local" }
);

export interface PiDirs {
  agentDir: string;
  home: string;
}

/** Every caret entry in pi's user settings, in order; empty when settings.json is
 * missing, unreadable, or lists none. */
export function readPiCaretEntries(agentDir: string, home = homedir()): PiCaretEntry[] {
  const settings = readPiSettings(agentDir);
  return settings === null ? [] : piCaretEntries(settings, { agentDir, home });
}

/** Every caret entry in already-read pi `settings`, in order. */
export function piCaretEntries(settings: PiSettings, dirs: PiDirs): PiCaretEntry[] {
  return caretEntries(settings.packages, dirs);
}

function caretEntries(packages: unknown, dirs: PiDirs): PiCaretEntry[] {
  if (!Array.isArray(packages)) return [];
  return packages.flatMap((pkg) => {
    const source = typeof pkg === "string" ? pkg : (pkg as { source?: unknown } | null)?.source;
    if (typeof source !== "string") return [];
    const entry = caretEntry(source, (pkg as { extensions?: unknown }).extensions, dirs);
    return entry ? [entry] : [];
  });
}

/** The entry `source` describes, or null when it isn't caret. pi resolves relative
 * user-settings paths from the agent dir. */
function caretEntry(
  source: string,
  extensions: unknown,
  { agentDir, home }: PiDirs,
): PiCaretEntry | null {
  const npmMatch = NPM_SOURCE.exec(source);
  if (npmMatch) {
    const dir = join(agentDir, "npm", "node_modules", CARET_PACKAGE);
    const version = manifestVersion(readJsonFileSync(join(dir, "package.json")));
    return { source, dir, version, extensions, form: "npm", pinned: npmMatch[1] !== undefined };
  }
  const dir = resolve(agentDir, expandTilde(source, home));
  const manifest = readJsonFileSync(join(dir, "package.json")) as { name?: unknown } | null;
  if (manifest?.name !== CARET_PACKAGE) return null;
  return { source, dir, version: manifestVersion(manifest), extensions, form: "local" };
}

function manifestVersion(manifest: unknown): string | null {
  const version = (manifest as { version?: unknown } | null)?.version;
  return typeof version === "string" ? version : null;
}

/** Whether `entry`'s filter keeps pi from loading caret's extension. */
export function filtersOutExtensions(entry: PiCaretEntry): boolean {
  // ponytail: extension filters (`!glob`, `-path`) aren't evaluated against
  // caret's extension manifest — any non-empty filter counts as enabled;
  // evaluate globs if a user hits a false "enabled".
  return Array.isArray(entry.extensions) && entry.extensions.length === 0;
}

/** The argument `pi remove` takes for `entry`. */
export function piRemoveArg(entry: PiCaretEntry): string {
  // `pi remove` resolves a path against the cwd, so a local entry goes by its resolved dir.
  return entry.form === "npm" ? entry.source : entry.dir;
}

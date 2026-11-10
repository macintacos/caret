// pi's install probe for the doctor command: a best-effort, strictly read-only
// read of caret's package entry in pi's user settings. Every field degrades to
// "unknown" rather than throwing. Reads ONLY caret's own `packages` entry —
// never any other settings key (privacy).

import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

import type { InstallProbe } from "@/adapters/adapter.ts";
import { readJsonFileSync } from "@/lib/json-file.ts";

const CARET_PACKAGE = "@macintacos/caret";
const NPM_SOURCE = /^npm:@macintacos\/caret(@[^/]+)?$/;

/** The parts of pi's `settings.json` caret reads. */
export interface PiSettings {
  packages?: unknown;
  [key: string]: unknown;
}

/** pi's agent dir: `PI_CODING_AGENT_DIR`, tilde-expanded as pi does, else
 * `~/.pi/agent`. */
export function piAgentDir(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const dir = env.PI_CODING_AGENT_DIR;
  if (!dir) return join(home, ".pi", "agent");
  return expandTilde(dir, home);
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
 * false: pi has no hook entries, only packages. */
export function readPiInstallState(agentDir: string): InstallProbe {
  const settings = readPiSettings(agentDir);
  if (!settings) {
    return { pluginVersion: "unknown", pluginEnabled: "unknown", hookInUserSettings: false };
  }
  const entry = findCaretEntry(settings.packages, agentDir);
  return {
    pluginVersion: entry ? readVersion(entry.packageJson) : "unknown",
    // ponytail: extension filters (`!glob`, `-path`) aren't evaluated against
    // caret's extension manifest — any non-empty filter counts as enabled;
    // evaluate globs if a user hits a false "enabled".
    pluginEnabled: entry !== null && !isEmptyArray(entry.extensions),
    hookInUserSettings: false,
  };
}

interface CaretEntry {
  packageJson: string;
  extensions: unknown;
}

function findCaretEntry(packages: unknown, agentDir: string): CaretEntry | null {
  if (!Array.isArray(packages)) return null;
  for (const pkg of packages) {
    const source = typeof pkg === "string" ? pkg : (pkg as { source?: unknown } | null)?.source;
    if (typeof source !== "string") continue;
    const packageJson = caretPackageJson(source, agentDir);
    if (packageJson) {
      return { packageJson, extensions: (pkg as { extensions?: unknown }).extensions };
    }
  }
  return null;
}

/** The `package.json` path of caret's install for `source`, or null when the
 * source isn't caret. pi resolves relative user-settings paths from the agent dir. */
function caretPackageJson(source: string, agentDir: string): string | null {
  if (NPM_SOURCE.test(source)) {
    return join(agentDir, "npm", "node_modules", CARET_PACKAGE, "package.json");
  }
  const expanded = expandTilde(source, homedir());
  const dir = isAbsolute(expanded) ? expanded : join(agentDir, expanded);
  const packageJson = join(dir, "package.json");
  const json = readJsonFileSync(packageJson) as { name?: unknown } | null;
  return json?.name === CARET_PACKAGE ? packageJson : null;
}

function readVersion(packageJson: string): string {
  const version = (readJsonFileSync(packageJson) as { version?: unknown } | null)?.version;
  return typeof version === "string" ? version : "unknown";
}

function isEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length === 0;
}

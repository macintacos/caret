// Where pi keeps the files caret reads: its agent dir and the settings file and npm
// install root under it. The install probe and `caret install`'s pi target resolve
// through here, so they can never disagree about a path.

import { homedir } from "node:os";
import { join } from "node:path";

/** pi's agent dir: `PI_CODING_AGENT_DIR`, tilde-expanded as pi does, else
 * `~/.pi/agent`. */
export function piAgentDir(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const overrideDir = env.PI_CODING_AGENT_DIR;
  if (!overrideDir) return join(home, ".pi", "agent");
  return expandTilde(overrideDir, home);
}

/** `path` with a leading `~` expanded against `home`, as pi expands its own paths. */
export function expandTilde(path: string, home: string): string {
  if (path === "~") return home;
  if (path.startsWith("~/")) return join(home, path.slice(2));
  return path;
}

/** pi's user `settings.json` under `agentDir`. */
export function piSettingsFile(agentDir: string): string {
  return join(agentDir, "settings.json");
}

/** Where pi installs the npm package `pkg` under `agentDir`. */
export function piNpmPackageDir(agentDir: string, pkg: string): string {
  return join(agentDir, "npm", "node_modules", pkg);
}

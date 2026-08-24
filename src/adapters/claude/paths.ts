// Where Claude Code keeps the files caret reads: its config dir and the two
// registry/settings files under it. Both readers — the discovery install probe
// (install.ts) and the skill enumerator (skills.ts) — resolve through here, so
// they can never disagree about a path. Mirrors the role
// `src/adapters/opencode/paths.ts` plays for the OpenCode adapter.

import { homedir } from "node:os";
import { join } from "node:path";

/** The Claude Code config dir: CLAUDE_CONFIG_DIR override, else ~/.claude. */
export function claudeConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
}

/** Claude's plugin registry: which plugins are installed and where each one lives. */
export function installedPluginsFile(): string {
  return join(claudeConfigDir(), "plugins", "installed_plugins.json");
}

/** The user settings layer. Not the only one Claude merges — `skills.ts` reads the
 * project layers too — but it is the only one the install probe looks at. */
export function userSettingsFile(): string {
  return join(claudeConfigDir(), "settings.json");
}

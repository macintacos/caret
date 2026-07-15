// Claude Code's install probe for the discovery command: a best-effort,
// strictly read-only read of caret's plugin install state from Claude's config
// dir. Every field degrades to "unknown" rather than throwing, so discovery can
// always render the install-state section. Reads ONLY caret's own entries —
// never any other settings key (privacy).

import { homedir } from "node:os";
import { join } from "node:path";

import type { InstallProbe } from "@/adapters/adapter.ts";
import { readJsonFileSync } from "@/lib/json-file.ts";

/** The Claude Code config dir: CLAUDE_CONFIG_DIR override, else ~/.claude. */
function claudeConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
}

/** caret's id in Claude Code's plugin registry: `<plugin>@<marketplace>`, both
 * "caret" per scripts/install.sh. */
const PLUGIN_ID = "caret@caret";

/** Best-effort read of caret's Claude Code install state. Every miss degrades
 * to "unknown". Reads ONLY caret's own entries — never any other settings key
 * (privacy). hookInUserSettings is the NORMAL-false probe: caret's hooks ride
 * inside the plugin's own hooks.json, so a user-settings hook means a MANUAL
 * entry; false when settings parse but hold none, "unknown" when unreadable. */
export function readClaudeInstallState(): InstallProbe {
  const dir = claudeConfigDir();
  return {
    pluginVersion: readPluginVersion(join(dir, "plugins", "installed_plugins.json")),
    pluginEnabled: readPluginEnabled(join(dir, "settings.json")),
    hookInUserSettings: readHookInUserSettings(join(dir, "settings.json")),
  };
}

function readPluginVersion(path: string): string | "unknown" {
  const json = readJsonFileSync(path) as { plugins?: Record<string, unknown> } | null;
  const entry = json?.plugins?.[PLUGIN_ID];
  if (!Array.isArray(entry) || entry.length === 0) return "unknown";
  const version = (entry[0] as { version?: unknown }).version;
  return typeof version === "string" ? version : "unknown";
}

function readPluginEnabled(path: string): boolean | "unknown" {
  const json = readJsonFileSync(path) as { enabledPlugins?: Record<string, unknown> } | null;
  if (!json) return "unknown";
  const enabled = json.enabledPlugins?.[PLUGIN_ID];
  return typeof enabled === "boolean" ? enabled : "unknown";
}

function readHookInUserSettings(path: string): boolean | "unknown" {
  const json = readJsonFileSync(path) as { hooks?: Record<string, unknown> } | null;
  if (!json) return "unknown";
  const hooks = json.hooks;
  if (hooks === undefined || hooks === null || typeof hooks !== "object") return false;
  // Walk every event array → every matcher → its hooks[].command, hunting a
  // manual caret hook entry. Defensive at each hop: a malformed shape just
  // yields no match (false), never a throw.
  for (const eventEntry of Object.values(hooks as Record<string, unknown>)) {
    if (!Array.isArray(eventEntry)) continue;
    for (const matcher of eventEntry) {
      const inner = (matcher as { hooks?: unknown })?.hooks;
      if (!Array.isArray(inner)) continue;
      for (const h of inner) {
        const command = (h as { command?: unknown })?.command;
        if (
          typeof command === "string" &&
          (command.includes("caret review") || command.includes("caret prewarm"))
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

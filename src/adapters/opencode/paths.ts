// Shared OpenCode config-dir + packaging-path resolution for caret's OpenCode
// integration. The install probe (install.ts) and the deploy/uninstall writer
// (deploy.ts, via the install subcommand) resolve WHERE caret's plugin and command
// files live through this single module, so the reader and the writer can never
// disagree about a path.

import { homedir } from "node:os";
import { join } from "node:path";

/** caret's deployed OpenCode plugin filename. Deployed as TypeScript — OpenCode
 * loads `.ts` plugins directly (its loader scans `{plugin,plugins}/*.{ts,js}`). */
export const PLUGIN_FILENAME = "caret.ts";

/** OpenCode's auto-loaded plugin dir name. OpenCode scans both `plugin/` and
 * `plugins/`; caret uses the singular, canonical form. */
export const PLUGIN_DIRNAME = "plugin";

/** OpenCode's command dir name. OpenCode scans both `command/` and `commands/`;
 * caret uses the singular, canonical form. */
export const COMMAND_DIRNAME = "command";

/** Config filenames OpenCode may use in its config dir. Probed in order; the
 * first that parses is used for the manual-plugin-entry scan. `config.json` is the
 * global-dir form this machine uses; `opencode.json[c]` are the documented forms. */
export const CONFIG_FILENAMES = ["config.json", "opencode.json", "opencode.jsonc"] as const;

/** The OpenCode config dir: OPENCODE_CONFIG_DIR override, else
 * $XDG_CONFIG_HOME/opencode, else ~/.config/opencode. */
export function opencodeConfigDir(): string {
  const override = process.env.OPENCODE_CONFIG_DIR?.trim();
  if (override) return override;
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  return join(xdg || join(homedir(), ".config"), "opencode");
}

/** Absolute path to caret's deployed plugin file under a config dir. */
export function pluginFilePath(configDir: string): string {
  return join(configDir, PLUGIN_DIRNAME, PLUGIN_FILENAME);
}

/** Absolute path to OpenCode's command dir under a config dir. */
export function commandDir(configDir: string): string {
  return join(configDir, COMMAND_DIRNAME);
}

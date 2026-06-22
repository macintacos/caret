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

/** OpenCode's auto-loaded plugin dir name. OpenCode scans both `plugins/` and
 * (for backwards compatibility) `plugin/`; caret uses the canonical plural form. */
export const PLUGIN_DIRNAME = "plugins";

/** OpenCode's command dir name. OpenCode scans both `commands/` and
 * (for backwards compatibility) `command/`; caret uses the canonical plural form. */
export const COMMAND_DIRNAME = "commands";

/** caret namespaces its OpenCode commands so they read as caret's, not built-ins.
 * OpenCode names a command by its path under `command/` minus the `.md`, so a file
 * deployed as `caret:demo.md` becomes the `/caret:demo` command — mirroring caret's
 * Claude commands (`/caret:demo`). */
export const COMMAND_NAMESPACE = "caret:";

/** The deployed filename for a packaged command file (e.g. `demo.md` ->
 * `caret:demo.md`), so OpenCode exposes it as `/caret:<name>`. */
export function namespacedCommandFilename(sourceName: string): string {
  return `${COMMAND_NAMESPACE}${sourceName}`;
}

/** Config filenames OpenCode may use in its config dir. The install probe scans
 * EVERY one for a manual caret plugin entry (see `install.ts`), so order doesn't
 * mask a later file. `config.json` is the global-dir form seen in practice;
 * `opencode.json[c]` are the documented forms. */
export const CONFIG_FILENAMES = ["config.json", "opencode.json", "opencode.jsonc"] as const;

/** caret's deployed plugin imports `@opencode-ai/plugin` (for `tool.schema`'s zod;
 * `tool()` itself is identity). OpenCode loads a local plugin file but does NOT
 * bundle that import for it — for a local plugin using an npm package it expects a
 * `package.json` in the config dir and runs `bun install` at startup to provide it.
 * caret writes that manifest at install time (see `deploy.ts`). */
export const OPENCODE_PLUGIN_DEP = "@opencode-ai/plugin";

/** The version caret pins the deployed plugin's `@opencode-ai/plugin` dependency to.
 * Pinned to an OLDER, already-published version on purpose: OpenCode's startup
 * installer resolves against a date-capped snapshot, so its own current version
 * (e.g. 1.17.x) can fail to resolve ("No matching version … with a date before …").
 * An older exact pin sidesteps that. Keep ≈ the devDependency in package.json;
 * `tool`/`tool.schema` and the hook names caret uses are stable across these. */
export const OPENCODE_PLUGIN_DEP_VERSION = "1.16.2";

/** The package.json OpenCode reads to install a local plugin's npm dependencies. */
export const PACKAGE_JSON_FILENAME = "package.json";

/** Absolute path to the config dir's package.json (caret's dependency manifest). */
export function packageJsonPath(configDir: string): string {
  return join(configDir, PACKAGE_JSON_FILENAME);
}

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

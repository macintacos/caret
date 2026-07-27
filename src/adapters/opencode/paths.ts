// Shared OpenCode config-dir + packaging-path resolution for caret's OpenCode
// integration. caret installs into OpenCode as a first-class `plugin` array entry
// (@macintacos/caret) plus its command files; the install writer
// (commands/install/opencode.ts) and the discovery probe (install.ts) resolve WHERE
// those live through this single module, so the reader and the writer can never
// disagree about a path.

import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

/** caret's npm package — the entry users add to OpenCode's `plugin` array. Its
 * package entrypoint (package.json `exports`) IS the OpenCode plugin, so a bare
 * specifier loads it; OpenCode installs it and its deps into its own cache. */
export const CARET_PACKAGE = "@macintacos/caret";

/** OpenCode's command dir name. OpenCode scans both `commands/` and (for backwards
 * compatibility) `command/`; caret uses the canonical plural form. */
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

/** Config filenames OpenCode may use in its config dir, in the order caret prefers
 * to WRITE (jsonc first — OpenCode's documented primary form, edited in place so a
 * commented config survives; then json; then the legacy global `config.json`). The
 * discovery probe scans every one, so order doesn't mask a later file for reads. */
export const CONFIG_FILENAMES = ["opencode.jsonc", "opencode.json", "config.json"] as const;

/** The OpenCode config dir: OPENCODE_CONFIG_DIR override, else
 * $XDG_CONFIG_HOME/opencode, else ~/.config/opencode. */
export function opencodeConfigDir(): string {
  const override = process.env.OPENCODE_CONFIG_DIR?.trim();
  if (override) return override;
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  return join(xdg || join(homedir(), ".config"), "opencode");
}

/** The config file caret edits to add/remove its `plugin` array entry: the first
 * existing candidate (jsonc preferred), else `opencode.json` to create when the dir
 * has no config yet. */
export function resolveConfigFile(configDir: string): string {
  for (const name of CONFIG_FILENAMES) {
    const p = join(configDir, name);
    if (existsSync(p)) return p;
  }
  return join(configDir, "opencode.json");
}

/** Absolute path to OpenCode's command dir under a config dir. */
export function commandDir(configDir: string): string {
  return join(configDir, COMMAND_DIRNAME);
}

/** OpenCode's plugin cache root: where OpenCode installs each `plugin` array entry,
 * one directory per RAW specifier string. Respects XDG_CACHE_HOME, else ~/.cache —
 * the same precedence OpenCode itself uses to resolve the dir. */
function opencodeCachePackagesDir(): string {
  const xdg = process.env.XDG_CACHE_HOME?.trim();
  return join(xdg || join(homedir(), ".cache"), "opencode", "packages");
}

/** The cache dir for the BARE `pkg` specifier — what `caret install --target opencode`'s
 * array entry produces, and the prefix every pinned variant extends. */
export function opencodeCachePackageDir(pkg: string = CARET_PACKAGE): string {
  return join(opencodeCachePackagesDir(), pkg);
}

/** Every cache dir on disk for `pkg`: the bare specifier dir first, then any pinned
 * `<pkg>@<version>` sibling, sorted. OpenCode names each dir after the VERBATIM
 * specifier, and a pin's version segment is arbitrary (`@0.7.3`, `@latest`), so
 * listing is the only way to find one. Empty when the cache is absent. */
export function existingOpencodeCachePackageDirs(pkg: string = CARET_PACKAGE): string[] {
  const bare = opencodeCachePackageDir(pkg);
  const parent = dirname(bare);
  const leaf = basename(bare);
  let names: string[];
  try {
    names = readdirSync(parent, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return []; // no cache dir yet — nothing installed.
  }
  const pinned = names.filter((n) => n.startsWith(`${leaf}@`)).sort();
  return [...(names.includes(leaf) ? [bare] : []), ...pinned.map((n) => join(parent, n))];
}

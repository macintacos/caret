// Shared OpenCode config-dir + packaging-path resolution for caret's OpenCode
// integration. caret installs into OpenCode as an entry in its plugin list (`plugins`
// when every `opencode` on PATH is v2, else `plugin`) — @macintacos/caret — plus its
// command files; the install writer (commands/install/opencode.ts) and the doctor probe
// (install.ts) resolve WHERE those live through this single module, so the reader and the
// writer can never disagree about a path. It also resolves what the file-deploy era left
// in that config dir, which install and uninstall sweep, and both hosts' plugin cache
// layouts.

import { type Dirent, existsSync, readdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

/** caret's npm package — the entry users add to OpenCode's plugin list. Its
 * package entrypoint (package.json `exports`) IS the OpenCode plugin, so a bare
 * specifier loads it; OpenCode installs it and its deps into its own cache. */
export const CARET_PACKAGE = "@macintacos/caret";

/** The plugin-list entry `--from-local` writes: npm's `file:` protocol pointed at a
 * caret checkout. OpenCode hands the specifier to its package installer and SYMLINKS the
 * target into its cache, so the plugin module it loads is the checkout's own file — its
 * `import.meta.url` sits in the checkout, and the `../bin/caret` the plugin resolves is
 * that checkout's shim, so a rebuild is picked up with no reinstall. caret's
 * `package.json` `main` is what makes OpenCode accept the directory as a plugin
 * ("server target"). */
export function localPluginSpecifier(repoDir: string): string {
  return `file:${repoDir}`;
}

/** Whether a plugin-list entry is a local-path specifier rather than a package name.
 * Only `file:` is produced by caret; the check is deliberately narrow, so an unfamiliar
 * entry is left alone rather than guessed at. */
export function isLocalPluginSpecifier(spec: string): boolean {
  return spec.startsWith("file:");
}

/** The checkout path a local specifier points at — the inverse of
 * `localPluginSpecifier`. Undefined for anything that isn't one. */
export function localSpecifierPath(spec: string): string | undefined {
  return isLocalPluginSpecifier(spec) ? spec.slice("file:".length) : undefined;
}

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
 * commented config survives; then json; then the legacy global `config.json`). Readers
 * scan every one that exists, in this order. */
export const CONFIG_FILENAMES = ["opencode.jsonc", "opencode.json", "config.json"] as const;

/** The OpenCode config dir: OPENCODE_CONFIG_DIR override, else
 * $XDG_CONFIG_HOME/opencode, else ~/.config/opencode. */
export function opencodeConfigDir(): string {
  const override = process.env.OPENCODE_CONFIG_DIR?.trim();
  if (override) return override;
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  return join(xdg || join(homedir(), ".config"), "opencode");
}

export type ConfigFilename = (typeof CONFIG_FILENAMES)[number];

/** The global config file install writes caret into: the first of `names` that exists
 * under `configDir`, else `opencode.json` to create. */
export function resolveConfigFile(configDir: string, names: readonly ConfigFilename[]): string {
  for (const name of names) {
    const p = join(configDir, name);
    if (existsSync(p)) return p;
  }
  return join(configDir, "opencode.json");
}

/** Every global config file that exists under `configDir`, in `CONFIG_FILENAMES` order:
 * what install strips, uninstall clears, and doctor reads. Two names for one file list
 * once, under the earlier: edits planned per name would overwrite each other. */
export function existingConfigFiles(configDir: string): string[] {
  const seen = new Set<string>();
  return CONFIG_FILENAMES.map((name) => join(configDir, name))
    .filter((p) => existsSync(p))
    .filter((p) => {
      const real = realpathSync(p);
      if (seen.has(real)) return false;
      seen.add(real);
      return true;
    });
}

/** Absolute path to OpenCode's command dir under a config dir. */
export function commandDir(configDir: string): string {
  return join(configDir, COMMAND_DIRNAME);
}

/** Both command dirs OpenCode loads from, canonical first. caret only ever WRITES the
 * plural, but OpenCode registers commands out of either, so anything reading "what can
 * this agent reach" has to look in both. */
export function commandDirs(configDir: string): string[] {
  return [commandDir(configDir), join(configDir, LEGACY_COMMAND_DIRNAME)];
}

/** The filename caret's plugin file carries in a pre-array-install config dir. */
const LEGACY_PLUGIN_FILENAME = "caret.ts";

/** The plugin dirs OpenCode scans, both of which caret has deployed into. */
const LEGACY_PLUGIN_DIRNAMES = ["plugins", "plugin"] as const;

/** The singular command dir OpenCode still scans for backwards compatibility, and that
 * caret deployed into before `COMMAND_DIRNAME`. Its `caret:`-namespaced files still
 * register commands, pointed at a binary path nothing writes any more. Exported because
 * the skill enumerator has to offer what OpenCode can actually reach, which includes a
 * user's own file here. */
export const LEGACY_COMMAND_DIRNAME = "command";

/** Every file-deploy-era artifact still on disk under `configDir`: caret's plugin file in
 * either plugin dir, plus any `caret:`-namespaced command file in the singular command
 * dir. OpenCode loads out of either spelling of either dir, so an orphan in the one caret
 * stopped writing is still live — a leftover plugin file registers a second review tool
 * beside the array entry. Filtered to what exists, so the caller gates on and removes the
 * same list.
 *
 * Only paths in caret's own namespace: the fixed `caret.ts` filename, and the `caret:`
 * command prefix caret claims (a user who squats it loses that file). Everything else in
 * those dirs is another tool's, as is the config dir's own `package.json`. The command
 * scan matches that prefix rather than the commands caret ships today — an old install
 * may hold a file for a command since dropped, and matching the live set would strand
 * exactly those.
 *
 * Entry types ARE filtered here: `removeFiles` deletes each path with a non-recursive
 * `rmSync`, so a `caret:`-named DIRECTORY would throw, and a `caret:demo.md.bak` is not
 * a command OpenCode loads.
 * `!isDirectory()` rather than `isFile()` keeps a symlinked command file sweepable. */
export function existingLegacyInstallFiles(configDir: string): string[] {
  const plugins = LEGACY_PLUGIN_DIRNAMES.map((d) => join(configDir, d, LEGACY_PLUGIN_FILENAME));
  let entries: Dirent[];
  try {
    entries = readdirSync(join(configDir, LEGACY_COMMAND_DIRNAME), { withFileTypes: true });
  } catch {
    entries = []; // dir absent or unreadable — nothing to sweep there.
  }
  const commands = entries
    .filter((e) => !e.isDirectory() && e.name.startsWith(COMMAND_NAMESPACE))
    .filter((e) => e.name.endsWith(".md"))
    .map((e) => join(configDir, LEGACY_COMMAND_DIRNAME, e.name))
    .sort();
  return [...plugins, ...commands].filter((p) => existsSync(p));
}

/** OpenCode's cache root: XDG_CACHE_HOME, else ~/.cache — the same precedence OpenCode
 * itself uses to resolve the dir. */
function opencodeCacheRoot(): string {
  const xdg = process.env.XDG_CACHE_HOME?.trim();
  return join(xdg || join(homedir(), ".cache"), "opencode");
}

/** OpenCode v1's plugin cache: one directory per RAW `plugin` specifier string. */
function opencodeCachePackagesDir(): string {
  return join(opencodeCacheRoot(), "packages");
}

/** OpenCode v2's plugin cache: `npm/<name>@<spec>/<generation>/`, where every older
 * generation persists beside the live one. */
function opencodeNpmDir(): string {
  return join(opencodeCacheRoot(), "npm");
}

/** v2's cache dir for an npm entry: `<pkg>@<version>`, a bare entry keyed `@latest`.
 * Holds generations, not the install itself — see `liveGenerationDir`. */
export function opencodeNpmCacheDir(pkg: string, version: string | null): string {
  return join(opencodeNpmDir(), `${pkg}@${version ?? "latest"}`);
}

/** v2's cache dir for a `file:` entry, which v2's npm installer keys verbatim. */
export function opencodeNpmLocalCacheDir(spec: string): string {
  return join(opencodeNpmDir(), spec);
}

/** The generation v2 loads under one of its cache dirs: the numerically largest
 * all-digit child, or null when there is none (or no dir). */
export function liveGenerationDir(dir: string): string | null {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return null;
  }
  const generations = names.filter((n) => /^\d+$/.test(n));
  if (generations.length === 0) return null;
  return join(
    dir,
    generations.reduce((newest, name) => (Number(name) > Number(newest) ? name : newest)),
  );
}

/** v1's `packages/` cache dir for the `plugin` entry `specifier`, verbatim, pin and all; defaults to
 * the bare package `caret install` writes. */
export function opencodeCachePackageDir(specifier: string = CARET_PACKAGE): string {
  return join(opencodeCachePackagesDir(), specifier);
}

/** Every cache dir on disk for `pkg`, which the stale-cache clear removes: in v1's
 * layout the bare specifier dir and each pinned `<pkg>@<version>` sibling, in v2's each
 * whole `npm/<pkg>@<spec>/` with all its generations. OpenCode names each dir after the
 * specifier, and a pin's version segment is arbitrary (`@0.7.3`, `@latest`), so listing
 * is the only way to find one. Empty when nothing is listable. */
export function existingOpencodeCachePackageDirs(pkg: string = CARET_PACKAGE): string[] {
  return [
    ...listCacheDirs(opencodeCachePackageDir(pkg)),
    ...listCacheDirs(join(opencodeNpmDir(), pkg)),
  ];
}

/** Every caret root OpenCode has installed for `pkg`, unfiltered by existence: under each
 * v1 cache dir, and under the live generation of each v2 one (a stale generation is never
 * offered). Keep in sync with candidate_dirs()/live_generation() in bin/caret-launcher. */
export function opencodeInstalledRoots(pkg: string = CARET_PACKAGE): string[] {
  const v2 = listCacheDirs(join(opencodeNpmDir(), pkg))
    .map(liveGenerationDir)
    .filter((d) => d !== null);
  return [...listCacheDirs(opencodeCachePackageDir(pkg)), ...v2].map((d) =>
    join(d, "node_modules", pkg),
  );
}

/** `bare` itself when it exists, then each `<bare>@*` sibling. */
function listCacheDirs(bare: string): string[] {
  const parent = dirname(bare);
  const leaf = basename(bare);
  // Entry types are deliberately not filtered: the clear removes each with
  // `rmSync({ recursive, force })`, which takes a symlinked cache dir or a stray file alike.
  let names: string[];
  try {
    names = readdirSync(parent);
  } catch {
    return []; // parent dir absent or unreadable — no candidates.
  }
  const pinned = names.filter((n) => n.startsWith(`${leaf}@`)).sort();
  return [...(names.includes(leaf) ? [bare] : []), ...pinned.map((n) => join(parent, n))];
}

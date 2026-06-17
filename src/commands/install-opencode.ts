// `caret install-opencode`: deploy caret's OpenCode plugin (and command files) into
// OpenCode's auto-loaded config dir, or remove them with --uninstall. This is the
// OpenCode counterpart to the `claude plugin install` flow scripts/install.sh runs
// for Claude. It writes only caret-owned FILES (the plugin file + command files)
// and NEVER mutates the user's `plugin` config array, so an existing array of
// third-party OpenCode plugins is left untouched. --dry-run prints what would
// change without writing.

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  addPluginDependency,
  type DeployFile,
  deployFiles,
  removeFiles,
  removePluginDependency,
  renderPlugin,
} from "../adapters/opencode/deploy.ts";
import { loadOpencodePackaging, type OpencodePackaging } from "../adapters/opencode/packaging.ts";
import {
  commandDir,
  OPENCODE_PLUGIN_DEP,
  OPENCODE_PLUGIN_DEP_VERSION,
  opencodeConfigDir,
  packageJsonPath,
  pluginFilePath,
} from "../adapters/opencode/paths.ts";
import { VERSION } from "../build-id.ts";

export interface InstallOpencodeOptions {
  uninstall: boolean;
  dryRun: boolean;
}

/** Injection seam for tests: override the config dir and packaging so the whole
 * subcommand can run against a temp dir without resolving the real caret root. */
export interface InstallOpencodeDeps {
  configDir?: string;
  packaging?: OpencodePackaging;
}

/** Deploy or remove caret's OpenCode files. Resolves the config dir + caret
 * packaging, then delegates the writes to the (temp-dir-testable) deploy module. */
export function runInstallOpencodeSubcommand(
  opts: InstallOpencodeOptions,
  deps: InstallOpencodeDeps = {},
): void {
  const dir = deps.configDir ?? opencodeConfigDir();
  const pkg = deps.packaging ?? loadOpencodePackaging();
  const pluginPath = pluginFilePath(dir);
  const commandPaths = pkg.commands.map((c) => join(commandDir(dir), c.name));

  if (opts.uninstall) {
    const result = removeFiles([pluginPath, ...commandPaths], { dryRun: opts.dryRun });
    const manifest = uninstallManifest(dir, opts.dryRun);
    printResult("removed", [...result.paths, ...manifest], opts.dryRun, dir);
    return;
  }

  const files: DeployFile[] = [
    {
      path: pluginPath,
      contents: renderPlugin(pkg.pluginSource, { version: VERSION, binPath: pkg.binPath }),
    },
    ...pkg.commands.map((c) => ({
      path: join(commandDir(dir), c.name),
      contents: renderPlugin(c.contents, { version: VERSION, binPath: pkg.binPath }),
    })),
  ];
  const result = deployFiles(files, { dryRun: opts.dryRun });
  const manifest = installManifest(dir, opts.dryRun);
  printResult("installed", [...result.paths, ...manifest], opts.dryRun, dir);
}

/** Write (or merge into) the config dir's package.json so OpenCode installs the
 * deployed plugin's `@opencode-ai/plugin` dependency at startup — without it the
 * plugin's import is unresolvable and the review tool never registers. Returns the
 * manifest path (for the result) or `[]` when it was left untouched. */
function installManifest(dir: string, dryRun: boolean): string[] {
  const path = packageJsonPath(dir);
  const existing = existsSync(path) ? readFileSync(path, "utf-8") : null;
  let next: string;
  try {
    next = addPluginDependency(existing, OPENCODE_PLUGIN_DEP, OPENCODE_PLUGIN_DEP_VERSION);
  } catch {
    process.stderr.write(
      `caret: ${path} is not valid JSON — leaving it untouched. Add "${OPENCODE_PLUGIN_DEP}": "${OPENCODE_PLUGIN_DEP_VERSION}" to its dependencies so OpenCode can load the plugin.\n`,
    );
    return [];
  }
  if (!dryRun) writeFileSync(path, next);
  return [path];
}

/** Undo `installManifest`: drop caret's dependency from the config dir's
 * package.json, deleting the file when caret's dep was the only thing in it. Other
 * dependencies and other keys are preserved. Returns the manifest path when it was
 * changed/removed, or `[]` when there was nothing of caret's to remove. */
function uninstallManifest(dir: string, dryRun: boolean): string[] {
  const path = packageJsonPath(dir);
  if (!existsSync(path)) return [];
  const existing = readFileSync(path, "utf-8");
  let next: string | null;
  try {
    next = removePluginDependency(existing, OPENCODE_PLUGIN_DEP);
  } catch {
    return []; // unparseable — not caret's to clean up
  }
  if (next === existing) return []; // caret's dep wasn't there; leave the file alone
  if (!dryRun) {
    if (next === null) rmSync(path, { force: true });
    else writeFileSync(path, next);
  }
  return [path];
}

function printResult(verb: string, paths: string[], dryRun: boolean, dir: string): void {
  const lead = dryRun ? `[dry-run] would have ${verb}` : `${verb}`;
  process.stdout.write(`caret: ${lead} ${paths.length} OpenCode file(s) under ${dir}:\n`);
  for (const p of paths) process.stdout.write(`  ${p}\n`);
}

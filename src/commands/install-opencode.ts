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
  stripNonDefaultExports,
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

/** Installs the config-dir package.json's dependency (`bun install` in that dir).
 * Returns ok + a failure detail rather than throwing — install is best-effort. */
export type DepInstaller = (configDir: string) => { ok: boolean; detail: string };

/** Injection seam for tests: override the config dir, packaging, and the dependency
 * installer so the whole subcommand can run against a temp dir without resolving the
 * real caret root or shelling out to `bun`. */
export interface InstallOpencodeDeps {
  configDir?: string;
  packaging?: OpencodePackaging;
  installDeps?: DepInstaller;
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
      // Strip non-default exports: OpenCode rejects a plugin module that exports
      // any non-Plugin value (caret's source exports test helpers/constants).
      contents: stripNonDefaultExports(
        renderPlugin(pkg.pluginSource, { version: VERSION, binPath: pkg.binPath }),
      ),
    },
    ...pkg.commands.map((c) => ({
      path: join(commandDir(dir), c.name),
      contents: renderPlugin(c.contents, { version: VERSION, binPath: pkg.binPath }),
    })),
  ];
  const result = deployFiles(files, { dryRun: opts.dryRun });
  const manifest = installManifest(dir, opts.dryRun);
  if (!opts.dryRun) ensureDependencyInstalled(dir, deps.installDeps ?? bunInstall);
  printResult("installed", [...result.paths, ...manifest], opts.dryRun, dir);
}

/** Install the plugin's npm dependency into the config dir ourselves rather than
 * relying on OpenCode's startup installer — which pins `@opencode-ai/plugin` to its
 * OWN version and fails against its date-capped registry snapshot. Best-effort: a
 * missing `bun` or a failed install degrades to a clear instruction (the deployed
 * `package.json` records the dep, so a later `bun install` finishes the job). */
function ensureDependencyInstalled(dir: string, install: DepInstaller): void {
  const r = install(dir);
  if (r.ok) {
    process.stdout.write(`caret: installed the plugin dependency (${OPENCODE_PLUGIN_DEP}).\n`);
  } else {
    process.stderr.write(
      `caret: could not auto-install the plugin dependency (${r.detail}). Run \`bun install\` in ${dir} to finish, then restart OpenCode.\n`,
    );
  }
}

/** Production dependency installer: `bun install` in the config dir. Resolves `bun`
 * from PATH; any failure (missing bun, network) is reported, not thrown. */
const bunInstall: DepInstaller = (configDir) => {
  try {
    const res = Bun.spawnSync(["bun", "install"], {
      cwd: configDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (res.exitCode === 0) return { ok: true, detail: "" };
    const err = new TextDecoder().decode(res.stderr).trim();
    return { ok: false, detail: err || `bun install exited ${res.exitCode}` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
};

/** Write (or merge into) the config dir's package.json declaring the deployed
 * plugin's `@opencode-ai/plugin` dependency — the manifest `bun install` reads to
 * fetch it (both caret's own install below and OpenCode's startup install). Without
 * the dependency the plugin's import is unresolvable and the review tool never
 * registers. Returns the manifest path (for the result) or `[]` when left untouched. */
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

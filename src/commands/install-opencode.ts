// `caret install-opencode`: deploy caret's OpenCode plugin (and command files) into
// OpenCode's auto-loaded config dir, or remove them with --uninstall. This is the
// OpenCode counterpart to the `claude plugin install` flow scripts/install.sh runs
// for Claude. It writes only caret-owned FILES (the plugin file + command files)
// and NEVER mutates the user's `plugin` config array, so an existing array of
// third-party OpenCode plugins is left untouched. --dry-run prints what would
// change without writing.

import { join } from "node:path";
import {
  type DeployFile,
  deployFiles,
  removeFiles,
  renderPlugin,
} from "../adapters/opencode/deploy.ts";
import { loadOpencodePackaging } from "../adapters/opencode/packaging.ts";
import { commandDir, opencodeConfigDir, pluginFilePath } from "../adapters/opencode/paths.ts";
import { VERSION } from "../build-id.ts";

export interface InstallOpencodeOptions {
  uninstall: boolean;
  dryRun: boolean;
}

/** Deploy or remove caret's OpenCode files. Resolves the config dir + caret
 * packaging, then delegates the writes to the (temp-dir-testable) deploy module. */
export function runInstallOpencodeSubcommand(opts: InstallOpencodeOptions): void {
  const dir = opencodeConfigDir();
  const pkg = loadOpencodePackaging();
  const pluginPath = pluginFilePath(dir);
  const commandPaths = pkg.commands.map((c) => join(commandDir(dir), c.name));

  if (opts.uninstall) {
    const result = removeFiles([pluginPath, ...commandPaths], { dryRun: opts.dryRun });
    printResult("removed", result.paths, opts.dryRun, dir);
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
  printResult("installed", result.paths, opts.dryRun, dir);
}

function printResult(verb: string, paths: string[], dryRun: boolean, dir: string): void {
  const lead = dryRun ? `[dry-run] would have ${verb}` : `${verb}`;
  process.stdout.write(`caret: ${lead} ${paths.length} OpenCode file(s) under ${dir}:\n`);
  for (const p of paths) process.stdout.write(`  ${p}\n`);
}

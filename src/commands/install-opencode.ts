// caret's OpenCode install target. `caret install --target opencode` makes caret a
// first-class `plugin` array entry (@macintacos/caret) — OpenCode installs the
// package and its deps into its own cache and loads it — and deploys the `/caret:*`
// command files (which aren't array-installable). `--uninstall` reverses both. The
// config-array edit is comment-preserving (config-plugin.ts); the command-file
// writes go through the temp-dir-testable deploy module. Injection seams let the
// whole target run against a temp dir without resolving the real caret root.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  addPluginToConfigText,
  removePluginFromConfigText,
} from "@/adapters/opencode/config-plugin.ts";
import {
  type DeployFile,
  deployFiles,
  removeFiles,
  renderPlugin,
} from "@/adapters/opencode/deploy.ts";
import { loadOpencodePackaging, type OpencodePackaging } from "@/adapters/opencode/packaging.ts";
import {
  CARET_PACKAGE,
  commandDir,
  namespacedCommandFilename,
  opencodeConfigDir,
  resolveConfigFile,
} from "@/adapters/opencode/paths.ts";
import { VERSION } from "@/lib/build-id.ts";

/** Injection seam for tests: override the config dir and packaging so the target
 * can run against a temp dir without resolving the real caret root. */
export interface InstallOpencodeDeps {
  configDir?: string;
  packaging?: OpencodePackaging;
}

/** Install (or, with `uninstall`, remove) caret into OpenCode: edit the config's
 * `plugin` array to add/remove `@macintacos/caret`, and deploy/remove the `/caret:*`
 * command files. OpenCode installs the package (and the plugin's deps) itself on its
 * next start, so there is no manifest to write and no `bun install` to run here. */
export function runInstallOpencodeTarget(
  opts: { uninstall: boolean; dryRun: boolean },
  deps: InstallOpencodeDeps = {},
): void {
  const dir = deps.configDir ?? opencodeConfigDir();
  const pkg = deps.packaging ?? loadOpencodePackaging();
  const configFile = resolveConfigFile(dir);
  const commandPaths = pkg.commands.map((c) =>
    join(commandDir(dir), namespacedCommandFilename(c.name)),
  );

  if (opts.uninstall) {
    const changed = editConfig(
      configFile,
      (text) => (text === null ? null : removePluginFromConfigText(text, CARET_PACKAGE)),
      opts.dryRun,
    );
    const removed = removeFiles(commandPaths, { dryRun: opts.dryRun });
    printResult("removed", [...changed, ...removed.paths], opts.dryRun, dir);
    return;
  }

  const changed = editConfig(
    configFile,
    (text) => addPluginToConfigText(text, CARET_PACKAGE),
    opts.dryRun,
  );
  const files: DeployFile[] = pkg.commands.map((c) => ({
    // Namespace the command file (`demo.md` -> `caret:demo.md`) so OpenCode exposes
    // it as `/caret:demo`. The command files' `__CARET_BIN__` marker is substituted
    // with the running caret binary (the one invoking `caret install`).
    path: join(commandDir(dir), namespacedCommandFilename(c.name)),
    contents: renderPlugin(c.contents, { version: VERSION, binPath: pkg.binPath }),
  }));
  const deployed = deployFiles(files, { dryRun: opts.dryRun });
  printResult("installed", [...changed, ...deployed.paths], opts.dryRun, dir);
}

/** Apply `transform` to the config file's text (null when the file is absent),
 * writing the result when it changes. Returns `[path]` when the file was (or, in
 * dry-run, would be) changed, else `[]`. A `null` transform result means "nothing
 * to do" (e.g. removing from a config that doesn't exist). */
function editConfig(
  path: string,
  transform: (text: string | null) => string | null,
  dryRun: boolean,
): string[] {
  const existing = existsSync(path) ? readFileSync(path, "utf-8") : null;
  const next = transform(existing);
  if (next === null || next === existing) return [];
  if (!dryRun) writeFileSync(path, next);
  return [path];
}

function printResult(verb: string, paths: string[], dryRun: boolean, dir: string): void {
  if (paths.length === 0) {
    const noun = verb === "removed" ? "remove" : "install";
    process.stdout.write(`caret: nothing to ${noun} for OpenCode under ${dir}.\n`);
    return;
  }
  const lead = dryRun ? `[dry-run] would have ${verb}` : verb;
  process.stdout.write(
    `caret: ${lead} caret in OpenCode (${paths.length} path(s)) under ${dir}:\n`,
  );
  for (const p of paths) process.stdout.write(`  ${p}\n`);
  if (verb === "installed" && !dryRun) {
    process.stdout.write("caret: restart OpenCode once so it installs and loads the plugin.\n");
  }
}

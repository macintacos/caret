// caret's OpenCode install target. `caret install --target opencode` makes caret a
// first-class `plugin` array entry (@macintacos/caret) — OpenCode installs the
// package and its deps into its own cache and loads it — and deploys the `/caret:*`
// command files (which aren't array-installable). `--uninstall` reverses both. The
// config-array edit is comment-preserving (config-plugin.ts); the command-file
// writes go through the temp-dir-testable deploy module. Injection seams let the
// whole target run against a temp dir without resolving the real caret root.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

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
import type { InstallUI } from "@/commands/install/ui.ts";
import { silentUI } from "@/commands/install/ui.ts";
import { VERSION } from "@/lib/build-id.ts";

/** Injection seam for tests: override the config dir and packaging so the target
 * can run against a temp dir without resolving the real caret root. */
export interface InstallOpencodeDeps {
  configDir?: string;
  packaging?: OpencodePackaging;
  ui?: InstallUI;
}

/** Install (or, with `uninstall`, remove) caret into OpenCode: edit the config's
 * `plugin` array to add/remove `@macintacos/caret`, and deploy/remove the `/caret:*`
 * command files. OpenCode installs the package (and the plugin's deps) itself on its
 * next start, so there is no manifest to write and no `bun install` to run here. The
 * two halves are reported as their own steps — the config edit and the command files
 * fail independently, so a reader can see which one did what. */
export async function runInstallOpencodeTarget(
  opts: { uninstall: boolean; dryRun: boolean },
  deps: InstallOpencodeDeps = {},
): Promise<void> {
  const dir = deps.configDir ?? opencodeConfigDir();
  const pkg = deps.packaging ?? loadOpencodePackaging();
  const ui = deps.ui ?? silentUI;
  const configFile = resolveConfigFile(dir);
  const commandPaths = pkg.commands.map((c) =>
    join(commandDir(dir), namespacedCommandFilename(c.name)),
  );

  if (opts.dryRun) {
    const verb = opts.uninstall ? "remove" : "write";
    ui.note([configFile, ...commandPaths].join("\n"), `OpenCode — would ${verb}`);
    return;
  }

  if (opts.uninstall) {
    await ui.step(
      `Removing ${CARET_PACKAGE} from OpenCode's plugin array`,
      async () =>
        editConfig(configFile, (text) =>
          text === null ? null : removePluginFromConfigText(text, CARET_PACKAGE),
        ),
      (changed) =>
        changed.length > 0
          ? `Removed ${CARET_PACKAGE} from ${basename(configFile)}`
          : `${CARET_PACKAGE} was not in ${basename(configFile)}`,
    );
    await ui.step(
      "Removing the /caret:* command files",
      async () => removeFiles(commandPaths, { dryRun: false }),
      (removed) => `Removed ${removed.paths.length} command file(s) from ${dir}`,
    );
    return;
  }

  await ui.step(
    `Adding ${CARET_PACKAGE} to OpenCode's plugin array`,
    async () => editConfig(configFile, (text) => addPluginToConfigText(text, CARET_PACKAGE)),
    (changed) =>
      changed.length > 0
        ? `Added ${CARET_PACKAGE} to ${basename(configFile)}`
        : `${CARET_PACKAGE} was already in ${basename(configFile)}`,
  );
  const files: DeployFile[] = pkg.commands.map((c) => ({
    // Namespace the command file (`demo.md` -> `caret:demo.md`) so OpenCode exposes
    // it as `/caret:demo`. The command files' `__CARET_BIN__` marker is substituted
    // with the running caret binary (the one invoking `caret install`).
    path: join(commandDir(dir), namespacedCommandFilename(c.name)),
    contents: renderPlugin(c.contents, { version: VERSION, binPath: pkg.binPath }),
  }));
  await ui.step(
    "Deploying the /caret:* command files",
    async () => deployFiles(files, { dryRun: false }),
    (deployed) => `Deployed ${deployed.paths.length} command file(s) to ${dir}`,
  );
}

/** Apply `transform` to the config file's text (null when the file is absent),
 * writing the result when it changes. Returns `[path]` when the file was changed, else
 * `[]`. A `null` transform result means "nothing to do" (e.g. removing from a config
 * that doesn't exist). Dry-run never reaches here — it returns after the preview. */
function editConfig(path: string, transform: (text: string | null) => string | null): string[] {
  const existing = existsSync(path) ? readFileSync(path, "utf-8") : null;
  const next = transform(existing);
  if (next === null || next === existing) return [];
  writeFileSync(path, next);
  return [path];
}

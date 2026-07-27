// caret's OpenCode install target. `caret install --target opencode` makes caret a
// first-class `plugin` array entry (@macintacos/caret) — OpenCode installs the
// package and its deps into its own cache and loads it — and deploys the `/caret:*`
// command files (which aren't array-installable). `--uninstall` reverses both. The
// config-array edit is comment-preserving (config-plugin.ts); the command-file
// writes go through the temp-dir-testable deploy module. Injection seams let the
// whole target run against a temp dir without resolving the real caret root.
//
// Between the two, install checks whether the caret OpenCode would actually load is
// behind the published one. It has to: OpenCode resolves a `plugin` array entry once
// and caches it forever, so adding the entry again — all a re-run of this target would
// otherwise do — never moves anyone off the version they installed on.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import {
  addPluginToConfigText,
  findPluginEntry,
  removePluginFromConfigText,
  setPluginVersionInConfigText,
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
  existingOpencodeCachePackageDirs,
  namespacedCommandFilename,
  opencodeConfigDir,
  resolveConfigFile,
} from "@/adapters/opencode/paths.ts";
import {
  clearCachedCaret,
  publishedCaretVersion,
  readCachedCaretVersion,
  type UpgradeVerdict,
  upgradeVerdict,
} from "@/adapters/opencode/upgrade.ts";
import { promptUpgrade, type StaleVerdict, upgradeVerdictLine } from "@/commands/install/prompt.ts";
import type { InstallUI } from "@/commands/install/ui.ts";
import { isTerminal, silentUI } from "@/commands/install/ui.ts";
import { VERSION } from "@/lib/build-id.ts";

/** Injection seam for tests: override the config dir and packaging so the target
 * can run against a temp dir without resolving the real caret root, and every effect
 * the upgrade check performs so its branches run without a network, a terminal, or a
 * real cache dir. */
export interface InstallOpencodeDeps {
  configDir?: string;
  packaging?: OpencodePackaging;
  ui?: InstallUI;
  published?: () => Promise<string | null>;
  cacheDirs?: () => string[];
  clearCache?: (dirs: readonly string[]) => string[];
  confirm?: (verdict: StaleVerdict) => Promise<boolean | null>;
  isInteractive?: () => boolean;
}

/** Install (or, with `uninstall`, remove) caret into OpenCode: edit the config's
 * `plugin` array to add/remove `@macintacos/caret`, and deploy/remove the `/caret:*`
 * command files. OpenCode installs the package (and the plugin's deps) itself on its
 * next start, so there is no manifest to write and no `bun install` to run here. The
 * two halves are reported as their own steps — the config edit and the command files
 * fail independently, so a reader can see which one did what. */
export async function runInstallOpencodeTarget(
  opts: { uninstall: boolean; dryRun: boolean; refresh: boolean },
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
    // The check is read-only, so a preview can still run it and say what it found.
    const found = opts.uninstall ? [] : ["", upgradeVerdictLine(await check(configFile, deps))];
    ui.note([configFile, ...commandPaths, ...found].join("\n"), `OpenCode — would ${verb}`);
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
  // After the array edit — the entry has to exist before it can be read — and before the
  // command files, so a cache clear is settled by the time the run reports it deployed.
  await upgradeStep(configFile, opts, deps, ui);
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

/** Compare the caret OpenCode would load against npm's published one. Read-only: the
 * config entry, the cache, and the registry are all just read, so a dry run may call it
 * too. Each read degrades to null on its own, and the verdict decides what that means. */
async function check(configFile: string, deps: InstallOpencodeDeps): Promise<UpgradeVerdict> {
  return upgradeVerdict({
    entry: findPluginEntry(readConfigText(configFile), CARET_PACKAGE),
    cached: readCachedCaretVersion((deps.cacheDirs ?? existingOpencodeCachePackageDirs)()),
    published: await (deps.published ?? publishedCaretVersion)(),
  });
}

/** Report the upgrade check, then act on it. Only a stale verdict has anything to do,
 * and only with a yes: `--refresh` pre-answers, a terminal is asked, and a run with
 * neither is told the command that would take the upgrade. A `null` (cancelled) answer
 * is a "no", not a failure — and neither is `unknown`, which warns and changes nothing,
 * the way the rumdl step treats its own failure. */
async function upgradeStep(
  configFile: string,
  opts: { refresh: boolean },
  deps: InstallOpencodeDeps,
  ui: InstallUI,
): Promise<void> {
  const verdict = await ui.step(
    "Checking OpenCode's caret version",
    () => check(configFile, deps),
    upgradeVerdictLine,
  );
  if (verdict.kind === "unknown") {
    ui.warn(`Could not check OpenCode's caret version (${verdict.reason}) — nothing changed.`);
    return;
  }
  if (verdict.kind !== "stale-cache" && verdict.kind !== "stale-pin") return;

  // Deciding happens outside every step: a prompt drawn under a running spinner corrupts
  // the render, which is why the target chooser is called from outside them too.
  if (!opts.refresh) {
    if (!(deps.isInteractive ?? isTerminal)()) {
      const take = verdict.kind === "stale-pin" ? "bump the pin" : "take it";
      ui.info(`${upgradeVerdictLine(verdict)}. Re-run with --refresh to ${take}.`);
      return;
    }
    if ((await (deps.confirm ?? promptUpgrade)(verdict)) !== true) return;
  }

  if (verdict.kind === "stale-cache") {
    const dirs = (deps.cacheDirs ?? existingOpencodeCachePackageDirs)();
    await ui.step(
      "Clearing OpenCode's cached caret",
      async () => (deps.clearCache ?? clearCachedCaret)(dirs),
      (cleared) =>
        `Cleared ${cleared.length} cached ${cleared.length === 1 ? "copy" : "copies"} — OpenCode re-resolves on next start`,
    );
    return;
  }
  // A bump deliberately leaves the cache alone: the new specifier string gets its own
  // cache dir, and the old pin's dir is not caret's to delete.
  await ui.step(
    `Bumping ${CARET_PACKAGE} to ${verdict.published}`,
    async () =>
      editConfig(configFile, (text) =>
        text === null ? null : setPluginVersionInConfigText(text, CARET_PACKAGE, verdict.published),
      ),
    (changed) =>
      changed.length > 0
        ? `Bumped the pin to ${CARET_PACKAGE}@${verdict.published}`
        : `Left ${basename(configFile)} unchanged`,
  );
}

/** The config file's text, or null when it is absent. */
function readConfigText(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf-8") : null;
}

/** Apply `transform` to the config file's text (null when the file is absent),
 * writing the result when it changes. Returns `[path]` when the file was changed, else
 * `[]`. A `null` transform result means "nothing to do" (e.g. removing from a config
 * that doesn't exist). Dry-run never reaches here — it returns after the preview. */
function editConfig(path: string, transform: (text: string | null) => string | null): string[] {
  const existing = readConfigText(path);
  const next = transform(existing);
  if (next === null || next === existing) return [];
  writeFileSync(path, next);
  return [path];
}

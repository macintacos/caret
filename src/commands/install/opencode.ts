// caret's OpenCode install target. `caret install --target opencode` makes caret a
// first-class `plugin` array entry — OpenCode installs it and its deps into its own
// cache and loads it — and deploys the `/caret:*` command files (which aren't
// array-installable). `--uninstall` reverses both. Either arm also sweeps the plugin and
// command FILES an older caret deployed into the config dir: OpenCode still loads them,
// so a leftover plugin file would register a second review tool beside the array entry.
// The config-array edit is comment-preserving (config-plugin.ts); the command-file writes
// go through the temp-dir-testable deploy module. Injection seams let the whole target run
// against a temp dir without resolving the real caret root.
//
// The entry takes one of two forms, and caret owns exactly one of them at a time: the
// npm package (@macintacos/caret) for a published install, or `file:<checkout>` under
// `--from-local`. OpenCode symlinks a `file:` target into its cache, so the local form
// loads the checkout's own plugin and spawns the checkout's own binary — what makes
// `mise run build --install` put the developer's build in front of OpenCode rather
// than whatever npm copy the cache happens to hold.
//
// Between the two, a published install checks whether the caret OpenCode would actually
// load is behind the published one. It has to: OpenCode resolves a `plugin` array entry
// once and caches it forever, so adding the entry again — all a re-run of this target
// would otherwise do — never moves anyone off the version they installed on.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import {
  addPluginToConfigText,
  findPluginEntry,
  pluginEntries,
  removePluginFromConfigText,
  setPluginVersionInConfigText,
  splitPluginSpecifier,
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
  existingLegacyInstallFiles,
  existingOpencodeCachePackageDirs,
  isLocalPluginSpecifier,
  localPluginSpecifier,
  localSpecifierPath,
  namespacedCommandFilename,
  opencodeConfigDir,
  resolveConfigFile,
} from "@/adapters/opencode/paths.ts";
import {
  clearCachedCaret,
  readCachedCaretVersion,
  type UpgradeVerdict,
  upgradeVerdict,
} from "@/adapters/opencode/upgrade.ts";
import type { LocalInstall } from "@/commands/install/local.ts";
import { promptUpgrade, type StaleVerdict, upgradeVerdictLine } from "@/commands/install/prompt.ts";
import type { InstallUI } from "@/commands/install/ui.ts";
import { isTerminal, silentUI } from "@/commands/install/ui.ts";
import { VERSION } from "@/lib/build-id.ts";
import { publishedCaretVersion } from "@/lib/upstream.ts";

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
  isCheckout?: (dir: string) => boolean;
}

/** Whether `dir` is a caret checkout, by the one file OpenCode would have to load out of
 * it. The same probe `resolveCaretRoot` uses, so "is this a caret?" has one answer. */
function isCaretCheckout(dir: string): boolean {
  return existsSync(join(dir, "opencode", "caret.plugin.ts"));
}

/** The `plugin` array entries that are caret's: the npm package under any pin, plus any
 * local specifier whose path is a caret checkout. A `file:` entry pointing elsewhere
 * belongs to another tool and is left alone. */
function caretEntries(text: string | null, isCheckout: (dir: string) => boolean): string[] {
  return pluginEntries(text).filter((entry) => {
    const path = localSpecifierPath(entry);
    return path === undefined
      ? splitPluginSpecifier(entry).pkg === CARET_PACKAGE
      : isCheckout(path);
  });
}

/** Whether an existing caret entry is the same FORM as the one being written, and so may
 * stay. Two package entries are the same form even when one carries a version pin — the
 * pin is the user's, and `addPluginToConfigText` is idempotent over it. Two local entries
 * match only when they name the same checkout: a second checkout has to replace the
 * first, since caret gets one entry. */
function sameEntryForm(entry: string, specifier: string): boolean {
  const entryIsLocal = isLocalPluginSpecifier(entry);
  if (entryIsLocal !== isLocalPluginSpecifier(specifier)) return false;
  return entryIsLocal ? entry === specifier : true;
}

/** Rewrite the `plugin` array so caret's single entry is `specifier`, dropping any entry
 * of the other form. Leaving both a package entry and a local one would load two caret
 * plugins, each registering the review tool — and the published one would answer with a
 * caret the developer did not build. */
function setCaretPluginEntry(
  text: string | null,
  specifier: string,
  isCheckout: (dir: string) => boolean,
): string {
  if (text === null) return addPluginToConfigText(null, specifier);
  const pruned = caretEntries(text, isCheckout)
    .filter((entry) => !sameEntryForm(entry, specifier))
    .reduce((acc, entry) => removePluginFromConfigText(acc, entry), text);
  return addPluginToConfigText(pruned, specifier);
}

/** Install (or, with `uninstall`, remove) caret into OpenCode: edit the config's
 * `plugin` array to add/remove `@macintacos/caret`, deploy/remove the `/caret:*`
 * command files, and sweep whatever the file-deploy era left in the config dir.
 * OpenCode installs the package (and the plugin's deps) itself on its next start, so
 * there is no manifest to write and no `bun install` to run here. Each piece is its own
 * step — they fail independently, so a reader can see which one did what. */
export async function runInstallOpencodeTarget(
  opts: { uninstall: boolean; dryRun: boolean; refresh: boolean; local?: LocalInstall },
  deps: InstallOpencodeDeps = {},
): Promise<void> {
  const dir = deps.configDir ?? opencodeConfigDir();
  const pkg = deps.packaging ?? loadOpencodePackaging();
  const ui = deps.ui ?? silentUI;
  const isCheckout = deps.isCheckout ?? isCaretCheckout;
  const configFile = resolveConfigFile(dir);
  const commandPaths = pkg.commands.map((c) =>
    join(commandDir(dir), namespacedCommandFilename(c.name)),
  );
  const legacy = existingLegacyInstallFiles(dir);
  // `--from-local` points the array entry at the checkout instead of the npm package.
  // OpenCode symlinks a `file:` target into its cache, so the plugin it loads is the
  // checkout's own — and the `../bin/caret` that plugin spawns is the binary
  // `mise run build` just produced, picked up on every later rebuild with no reinstall.
  const specifier = opts.local ? localPluginSpecifier(opts.local.repoDir) : CARET_PACKAGE;

  if (opts.dryRun) {
    const verb = opts.uninstall ? "remove" : "write";
    // The check is read-only, so a preview can still run it and say what it found. A
    // preview has no warning to carry an `unknown`'s reason, so the note carries it.
    const found = checks(opts) ? ["", previewLine(await check(configFile, deps))] : [];
    // The specifier is the one thing a preview can't be read off the paths: `--from-local`
    // and a published install write the same file with very different content.
    const entry = opts.uninstall ? [] : ["", `plugin entry: ${specifier}`];
    // Their own labelled section: an install's bare path list is titled "would write", and
    // listing a file caret is about to DELETE under that heading would misread badly.
    const sweep = legacy.length === 0 ? [] : ["", "pre-array-install files to remove:", ...legacy];
    ui.note(
      [configFile, ...commandPaths, ...entry, ...sweep, ...found].join("\n"),
      `OpenCode — would ${verb}`,
    );
    return;
  }

  if (opts.uninstall) {
    // Every form caret may have written, not just the package: a developer who ran
    // `--from-local` has a checkout entry, and an uninstall that left it behind would
    // keep OpenCode loading caret after saying it removed it.
    await ui.step(
      "Removing caret from OpenCode's plugin array",
      async () =>
        editConfig(configFile, (text) =>
          text === null
            ? null
            : caretEntries(text, isCheckout).reduce(
                (acc, entry) => removePluginFromConfigText(acc, entry),
                text,
              ),
        ),
      (changed) =>
        changed.length > 0
          ? `Removed caret from ${basename(configFile)}`
          : `caret was not in ${basename(configFile)}`,
    );
    await ui.step(
      "Removing the /caret:* command files",
      async () => removeFiles(commandPaths, { dryRun: false }),
      (removed) => `Removed ${removed.paths.length} command file(s) from ${dir}`,
    );
    await sweepLegacy(legacy, dir, ui);
    return;
  }

  await ui.step(
    `Adding ${specifier} to OpenCode's plugin array`,
    async () => editConfig(configFile, (text) => setCaretPluginEntry(text, specifier, isCheckout)),
    (changed) =>
      changed.length > 0
        ? `Added ${specifier} to ${basename(configFile)}`
        : `${specifier} was already in ${basename(configFile)}`,
  );
  // After the array edit — the entry has to exist before it can be read — and before the
  // command files, so a cache clear is settled by the time the run reports it deployed.
  if (checks(opts)) await upgradeStep(configFile, opts, deps, ui);
  // Only once the array entry exists and a stale cached copy has been offered a refresh:
  // dropping the plugin file any earlier could move a user backwards onto an older cached
  // caret. It still sweeps when that refresh is declined — two loaded caret plugins are
  // worse than one stale-but-single plugin, and the user was just given the fix.
  await sweepLegacy(legacy, dir, ui);
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

/** Remove the file-deploy era's leftovers, on both arms. Unlike every other step here it
 * is raised only when there is something to remove: the others describe the command's
 * primary work, so a zero outcome is still information, while this one is a migration
 * concern that would otherwise print an empty line into every install transcript
 * forever. */
async function sweepLegacy(legacy: string[], dir: string, ui: InstallUI): Promise<void> {
  if (legacy.length === 0) return;
  await ui.step(
    "Removing the pre-array-install files",
    async () => removeFiles(legacy, { dryRun: false }),
    (removed) => `Removed ${removed.paths.length} pre-array-install file(s) from ${dir}`,
  );
}

/** Whether this run asks npm which caret is published. An uninstall is tearing caret out,
 * so there is nothing to compare. `--from-local` writes a checkout entry, which OpenCode
 * resolves to that checkout every start — it can never be stale, so npm's version says
 * nothing about it and a network read mid-build would only cost a stall. The Claude target
 * skips its own update phase in local mode for the same reason. */
function checks(opts: { uninstall: boolean; local?: LocalInstall }): boolean {
  return !opts.uninstall && opts.local === undefined;
}

/** The verdict as a dry run states it: the settled line, plus an `unknown`'s reason —
 * which the live path reports as a warning the preview has no room for. */
function previewLine(verdict: UpgradeVerdict): string {
  const line = upgradeVerdictLine(verdict);
  return verdict.kind === "unknown" ? `${line} (${verdict.reason})` : line;
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

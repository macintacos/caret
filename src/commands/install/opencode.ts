// caret's OpenCode install target. `caret install` makes caret an entry in the host's
// plugin key (`plugins` on v2, else `plugin`) — OpenCode installs it and its deps into its
// own cache and loads it — and
// deploys the `/caret:*` command files (which aren't array-installable). `--uninstall`
// reverses both. Either arm also sweeps the plugin and command FILES an older caret
// deployed into the config dir: OpenCode still loads them, so a leftover plugin file
// would register a second review tool beside the array entry. The config-array edit is
// comment-preserving (config-plugin.ts).
//
// caret owns exactly one entry across both keys, in one of two forms: the npm package
// (@macintacos/caret), or `file:<checkout>` under `--from-local`. A published install
// also checks whether the caret OpenCode would load is behind the published one, because
// OpenCode resolves an array entry once and caches it forever — re-adding the entry, all
// a re-run would otherwise do, never moves anyone off the version they installed on.

import { writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import {
  addPluginToConfigText,
  type PluginKey,
  setPluginVersionInConfigText,
  splitPluginSpecifier,
} from "@/adapters/opencode/config-plugin.ts";
import {
  type DeployFile,
  deployFiles,
  removeFiles,
  renderPlugin,
} from "@/adapters/opencode/deploy.ts";
import {
  type CaretEntry,
  caretEntries,
  caretPackageEntry,
  dropEntries,
  isCaretCheckout,
  readConfigText,
} from "@/adapters/opencode/entries.ts";
import { pluginKeyFor, readOpencodeVersion } from "@/adapters/opencode/host.ts";
import { loadOpencodePackaging, type OpencodePackaging } from "@/adapters/opencode/packaging.ts";
import {
  CARET_PACKAGE,
  commandDir,
  existingLegacyInstallFiles,
  existingOpencodeCachePackageDirs,
  isLocalPluginSpecifier,
  localPluginSpecifier,
  namespacedCommandFilename,
  opencodeConfigDir,
  resolveConfigFile,
} from "@/adapters/opencode/paths.ts";
import {
  clearCachedCaret,
  readUpgradeVerdict,
  type StaleVerdict,
  type UpgradeVerdict,
  upgradeVerdictLine,
} from "@/adapters/opencode/upgrade.ts";
import type { LocalInstall } from "@/commands/install/local.ts";
import { promptUpgrade } from "@/commands/install/prompt.ts";
import type { InstallUI } from "@/commands/install/ui.ts";
import { isTerminal, silentUI } from "@/commands/install/ui.ts";
import { VERSION } from "@/lib/build-id.ts";
import type { VersionTriple } from "@/lib/semver.ts";

/** Injection seam for tests: override the config dir and packaging so the target
 * can run against a temp dir without resolving the real caret root, and every effect
 * the upgrade check performs so its branches run without a network, a terminal, or a
 * real cache dir. */
export interface InstallOpencodeDeps {
  configDir?: string;
  packaging?: OpencodePackaging;
  ui?: InstallUI;
  published?: () => Promise<string | null>;
  /** Resolves the cache dir a plugin entry's version is read from. */
  cacheDir?: (entry: CaretEntry) => string | null;
  /** Every caret cache dir the stale-cache clear removes. */
  cacheDirs?: () => string[];
  clearCache?: (dirs: readonly string[]) => string[];
  confirm?: (verdict: StaleVerdict) => Promise<boolean | null>;
  isInteractive?: () => boolean;
  isCheckout?: (dir: string) => boolean;
  opencodeVersion?: () => VersionTriple | null;
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

/** The existing entry of `specifier`'s form that install keeps: the first pinned one in
 * load order — so the user's pin survives a move — else the first; undefined when there
 * is none and `specifier` is added. */
function keptEntry(entries: readonly CaretEntry[], specifier: string): CaretEntry | undefined {
  const sameForm = entries.filter((e) => sameEntryForm(e.spec, specifier));
  return sameForm.find((e) => splitPluginSpecifier(e.spec).version !== null) ?? sameForm[0];
}

/** Rewrite both plugin keys so caret has exactly one entry, in `key`: `keptEntry`, else
 * `specifier`. Two caret entries would load two plugins, each registering the review tool
 * (v2 rejects them outright as a duplicate id). A kept entry already in `key` stays in
 * place, as written. */
function setCaretPluginEntry(
  text: string | null,
  target: { specifier: string; key: PluginKey; isCheckout: (dir: string) => boolean },
): string {
  const { specifier, key, isCheckout } = target;
  if (text === null) return addPluginToConfigText(null, specifier, key);
  const entries = caretEntries(text, isCheckout);
  const kept = keptEntry(entries, specifier);
  const keptInPlace = kept?.key === key ? kept : undefined;
  const pruned = dropEntries(
    text,
    entries.filter((e) => e !== keptInPlace),
  );
  return keptInPlace ? pruned : addPluginToConfigText(pruned, kept?.spec ?? specifier, key);
}

/** The line naming the host install found and the key it writes; `movedFrom` is the other
 * key when caret had an entry there. */
function hostLine(
  version: VersionTriple | null,
  key: PluginKey,
  movedFrom: PluginKey | null,
): string {
  const found =
    version === null
      ? `couldn't read \`opencode --version\` — writing caret to ${key}, which every OpenCode loads`
      : `OpenCode ${version.join(".")} — writing caret to ${key}`;
  return movedFrom === null ? found : `${found} (moved from ${movedFrom})`;
}

/** Install (or, with `uninstall`, remove) caret into OpenCode: write caret's entry to
 * the key the host loads, or remove it from both, deploy/remove the `/caret:*` command
 * files, and sweep whatever the file-deploy era left in the config dir.
 * OpenCode installs the package (and the plugin's deps) itself on its next start, so
 * there is no manifest to write and no `bun install` to run here. */
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
  // OpenCode symlinks a `file:` target into its cache, so the plugin it loads is the
  // checkout's own — and the `../bin/caret` that plugin spawns is the binary
  // `mise run build` just produced, picked up on every later rebuild with no reinstall.
  const specifier = opts.local ? localPluginSpecifier(opts.local.repoDir) : CARET_PACKAGE;
  // Uninstall never probes: it clears caret from both keys.
  const version = opts.uninstall ? null : (deps.opencodeVersion ?? readOpencodeVersion)();
  const key = pluginKeyFor(version);
  const entries = opts.uninstall ? [] : caretEntries(readConfigText(configFile), isCheckout);
  const otherKey: PluginKey = key === "plugin" ? "plugins" : "plugin";
  const movedFrom = entries.some((e) => e.key === otherKey) ? otherKey : null;
  const writtenSpec = keptEntry(entries, specifier)?.spec ?? specifier;

  if (opts.dryRun) {
    const verb = opts.uninstall ? "remove" : "write";
    // The check is read-only, so a preview can still run it and say what it found. A
    // preview has no warning to carry an `unknown`'s reason, so the note carries it.
    const found = checks(opts)
      ? ["", previewLine(await readVerdict({ configFile, host: version }, deps))]
      : [];
    // The specifier is the one thing a preview can't be read off the paths: `--from-local`
    // and a published install write the same file with very different content.
    const entry = opts.uninstall
      ? []
      : ["", `plugin entry: ${specifier} → ${key}`, hostLine(version, key, movedFrom)];
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
      "Removing caret from OpenCode's plugin and plugins keys",
      async () =>
        editConfig(configFile, (text) =>
          text === null ? null : dropEntries(text, caretEntries(text, isCheckout)),
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

  ui.info(hostLine(version, key, movedFrom));
  await ui.step(
    `Adding ${specifier} to OpenCode's ${key} array`,
    async () =>
      editConfig(configFile, (text) => setCaretPluginEntry(text, { specifier, key, isCheckout })),
    (changed) =>
      changed.length > 0
        ? `Added ${writtenSpec} to ${basename(configFile)}`
        : `${writtenSpec} was already in ${basename(configFile)}`,
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
    // it as `/caret:demo`. Its markers are filled from the caret running this install.
    path: join(commandDir(dir), namespacedCommandFilename(c.name)),
    contents: renderPlugin(c.contents, {
      version: VERSION,
      binPath: pkg.binPath,
      demoTemplate: pkg.demoTemplate,
    }),
  }));
  await ui.step(
    "Deploying the /caret:* command files",
    async () => deployFiles(files, { dryRun: false }),
    (deployed) => `Deployed ${deployed.paths.length} command file(s) to ${dir}`,
  );
}

/** Remove the file-deploy era's leftovers, on both arms. Unlike every other step here it
 * is raised only when there is something to remove: a zero outcome is information for the
 * others, while an empty sweep would print into every install transcript forever. */
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

/** This run's upgrade check: the adapter's read, with the test seams threaded in. */
async function readVerdict(
  at: { configFile: string; host?: VersionTriple | null },
  deps: InstallOpencodeDeps,
): Promise<UpgradeVerdict> {
  return readUpgradeVerdict({ ...at, cacheDir: deps.cacheDir, published: deps.published });
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
    // After the write caret sits in the key its host loads, so the key alone picks the
    // cache layout.
    () => readVerdict({ configFile }, deps),
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
      editConfig(configFile, (text) => {
        const entry = caretPackageEntry(text);
        return text === null || entry === null
          ? null
          : setPluginVersionInConfigText(text, {
              pkg: CARET_PACKAGE,
              version: verdict.published,
              key: entry.key,
            });
      }),
    (changed) =>
      changed.length > 0
        ? `Bumped the pin to ${CARET_PACKAGE}@${verdict.published}`
        : `Left ${basename(configFile)} unchanged`,
  );
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

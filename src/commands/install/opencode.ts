// caret's OpenCode install target. `caret install` makes caret an entry in the host's
// plugin key (`plugins` on v2, else `plugin`) — OpenCode installs it and its deps into its
// own cache and loads it — and
// deploys the `/caret:*` command files (which aren't array-installable). `--uninstall`
// reverses both. Either arm also sweeps the plugin and command FILES an older caret
// deployed into the config dir: OpenCode still loads them, so a leftover plugin file
// would register a second review tool beside the array entry. The config-array edit is
// comment-preserving (config-plugin.ts).
//
// caret owns exactly one entry across both keys and every global config file, in one of
// two forms: the npm package (@macintacos/caret), or `file:<checkout>` under
// `--from-local`. A published install also checks whether the caret OpenCode would load is
// behind the published one, because OpenCode resolves an array entry once and caches it
// forever — re-adding the entry, all a re-run would otherwise do, never moves anyone off
// the version they installed on.

import { writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import {
  addPluginToConfigText,
  configParseError,
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
  readCaretEntries,
  readConfigText,
} from "@/adapters/opencode/entries.ts";
import {
  hostConfigFilenames,
  loadedConfigFiles,
  pluginKeyFor,
  readOpencodeVersion,
} from "@/adapters/opencode/host.ts";
import { loadOpencodePackaging, type OpencodePackaging } from "@/adapters/opencode/packaging.ts";
import {
  CARET_PACKAGE,
  commandDir,
  existingConfigFiles,
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
import { errorMessage } from "@/lib/types.ts";

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
 * the order given — so the user's pin survives a move — else the first; undefined when
 * there is none and `specifier` is added. */
function keptEntry(entries: readonly CaretEntry[], specifier: string): CaretEntry | undefined {
  const sameForm = entries.filter((e) => sameEntryForm(e.spec, specifier));
  return sameForm.find((e) => splitPluginSpecifier(e.spec).version !== null) ?? sameForm[0];
}

/** Rewrite both plugin keys so caret has exactly one entry, `spec` in `key`. Two caret
 * entries would load two plugins, each registering the review tool (v2 rejects them
 * outright as a duplicate id). An entry already matching stays in place, as written. */
function setCaretPluginEntry(
  text: string | null,
  target: { spec: string; key: PluginKey; isCheckout: (dir: string) => boolean },
): string {
  const { spec, key, isCheckout } = target;
  if (text === null) return addPluginToConfigText(null, spec, key);
  const entries = caretEntries(text, isCheckout);
  const inPlace = entries.find((e) => e.key === key && e.spec === spec);
  const pruned = dropEntries(
    text,
    entries.filter((e) => e !== inPlace),
  );
  return inPlace ? pruned : addPluginToConfigText(pruned, spec, key);
}

/** The transform that clears every caret entry from a config, in every form caret may have
 * written: a developer who ran `--from-local` has a checkout entry, and leaving it would keep
 * OpenCode loading caret. */
function stripCaret(isCheckout: (dir: string) => boolean): ConfigEdit["transform"] {
  return (text) => (text === null ? null : dropEntries(text, caretEntries(text, isCheckout)));
}

/** The transform that bumps caret's package pin to `version`, in whichever key holds it. */
function bumpPin(version: string): ConfigEdit["transform"] {
  return (text) => {
    const entry = caretPackageEntry(text);
    return text === null || entry === null
      ? null
      : setPluginVersionInConfigText(text, { pkg: CARET_PACKAGE, version, key: entry.key });
  };
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

/** What the entry point resolves before dispatching to an arm. */
interface OpencodeSetup {
  dir: string;
  pkg: OpencodePackaging;
  ui: InstallUI;
  isCheckout: (dir: string) => boolean;
  configFiles: string[];
  /** What an older, file-deploying caret left in `dir`. */
  legacy: string[];
}

/** Where an install puts caret on this host. */
interface Placement {
  /** The form this run installs: the package name, or `file:<checkout>`. */
  specifier: string;
  version: VersionTriple | null;
  key: PluginKey;
  movedFrom: PluginKey | null;
  /** What the config holds afterwards: a kept entry's spec, so a user's pin survives,
   * else `specifier`. */
  writtenSpec: string;
  /** The config file caret is written into. */
  target: string;
  /** The existing config files this host loads. */
  loadedFiles: string[];
}

interface ConfigEdit {
  path: string;
  /** The file's next text from its current one (null when absent); null for no change. */
  transform: (text: string | null) => string | null;
}

interface PlannedWrite {
  path: string;
  text: string;
}

interface ConfigPlan {
  planned: PlannedWrite[];
  /** Each existing file that can't be read or fails to parse; never planned. */
  uneditable: { path: string; reason: string }[];
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
  const setup: OpencodeSetup = {
    dir,
    pkg: deps.packaging ?? loadOpencodePackaging(),
    ui: deps.ui ?? silentUI,
    isCheckout: deps.isCheckout ?? isCaretCheckout,
    configFiles: existingConfigFiles(dir),
    legacy: existingLegacyInstallFiles(dir),
  };
  if (opts.uninstall) return opts.dryRun ? previewUninstall(setup) : uninstallOpencode(setup);
  return opts.dryRun ? previewInstall(setup, opts, deps) : installOpencode(setup, opts, deps);
}

/** Probes `opencode --version`, reads every global config and picks the target file, so
 * only the install arms call it; uninstall clears every file and needs neither. */
function readPlacement(
  setup: Pick<OpencodeSetup, "dir" | "configFiles" | "isCheckout">,
  local: LocalInstall | undefined,
  probe: () => VersionTriple | null,
): Placement {
  // OpenCode symlinks a `file:` target into its cache, so the plugin it loads is the
  // checkout's own — and the `../bin/caret` that plugin spawns is the binary
  // `mise run build` just produced, picked up on every later rebuild with no reinstall.
  const specifier = local ? localPluginSpecifier(local.repoDir) : CARET_PACKAGE;
  const version = probe();
  const key = pluginKeyFor(version);
  const all = readCaretEntries(setup.configFiles, setup.isCheckout);
  // A pin in a file the host ignores is not what the user runs, so it never beats one the
  // host loads.
  const loadedFiles = loadedConfigFiles(setup.configFiles, version);
  const loaded = readCaretEntries(loadedFiles, setup.isCheckout);
  const otherKey: PluginKey = key === "plugin" ? "plugins" : "plugin";
  const movedFrom = all.some((e) => e.key === otherKey) ? otherKey : null;
  const writtenSpec =
    (keptEntry(loaded, specifier) ?? keptEntry(all, specifier))?.spec ?? specifier;
  const target = resolveConfigFile(setup.dir, hostConfigFilenames(version));
  return { specifier, version, key, movedFrom, writtenSpec, target, loadedFiles };
}

/** Install's config edits: caret stripped from every other file, then written into the
 * target last, so a failure between them leaves no caret entry rather than two. */
function installEdits(
  { configFiles, isCheckout }: Pick<OpencodeSetup, "configFiles" | "isCheckout">,
  { target, writtenSpec, key }: Placement,
): ConfigEdit[] {
  return [
    ...configFiles
      .filter((path) => path !== target)
      .map((path) => ({ path, transform: stripCaret(isCheckout) })),
    {
      path: target,
      transform: (text) => setCaretPluginEntry(text, { spec: writtenSpec, key, isCheckout }),
    },
  ];
}

function uninstallEdits({
  configFiles,
  isCheckout,
}: Pick<OpencodeSetup, "configFiles" | "isCheckout">): ConfigEdit[] {
  return configFiles.map((path) => ({ path, transform: stripCaret(isCheckout) }));
}

/** The note for config files the host ignores, raised only when this run moves caret out
 * of one or creates the target — so it says so once, not on every later install. */
function ignoredConfigNote(
  { configFiles }: Pick<OpencodeSetup, "configFiles">,
  { version, target, loadedFiles }: Pick<Placement, "version" | "target" | "loadedFiles">,
  changed: readonly string[],
): string | null {
  const ignored = configFiles.filter((p) => !loadedFiles.includes(p));
  if (ignored.length === 0) return null;
  if (!ignored.some((p) => changed.includes(p)) && configFiles.includes(target)) return null;
  const host = version === null ? "OpenCode" : `OpenCode v${version[0]}`;
  const names = ignored.map((p) => basename(p)).join(", ");
  return `${host} ignores ${names} — caret goes in ${basename(target)}`;
}

/** The `/caret:*` command files caret deploys into the config dir. */
function commandPaths({ dir, pkg }: Pick<OpencodeSetup, "dir" | "pkg">): string[] {
  return pkg.commands.map((c) => join(commandDir(dir), namespacedCommandFilename(c.name)));
}

/** The dry run's note: the paths an arm touches, `entry` above the legacy sweep, `found`
 * below. */
function previewNote(
  setup: OpencodeSetup,
  verb: "write" | "remove",
  parts: { configs: string[]; entry: string[]; found: string[] },
): void {
  const { legacy, ui } = setup;
  // Their own labelled section: an install's bare path list is titled "would write", and
  // listing a file caret is about to DELETE under that heading would misread badly.
  const sweep = legacy.length === 0 ? [] : ["", "pre-array-install files to remove:", ...legacy];
  ui.note(
    [...parts.configs, ...commandPaths(setup), ...parts.entry, ...sweep, ...parts.found].join("\n"),
    `OpenCode — would ${verb}`,
  );
}

/** The install dry run: what it would write, plus the upgrade verdict. Writes nothing. */
async function previewInstall(
  setup: OpencodeSetup,
  opts: { local?: LocalInstall },
  deps: InstallOpencodeDeps,
): Promise<void> {
  const placed = readPlacement(setup, opts.local, deps.opencodeVersion ?? readOpencodeVersion);
  // The check is read-only, so a preview can still run it and say what it found. A
  // preview has no warning to carry an `unknown`'s reason, so the note carries it.
  const found = checksPublished(opts.local)
    ? [
        "",
        previewLine(
          await readVerdict({ configFiles: setup.configFiles, host: placed.version }, deps),
        ),
      ]
    : [];
  // The specifier is the one thing a preview can't be read off the paths: `--from-local`
  // and a published install write the same file with very different content.
  const entry = [
    "",
    `plugin entry: ${placed.specifier} → ${placed.key}`,
    hostLine(placed.version, placed.key, placed.movedFrom),
  ];
  const changed = strictPlan(installEdits(setup, placed)).map((e) => e.path);
  const note = ignoredConfigNote(setup, placed, changed);
  if (note !== null) entry.push(note);
  const configs = [placed.target, ...changed.filter((p) => p !== placed.target)];
  previewNote(setup, "write", { configs, entry, found });
}

/** The uninstall dry run: what it would remove. */
function previewUninstall(setup: OpencodeSetup): void {
  const configs = lenientPlan(uninstallEdits(setup), setup.ui).planned.map((e) => e.path);
  previewNote(setup, "remove", { configs, entry: [], found: [] });
}

async function uninstallOpencode(setup: OpencodeSetup): Promise<void> {
  const { ui, dir, legacy } = setup;
  // Planned outside the step: its warnings drawn under a running spinner corrupt the render.
  const { planned, uneditable } = lenientPlan(uninstallEdits(setup), ui);
  await ui.step(
    "Removing caret from OpenCode's plugin and plugins keys",
    async () => writeConfigEdits(planned),
    (changed) => {
      if (changed.length > 0)
        return `Removed caret from ${changed.map((p) => basename(p)).join(", ")}`;
      return uneditable.length > 0
        ? "caret was not in any readable OpenCode config"
        : "caret was not in any OpenCode config";
    },
  );
  await ui.step(
    "Removing the /caret:* command files",
    async () => removeFiles(commandPaths(setup), { dryRun: false }),
    (removed) => `Removed ${removed.paths.length} command file(s) from ${dir}`,
  );
  await sweepLegacy(legacy, dir, ui);
}

async function installOpencode(
  setup: OpencodeSetup,
  opts: { refresh: boolean; local?: LocalInstall },
  deps: InstallOpencodeDeps,
): Promise<void> {
  const { dir, pkg, ui, legacy } = setup;
  const placed = readPlacement(setup, opts.local, deps.opencodeVersion ?? readOpencodeVersion);
  const { specifier, version, key, movedFrom, writtenSpec, target } = placed;
  ui.info(hostLine(version, key, movedFrom));
  const changed = await ui.step(
    `Adding ${specifier} to OpenCode's ${key} array`,
    async () => writeConfigEdits(strictPlan(installEdits(setup, placed))),
    (written) => installedLine(writtenSpec, target, written),
  );
  const note = ignoredConfigNote(setup, placed, changed);
  if (note !== null) ui.info(note);
  // After the array edit — the entry has to exist before it can be read — and before the
  // command files, so a cache clear is settled by the time the run reports it deployed.
  if (checksPublished(opts.local)) await upgradeStep(target, opts, deps, ui);
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

/** Whether this run asks npm which caret is published. `--from-local` writes a checkout
 * entry, which OpenCode resolves to that checkout every start — it can never be stale, so
 * npm's version says nothing about it and a network read mid-build would only cost a
 * stall. The Claude target skips its own update phase in local mode for the same
 * reason. */
function checksPublished(local: LocalInstall | undefined): boolean {
  return local === undefined;
}

/** The verdict as a dry run states it: the settled line, plus an `unknown`'s reason —
 * which the live path reports as a warning the preview has no room for. */
function previewLine(verdict: UpgradeVerdict): string {
  const line = upgradeVerdictLine(verdict);
  return verdict.kind === "unknown" ? `${line} (${verdict.reason})` : line;
}

/** This run's upgrade check: the adapter's read, with the test seams threaded in. */
async function readVerdict(
  at: { configFiles: readonly string[]; host?: VersionTriple | null },
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
  target: string,
  opts: { refresh: boolean },
  deps: InstallOpencodeDeps,
  ui: InstallUI,
): Promise<void> {
  const verdict = await ui.step(
    "Checking OpenCode's caret version",
    // After the write caret sits in the key its host loads, so the key alone picks the
    // cache layout.
    () => readVerdict({ configFiles: [target] }, deps),
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
      writeConfigEdits(strictPlan([{ path: target, transform: bumpPin(verdict.published) }])),
    (changed) =>
      changed.length > 0
        ? `Bumped the pin to ${CARET_PACKAGE}@${verdict.published}`
        : `Left ${basename(target)} unchanged`,
  );
}

/** The install step's settled line: whether the target changed, plus every other file
 * caret was stripped from. */
function installedLine(spec: string, target: string, written: readonly string[]): string {
  const name = basename(target);
  const line = written.includes(target)
    ? `Added ${spec} to ${name}`
    : `${spec} was already in ${name}`;
  const stripped = written.filter((p) => p !== target).map((p) => basename(p));
  return stripped.length === 0 ? line : `${line} (removed it from ${stripped.join(", ")})`;
}

/** The edits whose text changes, with that text, plus the files caret can't edit. Writes
 * nothing, so a dry run lists exactly the files a live run would write. */
function planConfigEdits(edits: readonly ConfigEdit[]): ConfigPlan {
  const plan: ConfigPlan = { planned: [], uneditable: [] };
  for (const { path, transform } of edits) {
    let existing: string | null;
    try {
      existing = readConfigText(path);
    } catch (e) {
      plan.uneditable.push({ path, reason: errorMessage(e) });
      continue;
    }
    const error = existing === null ? null : configParseError(existing);
    if (error !== null) {
      plan.uneditable.push({ path, reason: error });
      continue;
    }
    const text = transform(existing);
    if (text !== null && text !== existing) plan.planned.push({ path, text });
  }
  return plan;
}

/** The planned writes, refusing the whole plan when any file can't be edited: caret cannot
 * promise one entry across files it cannot read. */
function strictPlan(edits: readonly ConfigEdit[]): PlannedWrite[] {
  const { planned, uneditable } = planConfigEdits(edits);
  if (uneditable.length > 0) {
    const files = uneditable.map(({ path, reason }) => `${path} (${reason})`).join(", ");
    throw new Error(`can't edit ${files} — caret changed nothing`);
  }
  return planned;
}

/** The plan, warning past each file that can't be edited: clearing the readable files
 * still gets closer to zero entries. */
function lenientPlan(edits: readonly ConfigEdit[], ui: InstallUI): ConfigPlan {
  const plan = planConfigEdits(edits);
  for (const { path, reason } of plan.uneditable) {
    ui.warn(`${path} can't be edited (${reason}) — caret leaves it alone`);
  }
  return plan;
}

/** Write each planned file in order, returning the paths written. A failure after the
 * first write names the files already changed. */
function writeConfigEdits(planned: readonly PlannedWrite[]): string[] {
  const written: string[] = [];
  for (const { path, text } of planned) {
    try {
      writeFileSync(path, text);
    } catch (e) {
      if (written.length === 0) throw e;
      throw new Error(`${errorMessage(e)} — already changed: ${written.join(", ")}`, { cause: e });
    }
    written.push(path);
  }
  return written;
}

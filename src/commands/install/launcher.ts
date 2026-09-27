// The writer behind the stable launcher path. A launchd plist or systemd unit must name
// one absolute executable that never moves, so caret owns a copy of bin/caret-launcher at
// $XDG_STATE_HOME/caret/bin/caret and leaves the version resolution to it, at exec time
// (EXC-1160). The install's service step is the caller: the launcher lands before the unit
// that names it, and goes with it on `--uninstall`.

import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { z } from "zod";

import { resolveCaretRoot } from "@/adapters/opencode/packaging.ts";
import {
  ensureStateDir,
  launcherBunFile,
  launcherPath,
  launcherPinnedRootFile,
  launcherRecordDir,
  launcherServiceFile,
  ownedRootsDir,
} from "@/config/paths.ts";
import { isRunnableRoot } from "@/daemon/lifecycle.ts";
import { buildKind, VERSION } from "@/lib/build-id.ts";
import { readJsonFileSync } from "@/lib/json-file.ts";
import { isNewer } from "@/lib/semver.ts";

/** What to record, plus the injection seams for tests: the `bun` to record and the
 * shipped script to copy, so the whole function runs against a temp state dir without a
 * resolvable caret root. `source` is a thunk because resolveCaretRoot() throws, which a
 * default argument would raise from inside this call rather than where the root actually
 * could not be found. */
export interface LauncherDeps {
  /** The unit this install registered, which the launcher stops on a terminal failure
   * and deletes on eviction. Absent when no supervisor was installed — the launcher
   * treats a missing record as "nothing here to tear down". */
  serviceLabel?: string;
  /** The checkout the launcher should exec over the highest installed caret. Absent for a
   * published install, which removes any pin an earlier `--from-local` left. */
  pinnedRoot?: string;
  bunPath?: string;
  source?: () => string;
  /** The published caret this install runs as, to keep a copy of under ownedRootsDir():
   * bunx runs it from a temp install that is gone once this process exits. Undefined for
   * anything but an npm bundle — a dev run, a checkout's dist, a compiled binary. */
  ownedRoot?: () => OwnedRoot | undefined;
}

const PackageFiles = z.object({ files: z.array(z.string()).default([]) });

interface OwnedRoot {
  root: string;
  version: string;
}

/** Whether `root` is a caret checkout: the npm package ships no `src/`. */
export function isSourceCheckout(root: string): boolean {
  return existsSync(join(root, "src", "cli.ts"));
}

function publishedRoot(): OwnedRoot | undefined {
  if (buildKind() !== "bundle") return undefined;
  const root = resolveCaretRoot();
  return isSourceCheckout(root) ? undefined : { root, version: VERSION };
}

/** Copy what npm publishes of `from.root` to ownedRootsDir()/<version>, unless a runnable
 * copy is already there. */
export function stageOwnedRoot(from: OwnedRoot): void {
  if (!isRunnableRoot(from.root)) return;
  const dest = join(ownedRootsDir(), from.version);
  if (isRunnableRoot(dest)) return;
  ensureStateDir(ownedRootsDir());
  const { files } = PackageFiles.parse(readJsonFileSync(join(from.root, "package.json")));
  // Dot-prefixed so the launcher's glob never offers a half-copied root.
  const tmp = join(ownedRootsDir(), `.${from.version}.${process.pid}.tmp`);
  for (const entry of [...files, "package.json"]) {
    const src = join(from.root, entry);
    if (!existsSync(src)) continue;
    const target = join(tmp, entry);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(src, target, { recursive: true });
  }
  rmSync(dest, { recursive: true, force: true });
  renameSync(tmp, dest);
}

/** Remove every owned root but the highest runnable one. Call it only right after the
 * service cycles: a bundle daemon reads `ui/dist` per request, so pruning under a live one
 * can delete the root it serves from. Best-effort — a leftover costs only disk. */
export function pruneOwnedRoots(): void {
  try {
    const entries = readdirSync(ownedRootsDir());
    const keep = entries
      .filter((e) => !e.startsWith(".") && isRunnableRoot(join(ownedRootsDir(), e)))
      .reduce<string | undefined>(
        (best, e) => (best === undefined || isNewer(e, best) ? e : best),
        undefined,
      );
    for (const e of entries) {
      if (e !== keep) rmSync(join(ownedRootsDir(), e), { recursive: true, force: true });
    }
  } catch {}
}

/** Install the shipped launcher to the path a service unit names, and record what it reads:
 * the `bun` to prefer, the unit, and the pinned root — removing a pin when none is given,
 * and reporting whether it did. */
export function installLauncher(deps: LauncherDeps = {}): { unpinned: boolean } {
  const source = (deps.source ?? (() => join(resolveCaretRoot(), "bin", "caret-launcher")))();
  if (deps.pinnedRoot === undefined) {
    const owned = (deps.ownedRoot ?? publishedRoot)();
    if (owned) stageOwnedRoot(owned);
  }

  ensureStateDir(dirname(launcherPath()));
  // Land atomically: a service unit names launcherPath() forever, and bash reads a script
  // lazily from its open fd — so an in-place rewrite can feed a running launcher the tail
  // of a different file, and a hard kill mid-copy leaves a truncated executable there.
  const tmp = `${launcherPath()}.${process.pid}.tmp`;
  copyFileSync(source, tmp);
  chmodSync(tmp, 0o755);
  renameSync(tmp, launcherPath());

  // Under a compiled binary execPath is caret itself, not bun, so there is nothing worth
  // recording and the launcher is left to its own search.
  const bunPath = deps.bunPath ?? (buildKind() === "binary" ? undefined : process.execPath);
  const unpinned = deps.pinnedRoot === undefined && existsSync(launcherPinnedRootFile());
  if (unpinned) rmSync(launcherPinnedRootFile(), { force: true });
  if (bunPath === undefined && deps.serviceLabel === undefined && deps.pinnedRoot === undefined) {
    return { unpinned };
  }

  ensureStateDir(launcherRecordDir());
  if (bunPath !== undefined) writeRecord(launcherBunFile(), bunPath);
  if (deps.serviceLabel !== undefined) writeRecord(launcherServiceFile(), deps.serviceLabel);
  if (deps.pinnedRoot !== undefined) writeRecord(launcherPinnedRootFile(), deps.pinnedRoot);
  return { unpinned };
}

/** The launcher's `read -r` reports EOF on a file with no trailing newline, and that read
 * is what decides the record exists at all. */
function writeRecord(path: string, value: string): void {
  writeFileSync(path, `${value}\n`, { mode: 0o600 });
}

/** Remove the launcher and everything it reads, the half of `--uninstall` that takes the
 * launcher out with the plugin. Mirrors evict() in bin/caret-launcher, which deletes the
 * same three directories — the launcher, its records and the owned roots — and leaves
 * review state for a reinstall. */
export function uninstallLauncher(): void {
  rmSync(dirname(launcherPath()), { recursive: true, force: true });
  rmSync(launcherRecordDir(), { recursive: true, force: true });
  rmSync(ownedRootsDir(), { recursive: true, force: true });
}

// Whether the caret that OpenCode runs is behind the published one, and the effects
// needed to answer that. OpenCode installs a plugin entry into its cache on first
// install (v1's `packages/<specifier>/`, v2's `npm/<name>@<spec>/<generation>/`) and
// never re-resolves it, so a
// bare entry stays frozen at install-day's version — `caret install` is a no-op on the
// array entry and therefore on the running version. This module is what lets install
// say so: a pure verdict over (entry, cached, published), plus the cache reads and the
// cache clear the install target performs on it. Describing that verdict lives here too
// — install's settled line and doctor's check are the same description of one adapter
// fact, so neither surface can word a version gap the other would word differently. The
// published version itself, and the semver comparison the verdict turns on, are shared
// with the daemon's own update check and live in `@/lib/upstream.ts` and
// `@/lib/semver.ts`.
//
// The two staleness kinds are unfrozen differently. A bare (or unparseable) specifier is
// unfrozen by deleting its cache dir, so OpenCode re-resolves on next start. A pin
// resolves exactly, so only rewriting the pin changes anything — and the new specifier
// string gets its own cache dir, no deletion involved. The cache reads degrade to null;
// the config read throws when the file exists but cannot be read, and each caller owns
// that.

import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

import { splitPluginSpecifier } from "@/adapters/opencode/config-plugin.ts";
import { type CaretEntry, readCaretEntry } from "@/adapters/opencode/entries.ts";
import {
  CARET_PACKAGE,
  existingOpencodeCachePackageDirs,
  isLocalPluginSpecifier,
  liveGenerationDir,
  opencodeCachePackageDir,
  opencodeNpmCacheDir,
  opencodeNpmLocalCacheDir,
} from "@/adapters/opencode/paths.ts";
import type { Check } from "@/doctor/report.ts";
import { readJsonFileSync } from "@/lib/json-file.ts";
import { isNewer, parseVersionTriple } from "@/lib/semver.ts";
import { publishedCaretVersion } from "@/lib/upstream.ts";

/** What install found when it compared the caret OpenCode would load against the one
 * npm publishes. `fresh` and `current` need no action; the two `stale-*` kinds each
 * name their own remedy; `unknown` means one side could not be read, so nothing is
 * changed and the reason is reported. */
export type UpgradeVerdict =
  | { kind: "fresh" }
  | { kind: "current"; version: string }
  | { kind: "stale-cache"; cached: string; published: string }
  | { kind: "stale-pin"; entry: string; pinned: string; published: string }
  | { kind: "unknown"; reason: string };

/** The two verdicts with a remedy to offer — the only ones anyone is asked about. Spelled
 * out rather than matched on a `stale-*` prefix, so a third stale kind is a compile error
 * at the copy that would have to describe its remedy. */
export type StaleVerdict = Extract<UpgradeVerdict, { kind: "stale-cache" | "stale-pin" }>;

/** Decide whether the caret OpenCode would load is behind `published`.
 *
 * A pinned entry is judged against its PIN and a bare one against the CACHE, because
 * that is what each actually resolves to: a pin resolves exactly (so a lagging cache
 * says nothing), while a bare specifier is whatever was cached on install day. An
 * unparseable pin (`@latest`, a `bun link` path) is frozen exactly the way a bare
 * specifier is, so it takes the cache branch and is unfrozen the same way. */
export function upgradeVerdict(input: {
  /** The verbatim `plugin` array entry naming caret, or null when there is none. */
  entry: string | null;
  /** What OpenCode cached for that entry — its installed version, else the spec its shim
   * requested (a range reads as unknown) — or null when nothing is cached. */
  cached: string | null;
  /** npm's `latest`, or null when it could not be read. */
  published: string | null;
}): UpgradeVerdict {
  const { entry, cached, published } = input;
  if (published === null) {
    return { kind: "unknown", reason: "could not reach npm for the published caret version" };
  }
  if (parseVersionTriple(published) === null) {
    return { kind: "unknown", reason: `npm reported an unreadable version (${published})` };
  }
  if (entry === null) return { kind: "fresh" };

  const pinned = splitPluginSpecifier(entry).version;
  if (pinned !== null && parseVersionTriple(pinned) !== null) {
    return isNewer(published, pinned)
      ? { kind: "stale-pin", entry, pinned, published }
      : { kind: "current", version: pinned };
  }

  if (cached === null) return { kind: "fresh" };
  if (parseVersionTriple(cached) === null) {
    return { kind: "unknown", reason: `OpenCode cached an unreadable version (${cached})` };
  }
  return isNewer(published, cached)
    ? { kind: "stale-cache", cached, published }
    : { kind: "current", version: cached };
}

/** One line naming what an upgrade check found: which caret OpenCode would load, and,
 * when it is behind, which one npm publishes. `unknown` deliberately names no version —
 * the check could not be made, so any number in the line would be a claim caret cannot
 * support (the reason is reported separately, as a warning). */
export function upgradeVerdictLine(verdict: UpgradeVerdict): string {
  switch (verdict.kind) {
    case "fresh":
      return "OpenCode will resolve caret on its next start";
    case "current":
      return `OpenCode's caret is ${verdict.version} — already current`;
    case "stale-cache":
      return `OpenCode's cached caret is ${verdict.cached}; ${verdict.published} is published`;
    case "stale-pin":
      return `Your config pins ${verdict.entry}; ${verdict.published} is published`;
    case "unknown":
      return "Could not check which caret OpenCode would load";
  }
}

/** The verdict as one of doctor's checks. The detail is the line `caret install` prints,
 * so the two surfaces can never describe a version gap differently; only the remedies
 * differ, because a bare entry is unfrozen by clearing its cache and a pin only by
 * rewriting it. An `unknown` stays `unknown` rather than becoming a failure — a doctor
 * run offline is the normal case, not a broken install. Every kind is spelled out, so a
 * sixth one is a compile error here rather than a silent pass. */
export function upgradeCheck(verdict: UpgradeVerdict): Check {
  const base = {
    id: "opencode-caret-version",
    title: "OpenCode's caret",
    detail: upgradeVerdictLine(verdict),
  };
  switch (verdict.kind) {
    case "unknown":
      return { ...base, status: "unknown", reason: verdict.reason };
    case "stale-cache":
      return {
        ...base,
        status: "fail",
        remedy: "run `caret install --refresh` to clear the cached copy",
      };
    case "stale-pin":
      return { ...base, status: "fail", remedy: "run `caret install --refresh` to bump the pin" };
    case "fresh":
    case "current":
      return { ...base, status: "pass" };
  }
}

/** Compare the caret OpenCode would load against npm's published one. Read-only: the
 * config entry, the cache, and the registry are all just read, so a dry run may call it
 * too. The cache and registry reads degrade to null, and the verdict decides what that
 * means; the config read throws when the file exists but cannot be read. The one call
 * site for both `caret install` and `caret doctor`, so neither can describe a version
 * gap the other would describe differently. */
export async function readUpgradeVerdict(deps: {
  configFile: string;
  /** The OpenCode major version, when known; a `plugin` entry on 2+ is in v2's cache. */
  hostMajor?: number;
  cacheDir?: (entry: CaretEntry) => string | null;
  published?: () => Promise<string | null>;
}): Promise<UpgradeVerdict> {
  const entry = readCaretEntry(deps.configFile);
  const cacheDir = deps.cacheDir ?? ((e: CaretEntry) => caretCacheDir(e, deps.hostMajor));
  return upgradeVerdict({
    entry: entry?.spec ?? null,
    cached: readEntryCachedVersion(entry, cacheDir),
    published: await (deps.published ?? publishedCaretVersion)(),
  });
}

/** Whether OpenCode's config carries caret's npm-package entry, in either key, at all — the
 * question doctor asks before paying for the version check, since `upgradeVerdict`
 * reports a missing entry as `fresh`. */
export function hasCaretPluginEntry(configFile: string): boolean {
  return readCaretEntry(configFile) !== null;
}

/** The cache dir OpenCode installed `entry` into, or null when v2 has no generation
 * for it yet. A `plugins` entry is always in v2's layout, since v1 never installs it; a
 * `plugin` entry is in v2's layout only when the caller knows the host is v2
 * (`hostMajor`), else in v1's. */
export function caretCacheDir(entry: CaretEntry, hostMajor?: number): string | null {
  if (entry.key === "plugin" && (hostMajor ?? 0) < 2) return opencodeCachePackageDir(entry.spec);
  if (isLocalPluginSpecifier(entry.spec)) {
    return liveGenerationDir(opencodeNpmLocalCacheDir(entry.spec));
  }
  const { pkg, version } = splitPluginSpecifier(entry.spec);
  return liveGenerationDir(opencodeNpmCacheDir(pkg, version));
}

/** What OpenCode cached for `entry`, read from that entry's own cache dir and never a
 * sibling's; null when there is no entry or no dir. */
export function readEntryCachedVersion(
  entry: CaretEntry | null,
  cacheDir: (entry: CaretEntry) => string | null = caretCacheDir,
): string | null {
  const dir = entry === null ? null : cacheDir(entry);
  return dir === null ? null : readCachedCaretVersion(dir);
}

/** caret's version in one OpenCode cache dir (v1's `packages/<specifier>/` or a v2
 * generation dir): the `version`
 * of the installed `node_modules/@macintacos/caret/package.json`, else the shim
 * manifest's requested spec under `dependencies` verbatim — possibly a range, which
 * callers treat as unknown — else null when neither manifest names caret. The shim's
 * spec still names the installed caret because OpenCode 1.18.x saves with an empty
 * prefix, so it is the exact version it resolved. */
export function readCachedCaretVersion(dir: string): string | null {
  const installed = readJsonFileSync(join(dir, "node_modules", CARET_PACKAGE, "package.json")) as {
    version?: unknown;
  } | null;
  if (typeof installed?.version === "string" && installed.version.length > 0) {
    return installed.version;
  }
  const shim = readJsonFileSync(join(dir, "package.json")) as {
    dependencies?: Record<string, unknown>;
  } | null;
  const requested = shim?.dependencies?.[CARET_PACKAGE];
  return typeof requested === "string" && requested.length > 0 ? requested : null;
}

/** Delete every cache dir OpenCode holds for caret so it re-resolves the specifier on its
 * next start, returning the ones that existed. Reports only what it actually removed —
 * the discipline `removeFiles` follows — so a settled line can never claim a delete that
 * did not happen. */
export function clearCachedCaret(
  dirs: readonly string[] = existingOpencodeCachePackageDirs(),
): string[] {
  const cleared: string[] = [];
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    rmSync(d, { recursive: true, force: true });
    cleared.push(d);
  }
  return cleared;
}

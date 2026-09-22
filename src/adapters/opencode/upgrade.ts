// Whether the caret that OpenCode runs is behind the published one, and the effects
// needed to answer that. OpenCode records a `plugin` array entry's resolution in
// `packages/<specifier>/package.json` on first install and never re-resolves it, so a
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
// string gets its own cache dir, no deletion involved. Every read is best-effort and
// degrades to null rather than throwing, mirroring install.ts's probe discipline.

import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { findPluginEntry, splitPluginSpecifier } from "@/adapters/opencode/config-plugin.ts";
import { CARET_PACKAGE, existingOpencodeCachePackageDirs } from "@/adapters/opencode/paths.ts";
import type { Check } from "@/doctor/report.ts";
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
  /** OpenCode's resolved version for that entry, or null when nothing is cached. */
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
 * too. Each read degrades to null on its own, and the verdict decides what that means.
 * The one call site for both `caret install` and `caret doctor`, so neither can describe
 * a version gap the other would describe differently. */
export async function readUpgradeVerdict(deps: {
  configFile: string;
  cacheDirs?: () => string[];
  published?: () => Promise<string | null>;
}): Promise<UpgradeVerdict> {
  return upgradeVerdict({
    entry: findPluginEntry(readConfigText(deps.configFile), CARET_PACKAGE),
    cached: readCachedCaretVersion((deps.cacheDirs ?? existingOpencodeCachePackageDirs)()),
    published: await (deps.published ?? publishedCaretVersion)(),
  });
}

/** Whether OpenCode's config carries a caret `plugin` entry at all — the question doctor
 * asks before paying for the version check, since `upgradeVerdict` reports a missing
 * entry as `fresh`. */
export function hasCaretPluginEntry(configFile: string): boolean {
  return findPluginEntry(readConfigText(configFile), CARET_PACKAGE) !== null;
}

/** The config file's text, or null when it is absent. */
export function readConfigText(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf-8") : null;
}

/** caret's resolved version from the first cache dir whose top-level shim manifest names
 * caret under `dependencies` — one file read, no node_modules walk. OpenCode records that
 * entry with an empty save prefix, so the value is an exact version, not a range. null
 * when no candidate yields one: nothing installed yet, an interrupted install that left
 * the dir without its entry, or an unreadable manifest. */
export function readCachedCaretVersion(
  dirs: readonly string[] = existingOpencodeCachePackageDirs(),
): string | null {
  for (const d of dirs) {
    try {
      const deps = (
        JSON.parse(readFileSync(join(d, "package.json"), "utf-8")) as {
          dependencies?: Record<string, unknown>;
        }
      ).dependencies;
      const v = deps?.[CARET_PACKAGE];
      if (typeof v === "string" && v.length > 0) return v;
    } catch {
      // missing / unreadable / unparseable manifest — try the next candidate.
    }
  }
  return null;
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

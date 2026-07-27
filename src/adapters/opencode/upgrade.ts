// Whether the caret OpenCode is running is behind the published one, and the effects
// needed to answer that. OpenCode records a `plugin` array entry's resolution in
// `packages/<specifier>/package.json` on first install and never re-resolves it, so a
// bare entry stays frozen at install-day's version — `caret install --target opencode`
// is a no-op on the array entry and therefore on the running version. This module is
// what lets install say so: a pure verdict over (entry, cached, published), plus the
// reads and the cache clear the install target performs on it.
//
// The two staleness kinds are unfrozen differently. A bare (or unparseable) specifier is
// unfrozen by deleting its cache dir, so OpenCode re-resolves on next start. A pin
// resolves exactly, so only rewriting the pin changes anything — and the new specifier
// string gets its own cache dir, no deletion involved. Every read is best-effort and
// degrades to null rather than throwing, mirroring install.ts's probe discipline.

import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { splitPluginSpecifier } from "@/adapters/opencode/config-plugin.ts";
import { CARET_PACKAGE, existingOpencodeCachePackageDirs } from "@/adapters/opencode/paths.ts";

/** npm's `latest` dist-tag document for caret. Deliberately npm rather than GitHub
 * releases (which the plugin's own update nudge checks): `latest` is what OpenCode
 * re-resolves to, so it is the only honest answer to "what would you get". A release
 * that tagged GitHub but failed to publish would make the GitHub number a promise caret
 * cannot keep. */
const NPM_LATEST_URL = `https://registry.npmjs.org/${CARET_PACKAGE}/latest`;

/** The slice of `fetch` the version check needs — narrowed so a test injects a plain
 * stub without reconstructing the whole `typeof fetch` surface. `fetch` satisfies it. */
export type FetchLike = (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

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

/** Semver triple `[major, minor, patch]`, or null when `v` is not `X.Y.Z` (an optional
 * leading `v` is stripped; trailing prerelease/build metadata is ignored). */
function parseVersionTriple(v: string): [number, number, number] | null {
  const m = v
    .trim()
    .replace(/^v/, "")
    .match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** True when `latest` is a strictly higher semver than `current`; an unparseable version
 * on either side compares false, so the check never claims staleness it can't read.
 *
 * A deliberate twin of the same function in `opencode/caret.plugin.ts`: that file is
 * self-contained by contract (its only imports are node builtins and
 * `@opencode-ai/plugin`, so OpenCode can load it straight out of the package cache) and
 * therefore cannot import from `src/`. */
export function isNewer(latest: string, current: string): boolean {
  const a = parseVersionTriple(latest);
  const b = parseVersionTriple(current);
  if (!a || !b) return false;
  const [a0, a1, a2] = a;
  const [b0, b1, b2] = b;
  if (a0 !== b0) return a0 > b0;
  if (a1 !== b1) return a1 > b1;
  return a2 > b2;
}

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

/** npm's `latest` version of caret, or null when the registry can't be reached, answers
 * non-200, or returns a document without a usable `version`. Best-effort by design: a
 * failed check becomes an `unknown` verdict that changes nothing — it never fails an
 * install. */
export async function publishedCaretVersion(fetchImpl: FetchLike = fetch): Promise<string | null> {
  try {
    const res = await fetchImpl(NPM_LATEST_URL);
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: unknown } | null;
    const v = body?.version;
    return typeof v === "string" && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

// Semver parsing and comparison — the `X.Y.Z` triple and the strictly-newer test —
// shared by the daemon's update check and the OpenCode adapter (its host-version read
// and its install-time staleness verdict). Pure TS with no imports. Browser-safe: the UI
// reaches it through `@core` to build the What's new compare link, so it must stay
// node-free.

/** A version as `[major, minor, patch]`. */
export type VersionTriple = readonly [number, number, number];

/** `v` as a `VersionTriple`, or null when `v` is not `X.Y.Z` (an optional leading `v` is
 * stripped; trailing prerelease/build metadata is ignored). */
export function parseVersionTriple(v: string): VersionTriple | null {
  const m = v
    .trim()
    .replace(/^v/, "")
    .match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** True when `latest` is a strictly higher semver than `current`; an unparseable version
 * on either side compares false, so the check never claims staleness it can't read.
 *
 * A deliberate twin of the same function in `opencode/caret.core.ts`: that file is
 * self-contained by contract (its only imports are node builtins and its sibling
 * `review-bridge.ts`, so OpenCode can load it straight out of the package cache) and
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

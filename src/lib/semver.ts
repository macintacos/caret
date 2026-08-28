// Semver comparison for caret's own version numbers — the `X.Y.Z` triple parse and
// the strictly-newer test every upgrade check decides on. Pure TS with no imports,
// shared by the daemon's update check and the OpenCode adapter's install-time
// staleness verdict so both answer "is this behind?" the same way.

/** Semver triple `[major, minor, patch]`, or null when `v` is not `X.Y.Z` (an optional
 * leading `v` is stripped; trailing prerelease/build metadata is ignored). */
export function parseVersionTriple(v: string): [number, number, number] | null {
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

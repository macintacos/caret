// Version arithmetic for the release pipeline. The release script is the sole
// source of the version number — the agent never computes or alters it — so all
// semver math lives here and nowhere else.

import semver from "semver";

/** The release bump levels accepted on the command line. */
export type BumpLevel = "patch" | "minor" | "major";

const BUMP_LEVELS: readonly BumpLevel[] = ["patch", "minor", "major"];

/** Type guard for a raw CLI argument being a valid bump level. */
export function isBumpLevel(value: string): value is BumpLevel {
  return (BUMP_LEVELS as readonly string[]).includes(value);
}

/**
 * The next version for `bump` applied to `current`. Throws if `current` is not a
 * valid semver release (the in-sync manifest version is expected to be one).
 */
export function nextVersion(current: string, bump: BumpLevel): string {
  const next = semver.inc(current, bump);
  if (next === null) {
    throw new Error(`cannot bump invalid version ${JSON.stringify(current)}`);
  }
  return next;
}

/** The git tag name for a version, e.g. "0.1.0" -> "v0.1.0". */
export function tagName(version: string): string {
  return `v${version}`;
}

/** The version body of a `vX.Y.Z` tag. Throws if the tag is not `v` + semver. */
export function versionFromTag(tag: string): string {
  if (!tag.startsWith("v")) {
    throw new Error(`tag ${JSON.stringify(tag)} does not start with "v"`);
  }
  const body = tag.slice(1);
  if (semver.valid(body) === null) {
    throw new Error(`tag ${JSON.stringify(tag)} has no valid semver body`);
  }
  return body;
}

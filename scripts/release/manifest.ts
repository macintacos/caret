// Version-string surgery on the three manifests that must stay in sync
// (package.json, .claude-plugin/marketplace.json, .claude-plugin/plugin.json).
//
// Edits are targeted, anchored string replacements rather than
// JSON.parse -> JSON.stringify: only the version *value* changes, so
// indentation, key order, inline objects, and the trailing newline are
// preserved byte-for-byte and the result produces no noisy `mise run format`
// diff. Each manifest has exactly one "version" key (marketplace's is nested at
// plugins[0].version), which makes a file-wide single-match edit unambiguous.

/** A manifest path paired with its current version, for the in-sync check. */
export interface ManifestVersion {
  file: string;
  version: string;
}

const VERSION_KEY = /"version"\s*:\s*"([^"]*)"/g;

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The single "version" value in a manifest. Throws if zero or more than one
 * "version" key is present — both signal that the file is not the expected shape.
 */
export function extractVersion(contents: string): string {
  const matches = [...contents.matchAll(VERSION_KEY)];
  if (matches.length === 0) {
    throw new Error('no "version" key found');
  }
  if (matches.length > 1) {
    throw new Error(`expected exactly one "version" key, found ${matches.length}`);
  }
  const value = matches[0]?.[1];
  if (value === undefined) {
    throw new Error('could not read the "version" value');
  }
  return value;
}

/**
 * Replaces the manifest's `"version": "<oldVersion>"` with `<newVersion>`,
 * preserving all surrounding formatting. Anchored on both the key and the known
 * old value, and asserts exactly one match: zero matches means the file is not
 * at `oldVersion` (already bumped, or drifted) and more than one is ambiguous.
 */
export function editVersion(contents: string, oldVersion: string, newVersion: string): string {
  const anchor = new RegExp(`("version"\\s*:\\s*")${escapeRegExp(oldVersion)}(")`, "g");
  const matches = [...contents.matchAll(anchor)];
  if (matches.length === 0) {
    throw new Error(`no \`"version": "${oldVersion}"\` to replace`);
  }
  if (matches.length > 1) {
    throw new Error(`expected exactly one \`"version": "${oldVersion}"\`, found ${matches.length}`);
  }
  return contents.replace(anchor, `$1${newVersion}$2`);
}

/**
 * Asserts every manifest reports the same version and returns it. Throws on
 * drift, naming each file and its version (the loud-failure-before-bump guard).
 */
export function assertInSync(entries: ManifestVersion[]): string {
  const first = entries[0];
  if (first === undefined) {
    throw new Error("no manifests to check for version sync");
  }
  const drifted = entries.some((e) => e.version !== first.version);
  if (drifted) {
    const detail = entries.map((e) => `${e.file}=${e.version}`).join(", ");
    throw new Error(`manifest version drift: ${detail}`);
  }
  return first.version;
}

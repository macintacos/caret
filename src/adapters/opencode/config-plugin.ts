// The comment-preserving editor for caret's entry in an OpenCode config's `plugin`
// array. caret installs into OpenCode as a first-class array plugin
// (`plugin: ["@macintacos/caret"]`), so `caret install --target opencode` adds this
// entry and `--uninstall` removes it. Edits run through jsonc-parser's
// modify/applyEdits so a user's other plugin entries, other config keys, and
// comments all survive — hand-rolled JSON string munging would corrupt a jsonc
// config. Pure text-in/text-out, so it is unit-testable without touching disk.

import { applyEdits, type JSONPath, modify, parse } from "jsonc-parser";

const FORMATTING = { insertSpaces: true, tabSize: 2 } as const;

/** The current `plugin` array as a plain array (empty when absent/not an array). */
function pluginArray(text: string): unknown[] {
  const cfg = parse(text) as { plugin?: unknown } | undefined;
  return Array.isArray(cfg?.plugin) ? cfg.plugin : [];
}

/** A plugin specifier split into its package name and its pinned version (null when
 * the entry is bare). Mirrors how OpenCode's own `parsePluginSpecifier` splits one: for
 * a scoped name the version is the `@` AFTER the `/`; for an unscoped name it is the
 * first `@`. Non-npm entries (a `bun link` path) and malformed scoped names have no such
 * `@`, so the whole string is the package and the version is null. The version segment
 * is returned verbatim — `latest` and `0.8.1` are both just what the user wrote. */
export function splitPluginSpecifier(spec: string): { pkg: string; version: string | null } {
  const from = spec.startsWith("@") ? spec.indexOf("/") : 0;
  if (from === -1) return { pkg: spec, version: null }; // malformed scoped name
  const at = spec.indexOf("@", from + 1);
  return at === -1
    ? { pkg: spec, version: null }
    : { pkg: spec.slice(0, at), version: spec.slice(at + 1) };
}

/** The package name of a plugin specifier, dropping any pinned version — so a
 * bare `@macintacos/caret` and a pinned `@macintacos/caret@0.4.0` share one name. */
function packageName(spec: string): string {
  return splitPluginSpecifier(spec).pkg;
}

/** Whether a `plugin` array entry names `pkg` — matching a version-pinned entry
 * (`<pkg>@x.y.z`) as well as the bare name, so caret is recognized as present
 * regardless of how the user pinned it. */
function entryNames(entry: unknown, pkg: string): boolean {
  return typeof entry === "string" && packageName(entry) === packageName(pkg);
}

/** Add `pkg` to the config's `plugin` array, returning the new config text. Appends
 * to an existing array (idempotent — an already-present entry returns the text
 * unchanged, INCLUDING a version-pinned `<pkg>@x.y.z` entry, so a user's pin is kept
 * and never duplicated), and sets a fresh `["<pkg>"]` array when `plugin` is absent OR
 * present but not an array (a malformed config — replacing it is safer than
 * array-inserting into a non-array, which jsonc-parser throws on). */
export function addPluginToConfigText(existing: string | null, pkg: string): string {
  const text = existing ?? "{}\n";
  const current = (parse(text) as { plugin?: unknown } | undefined)?.plugin;
  if (Array.isArray(current)) {
    if (current.some((e) => entryNames(e, pkg))) return text;
    const path: JSONPath = ["plugin", current.length];
    const edits = modify(text, path, pkg, {
      isArrayInsertion: true,
      formattingOptions: FORMATTING,
    });
    return applyEdits(text, edits);
  }
  const edits = modify(text, ["plugin"], [pkg], { formattingOptions: FORMATTING });
  return applyEdits(text, edits);
}

/** The VERBATIM `plugin` array entry naming `pkg` — pin and all — or null when the
 * config is absent, has no `plugin` array, or lists no entry for `pkg`. The raw string
 * is what callers need: it is both the key OpenCode caches under and the thing a version
 * rewrite replaces. */
export function findPluginEntry(existing: string | null, pkg: string): string | null {
  if (existing === null) return null;
  const entry = pluginArray(existing).find((e) => entryNames(e, pkg));
  return typeof entry === "string" ? entry : null;
}

/** Pin `pkg`'s `plugin` array entry to `version`, returning the new config text —
 * rewriting an existing pin rather than appending beside it. Returns the text unchanged
 * when no entry names `pkg`. Replaces the one array element in place
 * (`modify(text, ["plugin", i], …)`), which keeps sibling entries, other keys, and
 * comments intact — unlike the whole-array replacement `removePluginFromConfigText`
 * needs for its trailing-comma bug. */
export function setPluginVersionInConfigText(
  existing: string,
  pkg: string,
  version: string,
): string {
  const arr = pluginArray(existing);
  const i = arr.findIndex((e) => entryNames(e, pkg));
  if (i === -1) return existing;
  const next = `${packageName(arr[i] as string)}@${version}`;
  const edits = modify(existing, ["plugin", i], next, { formattingOptions: FORMATTING });
  return applyEdits(existing, edits);
}

/** Remove `pkg` from the config's `plugin` array, returning the new config text.
 * Removes a version-pinned `<pkg>@x.y.z` entry as well as the bare name (symmetric
 * with add's idempotency). Returns the text unchanged when no entry names `pkg`.
 * Replaces the whole array with the filtered list rather than deleting the one
 * element — jsonc-parser's array-element deletion mishandles a trailing element's
 * comma — which keeps sibling keys and comments intact (only an unusual in-array
 * comment would be lost). */
export function removePluginFromConfigText(existing: string, pkg: string): string {
  const arr = pluginArray(existing);
  if (!arr.some((e) => entryNames(e, pkg))) return existing;
  const next = arr.filter((e) => !entryNames(e, pkg));
  const edits = modify(existing, ["plugin"], next, { formattingOptions: FORMATTING });
  return applyEdits(existing, edits);
}

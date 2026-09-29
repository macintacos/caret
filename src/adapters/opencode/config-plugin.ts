// The comment-preserving editor for caret's entry in an OpenCode config's plugin list:
// v1's `plugin` array, or v2's `plugins` key, whose items are a specifier string or a
// `{ package, options }` object. `caret install` adds caret's entry and `--uninstall`
// removes it. Edits run through jsonc-parser's modify/applyEdits so a user's other plugin
// entries, other config keys, and comments all survive — hand-rolled JSON string munging
// would corrupt a jsonc config. Pure text-in/text-out, so it is unit-testable without
// touching disk.

import { applyEdits, type JSONPath, modify, parse } from "jsonc-parser";

import { isLocalPluginSpecifier } from "@/adapters/opencode/paths.ts";

const FORMATTING = { insertSpaces: true, tabSize: 2 } as const;

/** The config key a plugin list lives under: v1's `plugin`, v2's `plugins`. */
export type PluginKey = "plugin" | "plugins";

/** The current `key` array as a plain array (empty when absent/not an array). */
function pluginArray(text: string, key: PluginKey): unknown[] {
  const cfg = parse(text) as Record<string, unknown> | undefined;
  const arr = cfg?.[key];
  return Array.isArray(arr) ? arr : [];
}

/** An item's specifier: the string itself, or a `{ package }` object's package. */
function itemSpec(item: unknown): string | null {
  if (typeof item === "string") return item;
  const pkg = (item as { package?: unknown } | null)?.package;
  return typeof item === "object" && typeof pkg === "string" ? pkg : null;
}

/** A plugin specifier split into its package name and its pinned version (null when
 * the entry is bare). Mirrors how OpenCode's own `parsePluginSpecifier` splits one: for
 * a scoped name the version is the `@` AFTER the `/`; for an unscoped name it is the
 * first `@`. Non-npm entries (a `bun link` path) and malformed scoped names have no such
 * `@`, so the whole string is the package and the version is null. The version segment
 * is returned verbatim — `latest` and `0.8.1` are both just what the user wrote. */
export function splitPluginSpecifier(spec: string): { pkg: string; version: string | null } {
  // A local specifier is never split: its tail is a filesystem path, and a directory may
  // legitimately contain an `@` (a worktree named `caret@fix`, a `~/src/work@home` tree)
  // which the npm split would mistake for a pin and truncate.
  if (isLocalPluginSpecifier(spec)) return { pkg: spec, version: null };
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
  const spec = itemSpec(entry);
  return spec !== null && packageName(spec) === packageName(pkg);
}

/** Add `pkg` to the config's `plugin` array, returning the new config text. Appends
 * to an existing array (idempotent — an already-present entry returns the text
 * unchanged, INCLUDING a version-pinned `<pkg>@x.y.z` entry, so a user's pin is kept
 * and never duplicated), and sets a fresh `["<pkg>"]` array when `plugin` is absent OR
 * present but not an array (a malformed config — replacing it is safer than
 * array-inserting into a non-array, which jsonc-parser throws on). */
export function addPluginToConfigText(
  existing: string | null,
  pkg: string,
  key: PluginKey = "plugin",
): string {
  const text = existing ?? "{}\n";
  const current = (parse(text) as Record<string, unknown> | undefined)?.[key];
  if (Array.isArray(current)) {
    if (current.some((e) => entryNames(e, pkg))) return text;
    const path: JSONPath = [key, current.length];
    const edits = modify(text, path, pkg, {
      isArrayInsertion: true,
      formattingOptions: FORMATTING,
    });
    return applyEdits(text, edits);
  }
  const edits = modify(text, [key], [pkg], { formattingOptions: FORMATTING });
  return applyEdits(text, edits);
}

/** The VERBATIM `plugin` array entry naming `pkg` — pin and all — or null when the
 * config is absent, has no `plugin` array, or lists no entry for `pkg`. The raw string
 * is what callers need: it is both the key OpenCode caches under and the thing a version
 * rewrite replaces. */
export function findPluginEntry(
  existing: string | null,
  pkg: string,
  key: PluginKey = "plugin",
): string | null {
  if (existing === null) return null;
  return itemSpec(pluginArray(existing, key).find((e) => entryNames(e, pkg)));
}

/** Every item's specifier in the config's `key` array, in order. Which of them are
 * caret's is the caller's call: recognizing a local entry means asking the filesystem
 * whether the path is a caret checkout, and this module never touches disk. */
export function pluginEntries(existing: string | null, key: PluginKey = "plugin"): string[] {
  return existing === null
    ? []
    : pluginArray(existing, key)
        .map(itemSpec)
        .filter((e) => e !== null);
}

/** Pin `pkg`'s entry in the `key` array (default `plugin`) to `version`, returning the new config text —
 * rewriting an existing pin rather than appending beside it. Returns the text unchanged
 * when no entry names `pkg`. Replaces the one array element — or an object item's
 * `package` — in place, which keeps sibling entries, other keys, and
 * comments intact — unlike the whole-array replacement `removePluginFromConfigText`
 * needs for its trailing-comma bug. */
export function setPluginVersionInConfigText(
  existing: string,
  target: { pkg: string; version: string; key?: PluginKey },
): string {
  const { pkg, version, key = "plugin" } = target;
  const arr = pluginArray(existing, key);
  const i = arr.findIndex((e) => entryNames(e, pkg));
  if (i === -1) return existing;
  const item = arr[i];
  const path: JSONPath = typeof item === "string" ? [key, i] : [key, i, "package"];
  const next = `${packageName(itemSpec(item) ?? pkg)}@${version}`;
  const edits = modify(existing, path, next, { formattingOptions: FORMATTING });
  return applyEdits(existing, edits);
}

/** Rewrite the `key` array to the items `keep` accepts, returning the new config text,
 * or the text unchanged when it keeps every item. Replaces the whole array rather than
 * deleting elements — jsonc-parser's array-element deletion mishandles a trailing
 * element's comma — which keeps sibling keys and comments intact (only an unusual
 * in-array comment would be lost). An emptied `plugins` is deleted outright: OpenCode v1
 * before 1.18.16 refuses to start on the key, even as `[]`. */
export function rewritePluginArray(
  existing: string,
  key: PluginKey,
  keep: (item: unknown) => boolean,
): string {
  const arr = pluginArray(existing, key);
  const next = arr.filter(keep);
  if (next.length === arr.length) return existing;
  const value = key === "plugins" && next.length === 0 ? undefined : next;
  const edits = modify(existing, [key], value, { formattingOptions: FORMATTING });
  return applyEdits(existing, edits);
}

/** Remove `pkg` from the config's `key` array (default `plugin`), returning the new
 * config text. Removes a version-pinned `<pkg>@x.y.z` entry as well as the bare name
 * (symmetric with add's idempotency). Returns the text unchanged when no entry names
 * `pkg`. */
export function removePluginFromConfigText(
  existing: string,
  pkg: string,
  key: PluginKey = "plugin",
): string {
  return rewritePluginArray(existing, key, (e) => !entryNames(e, pkg));
}

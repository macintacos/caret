// The comment-preserving editor for caret's entry in an OpenCode config's plugin list:
// v1's `plugin` array, or v2's `plugins` key, whose items are a specifier string or a
// `{ package, options }` object. `caret install` adds caret's entry and `--uninstall`
// removes it. Edits run through jsonc-parser's modify/applyEdits so a user's other plugin
// entries, other config keys, and comments all survive — hand-rolled JSON string munging
// would corrupt a jsonc config — except deleting an emptied `plugins` key, which cuts
// the property's parse-tree range, since jsonc-parser's removal swallows a preceding
// comment. Pure text-in/text-out, so it is unit-testable without touching disk.

import {
  applyEdits,
  createScanner,
  type Edit,
  findNodeAtLocation,
  type JSONPath,
  modify,
  type ParseError,
  parse,
  parseTree,
  printParseErrorCode,
} from "jsonc-parser";

import { isLocalPluginSpecifier } from "@/adapters/opencode/paths.ts";

const FORMATTING = { insertSpaces: true, tabSize: 2 } as const;

/** The config keys a plugin list lives under — v1's `plugin`, v2's `plugins` — in load
 * order: v2 concatenates legacy `plugin` ahead of `plugins`. */
export const PLUGIN_KEYS = ["plugin", "plugins"] as const;

export type PluginKey = (typeof PLUGIN_KEYS)[number];

/** Why `text` is not a config OpenCode can load — the first parse error, or a root that
 * is not an object — or null when it is. Lenient the way OpenCode is (trailing commas),
 * and an empty file passes: install treats it as a config with no keys. */
export function configParseError(text: string): string | null {
  const errors: ParseError[] = [];
  // Bun, which OpenCode runs on, strips a leading BOM before parsing.
  const root: unknown = parse(text.replace(/^\uFEFF/, ""), errors, {
    allowTrailingComma: true,
    allowEmptyContent: true,
  });
  const [first] = errors;
  if (first !== undefined) return `${printParseErrorCode(first.error)} at offset ${first.offset}`;
  const isObject = typeof root === "object" && root !== null && !Array.isArray(root);
  return root === undefined || isObject ? null : "not a JSON object";
}

/** The current `key` array as a plain array (empty when absent/not an array). */
function pluginArray(text: string, key: PluginKey): unknown[] {
  const cfg = parse(text) as Record<string, unknown> | undefined;
  const arr = cfg?.[key];
  return Array.isArray(arr) ? arr : [];
}

/** An item's specifier: the string itself, or a `{ package }` object's package. */
function itemSpec(item: unknown): string | null {
  if (typeof item === "string") return item;
  if (
    typeof item === "object" &&
    item !== null &&
    "package" in item &&
    typeof item.package === "string"
  ) {
    return item.package;
  }
  return null;
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

/** Whether a plugin-list item (a string or a `{ package }` object) names `pkg` — matching a version-pinned entry
 * (`<pkg>@x.y.z`) as well as the bare name, so caret is recognized as present
 * regardless of how the user pinned it. */
function entryNames(entry: unknown, pkg: string): boolean {
  const spec = itemSpec(entry);
  return spec !== null && packageName(spec) === packageName(pkg);
}

/** Add `pkg` to the config's `key` array, returning the new config text. Appends
 * to an existing array (idempotent — an already-present entry returns the text
 * unchanged, INCLUDING a version-pinned `<pkg>@x.y.z` entry, so a user's pin is kept
 * and never duplicated), and sets a fresh `["<pkg>"]` array when `key` is absent OR
 * present but not an array (a malformed config — replacing it is safer than
 * array-inserting into a non-array, which jsonc-parser throws on). */
export function addPluginToConfigText(
  existing: string | null,
  pkg: string,
  key: PluginKey,
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

/** Every raw item's specifier in the `key` array, null for an unrecognisable item, so
 * index `i` is the array's own index. */
export function pluginItemSpecs(existing: string, key: PluginKey): (string | null)[] {
  return pluginArray(existing, key).map(itemSpec);
}

/** Pin `pkg`'s entry in the `key` array to `version`, returning the new config text —
 * rewriting an existing pin rather than appending beside it. Returns the text unchanged
 * when no entry names `pkg`. Replaces the one array element — or an object item's
 * `package` — in place, which keeps sibling entries, other keys, and comments intact,
 * unlike the whole-array replacement `rewritePluginArray` does. */
export function setPluginVersionInConfigText(
  existing: string,
  target: { pkg: string; version: string; key: PluginKey },
): string {
  const { pkg, version, key } = target;
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
  keep: (item: unknown, index: number) => boolean,
): string {
  const arr = pluginArray(existing, key);
  const next = arr.filter((item, i) => keep(item, i));
  if (next.length === arr.length) return existing;
  if (key === "plugins" && next.length === 0) return deleteProperty(existing, key);
  const edits = modify(existing, [key], next, { formattingOptions: FORMATTING });
  return applyEdits(existing, edits);
}

/** The offset of the comma that follows `from`, skipping whitespace and comments, or
 * null when the next token is not a comma. */
function commaAfter(text: string, from: number): number | null {
  const scanner = createScanner(text, true);
  scanner.setPosition(from);
  scanner.scan();
  return text[scanner.getTokenOffset()] === "," ? scanner.getTokenOffset() : null;
}

/** Widen [start, end) to its whole line, `\n` or `\r\n`, when nothing else sits on it. */
function wholeLine(text: string, start: number, end: number): Edit {
  let lineStart = start;
  let lineEnd = end;
  while (lineStart > 0 && (text[lineStart - 1] === " " || text[lineStart - 1] === "\t"))
    lineStart--;
  while (lineEnd < text.length && (text[lineEnd] === " " || text[lineEnd] === "\t")) lineEnd++;
  const eol = text.startsWith("\r\n", lineEnd) ? 2 : text[lineEnd] === "\n" ? 1 : 0;
  const aloneOnLine =
    (lineStart === 0 || text[lineStart - 1] === "\n") && (lineEnd === text.length || eol > 0);
  return aloneOnLine
    ? { offset: lineStart, length: lineEnd + eol - lineStart, content: "" }
    : { offset: start, length: end - start, content: "" };
}

/** Delete top-level property `key` and one separating comma, leaving every comment —
 * jsonc-parser's own removal swallows a comment that precedes the property. */
function deleteProperty(text: string, key: string): string {
  const root = parseTree(text);
  const prop = root && findNodeAtLocation(root, [key])?.parent;
  const siblings = prop?.parent?.children;
  if (!prop || !siblings) return text;
  const i = siblings.indexOf(prop);
  const end = prop.offset + prop.length;
  const edits: Edit[] = [];
  const trailingComma = commaAfter(text, end);
  if (trailingComma !== null && text.slice(end, trailingComma).trim() === "") {
    edits.push(wholeLine(text, prop.offset, trailingComma + 1));
  } else {
    edits.push(wholeLine(text, prop.offset, end));
    const previousSibling = siblings[i - 1];
    const comma =
      trailingComma ??
      (previousSibling ? commaAfter(text, previousSibling.offset + previousSibling.length) : null);
    if (comma !== null) edits.push({ offset: comma, length: 1, content: "" });
  }
  return applyEdits(text, edits);
}

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

/** Add `pkg` to the config's `plugin` array, returning the new config text. Creates
 * the array (and an object body) when absent. Idempotent: an already-present entry
 * returns the text unchanged. */
export function addPluginToConfigText(existing: string | null, pkg: string): string {
  const text = existing ?? "{}\n";
  const arr = pluginArray(text);
  if (arr.includes(pkg)) return text;
  const path: JSONPath = ["plugin", arr.length];
  const edits = modify(text, path, pkg, { isArrayInsertion: true, formattingOptions: FORMATTING });
  return applyEdits(text, edits);
}

/** Remove `pkg` from the config's `plugin` array, returning the new config text.
 * Returns the text unchanged when the entry isn't present. Replaces the whole array
 * with the filtered list rather than deleting the one element — jsonc-parser's
 * array-element deletion mishandles a trailing element's comma — which keeps sibling
 * keys and comments intact (only an unusual in-array comment would be lost). */
export function removePluginFromConfigText(existing: string, pkg: string): string {
  const arr = pluginArray(existing);
  if (!arr.includes(pkg)) return existing;
  const next = arr.filter((e) => e !== pkg);
  const edits = modify(existing, ["plugin"], next, { formattingOptions: FORMATTING });
  return applyEdits(existing, edits);
}

/** Whether caret's entry is present in the config's `plugin` array. */
export function hasPlugin(text: string, pkg: string): boolean {
  return pluginArray(text).includes(pkg);
}

// Which of OpenCode's plugin entries — v1's `plugin` array or v2's `plugins` — are
// caret's, for install's writer, doctor's probe, and the upgrade check. There are two
// answers, and they differ on purpose: `caretEntries` counts what OpenCode loads — the
// npm package under any pin, or a `--from-local` `file:` entry for a caret checkout —
// while `caretPackageEntry` counts the package form only, because npm's version says
// nothing about a checkout.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  PLUGIN_KEYS,
  type PluginKey,
  pluginItemSpecs,
  rewritePluginArray,
  splitPluginSpecifier,
} from "@/adapters/opencode/config-plugin.ts";
import { CARET_PACKAGE, localSpecifierPath } from "@/adapters/opencode/paths.ts";

/** Whether `dir` is a caret checkout, by the one file OpenCode would have to load out of
 * it. `resolveCaretRoot` asks the same question, so "is this a caret?" has one answer. */
export function isCaretCheckout(dir: string): boolean {
  return existsSync(join(dir, "opencode", "caret.plugin.ts"));
}

/** One caret entry: the key it sits under, its position in that key's raw array, and
 * its verbatim specifier. */
export interface CaretEntry {
  key: PluginKey;
  index: number;
  spec: string;
}

/** The entries that are caret's: the npm package under any pin, plus any local specifier
 * whose path is a caret checkout. A `file:` entry pointing anywhere else is another
 * tool's. `plugin` hits come first, then `plugins`, each in array order — the order both
 * hosts load (v2 concatenates legacy `plugin` ahead of `plugins`; v1 never loads
 * `plugins`). */
export function caretEntries(
  text: string | null,
  isCheckout: (dir: string) => boolean,
): CaretEntry[] {
  if (text === null) return [];
  return PLUGIN_KEYS.flatMap((key) =>
    pluginItemSpecs(text, key).flatMap((spec, index) =>
      spec !== null && isCaretSpec(spec, isCheckout) ? [{ key, index, spec }] : [],
    ),
  );
}

function isCaretSpec(spec: string, isCheckout: (dir: string) => boolean): boolean {
  const path = localSpecifierPath(spec);
  return path === undefined ? splitPluginSpecifier(spec).pkg === CARET_PACKAGE : isCheckout(path);
}

/** Remove `drop` — entries read from `text` — returning the new config text. Each key's
 * array is rewritten exactly once, so the indices read from `text` stay valid across
 * both keys. */
export function dropEntries(text: string, drop: readonly CaretEntry[]): string {
  return PLUGIN_KEYS.reduce((acc, key) => {
    const droppedIndices = new Set(drop.filter((e) => e.key === key).map((e) => e.index));
    return droppedIndices.size === 0
      ? acc
      : rewritePluginArray(acc, key, (_, i) => !droppedIndices.has(i));
  }, text);
}

/** caret's verbatim npm-package entry in `text`, pin and all, `plugin` before `plugins`,
 * or null when the text is null or lists none. */
export function caretPackageEntry(text: string | null): CaretEntry | null {
  return caretEntries(text, () => false)[0] ?? null;
}

/** `caretEntries` across `configFiles`, in the order given. That order is caret's file
 * preference, not OpenCode's load order, and each `index` is per-file — so the result is
 * for reading only and must never reach `dropEntries`. Throws when a file exists but
 * cannot be read. */
export function readCaretEntries(
  configFiles: readonly string[],
  isCheckout: (dir: string) => boolean,
): CaretEntry[] {
  return configFiles.flatMap((f) => caretEntries(readConfigText(f), isCheckout));
}

/** The first `caretPackageEntry` across `configFiles`. Throws when a file exists but
 * cannot be read. */
export function readCaretEntry(configFiles: readonly string[]): CaretEntry | null {
  return readCaretEntries(configFiles, () => false)[0] ?? null;
}

/** The first caret entry across `configFiles` in a form OpenCode can load — the package or
 * a `--from-local` checkout. Whether the host reads the file it sits in is the caller's
 * concern. Throws like `readCaretEntry`. */
export function readLoadedCaretEntry(configFiles: readonly string[]): CaretEntry | null {
  return readCaretEntries(configFiles, isCaretCheckout)[0] ?? null;
}

/** The config file's text, or null when it is absent. */
export function readConfigText(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf-8") : null;
}

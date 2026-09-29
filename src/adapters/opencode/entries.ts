// Which of OpenCode's plugin entries — v1's `plugin` array or v2's `plugins` — are caret's, for install's writer, doctor's
// probe, and the upgrade check. There are two answers, and they differ on purpose:
// `caretEntries` counts what OpenCode loads — the npm package under any pin, or a
// `--from-local` `file:` entry for a caret checkout — while `readCaretEntry` counts the
// package form only, because npm's version says nothing about a checkout.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  findPluginEntry,
  type PluginKey,
  pluginEntries,
  splitPluginSpecifier,
} from "@/adapters/opencode/config-plugin.ts";
import { CARET_PACKAGE, localSpecifierPath } from "@/adapters/opencode/paths.ts";

/** Whether `dir` is a caret checkout, by the one file OpenCode would have to load out of
 * it. `resolveCaretRoot` asks the same question, so "is this a caret?" has one answer. */
export function isCaretCheckout(dir: string): boolean {
  return existsSync(join(dir, "opencode", "caret.plugin.ts"));
}

/** One caret entry: the key it sits under and its verbatim specifier. */
export interface CaretEntry {
  key: PluginKey;
  spec: string;
}

const KEYS: readonly PluginKey[] = ["plugin", "plugins"];

/** The entries that are caret's: the npm package under any pin, plus any local specifier
 * whose path is a caret checkout. A `file:` entry pointing anywhere else is another
 * tool's. `plugin` hits come first, then `plugins`, each in array order — the order both
 * hosts load (v2 concatenates legacy `plugin` ahead of `plugins`; v1 never loads
 * `plugins`). */
export function caretEntries(
  text: string | null,
  isCheckout: (dir: string) => boolean,
): CaretEntry[] {
  return KEYS.flatMap((key) =>
    pluginEntries(text, key)
      .filter((spec) => isCaretSpec(spec, isCheckout))
      .map((spec) => ({ key, spec })),
  );
}

/** Whether one specifier is caret's, by `caretEntries`' rule. */
export function isCaretSpec(spec: string, isCheckout: (dir: string) => boolean): boolean {
  const path = localSpecifierPath(spec);
  return path === undefined ? splitPluginSpecifier(spec).pkg === CARET_PACKAGE : isCheckout(path);
}

/** caret's verbatim npm-package entry in `configFile`, pin and all, `plugin` before
 * `plugins`, or null when the file is absent or lists none. Throws when the file exists
 * but cannot be read. */
export function readCaretEntry(configFile: string): CaretEntry | null {
  const text = readConfigText(configFile);
  for (const key of KEYS) {
    const spec = findPluginEntry(text, CARET_PACKAGE, key);
    if (spec !== null) return { key, spec };
  }
  return null;
}

/** The caret entry OpenCode loads from `configFile`: the package or a `--from-local`
 * checkout, the first in load order when it lists several. Throws like
 * `readCaretEntry`. */
export function readLoadedCaretEntry(configFile: string): CaretEntry | null {
  return caretEntries(readConfigText(configFile), isCaretCheckout)[0] ?? null;
}

/** The config file's text, or null when it is absent. */
export function readConfigText(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf-8") : null;
}

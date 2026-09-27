// Which of OpenCode's `plugin` array entries are caret's, for install's writer, doctor's
// probe, and the upgrade check. There are two answers, and they differ on purpose:
// `caretEntries` counts what OpenCode loads — the npm package under any pin, or a
// `--from-local` `file:` entry for a caret checkout — while `readCaretEntry` counts the
// package form only, because npm's version says nothing about a checkout.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  findPluginEntry,
  pluginEntries,
  splitPluginSpecifier,
} from "@/adapters/opencode/config-plugin.ts";
import { CARET_PACKAGE, localSpecifierPath } from "@/adapters/opencode/paths.ts";

/** Whether `dir` is a caret checkout, by the one file OpenCode would have to load out of
 * it. `resolveCaretRoot` asks the same question, so "is this a caret?" has one answer. */
export function isCaretCheckout(dir: string): boolean {
  return existsSync(join(dir, "opencode", "caret.plugin.ts"));
}

/** The `plugin` array entries that are caret's, in array order: the npm package under any
 * pin, plus any local specifier whose path is a caret checkout. A `file:` entry pointing
 * anywhere else is another tool's. */
export function caretEntries(text: string | null, isCheckout: (dir: string) => boolean): string[] {
  return pluginEntries(text).filter((entry) => {
    const path = localSpecifierPath(entry);
    return path === undefined
      ? splitPluginSpecifier(entry).pkg === CARET_PACKAGE
      : isCheckout(path);
  });
}

/** caret's verbatim npm-package entry in `configFile`, pin and all, or null when the file
 * is absent or lists none. Throws when the file exists but cannot be read. */
export function readCaretEntry(configFile: string): string | null {
  return findPluginEntry(readConfigText(configFile), CARET_PACKAGE);
}

/** The caret entry OpenCode loads from `configFile`: the package or a `--from-local`
 * checkout, the first when it lists both (OpenCode loads both). Throws like
 * `readCaretEntry`. */
export function readLoadedCaretEntry(configFile: string): string | null {
  return caretEntries(readConfigText(configFile), isCaretCheckout)[0] ?? null;
}

/** The config file's text, or null when it is absent. */
export function readConfigText(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf-8") : null;
}

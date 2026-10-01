// doctor's OpenCode checks — `opencode-host` and `opencode-caret-version` — which core
// cannot compute itself, since it imports no adapter. doctor asks for them and appends
// what it is handed.

import { isCaretCheckout, readCaretEntries } from "@/adapters/opencode/entries.ts";
import { hostCheck, loadedConfigFiles } from "@/adapters/opencode/host.ts";
import { isLocalPluginSpecifier } from "@/adapters/opencode/paths.ts";
import { readUpgradeVerdict, upgradeCheck } from "@/adapters/opencode/upgrade.ts";
import type { Check } from "@/doctor/report.ts";
import type { VersionTriple } from "@/lib/semver.ts";

/** The OpenCode checks for `configFiles`, or none when no file carries a caret entry — a
 * Claude-only user then pays no spawn or network call. `opencode-host` checks that the
 * OpenCode on `PATH` loads caret from the keys and files it sits in.
 * `opencode-caret-version` is the upgrade verdict over the files the host loads, skipped
 * when none of them holds caret or for a `file:` entry alone: it re-resolves to its
 * checkout on every start, so npm's version says nothing about it. Throws when a config
 * exists but cannot be read. */
export async function readOpencodeChecks(deps: {
  configFiles: readonly string[];
  opencodeVersion: () => VersionTriple | null;
  published?: () => Promise<string | null>;
}): Promise<Check[]> {
  if (readCaretEntries(deps.configFiles, isCaretCheckout).length === 0) return [];
  const hostVersion = deps.opencodeVersion();
  // An unreadable version can't say a file is ignored; hostCheck reports `unknown` then.
  const loadedFiles =
    hostVersion === null ? deps.configFiles : loadedConfigFiles(deps.configFiles, hostVersion);
  const ignored = deps.configFiles.filter(
    (f) => !loadedFiles.includes(f) && readCaretEntries([f], isCaretCheckout).length > 0,
  );
  const entries = readCaretEntries(loadedFiles, isCaretCheckout);
  const host = hostCheck(hostVersion, [...new Set(entries.map((e) => e.key))], ignored);
  if (entries.length === 0 || entries.every((e) => isLocalPluginSpecifier(e.spec))) return [host];
  const verdict = await readUpgradeVerdict({
    configFiles: loadedFiles,
    host: hostVersion,
    published: deps.published,
  });
  return [host, upgradeCheck(verdict)];
}

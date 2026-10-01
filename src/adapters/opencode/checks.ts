// doctor's OpenCode checks — `opencode-host` and `opencode-caret-version` — which core
// cannot compute itself, since it imports no adapter. doctor asks for them and appends
// what it is handed.

import { caretEntries, isCaretCheckout, readConfigText } from "@/adapters/opencode/entries.ts";
import { hostCheck } from "@/adapters/opencode/host.ts";
import { isLocalPluginSpecifier } from "@/adapters/opencode/paths.ts";
import { readUpgradeVerdict, upgradeCheck } from "@/adapters/opencode/upgrade.ts";
import type { Check } from "@/doctor/report.ts";
import type { VersionTriple } from "@/lib/semver.ts";

/** The OpenCode checks for `configFile`, or none when it carries no caret entry — a
 * Claude-only user then pays no spawn or network call. `opencode-host` checks that the
 * OpenCode on `PATH` loads caret from the keys it sits in. `opencode-caret-version` is
 * the upgrade verdict, skipped for a `file:` entry alone: it re-resolves to its checkout
 * on every start, so npm's version says nothing about it. Throws when the config exists
 * but cannot be read. */
export async function readOpencodeChecks(deps: {
  configFile: string;
  opencodeVersion: () => VersionTriple | null;
  published?: () => Promise<string | null>;
}): Promise<Check[]> {
  const entries = caretEntries(readConfigText(deps.configFile), isCaretCheckout);
  if (entries.length === 0) return [];
  const hostVersion = deps.opencodeVersion();
  const host = hostCheck(hostVersion, [...new Set(entries.map((e) => e.key))]);
  if (entries.every((e) => isLocalPluginSpecifier(e.spec))) return [host];
  const verdict = await readUpgradeVerdict({
    configFile: deps.configFile,
    host: hostVersion,
    published: deps.published,
  });
  return [host, upgradeCheck(verdict)];
}

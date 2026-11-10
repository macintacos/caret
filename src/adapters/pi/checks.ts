// doctor's pi checks — `pi-host`, `pi-caret-entry`, and `pi-caret-version` — which core
// cannot compute itself, since it imports no adapter. doctor asks for them and appends
// what it is handed.

import { existsSync } from "node:fs";
import { join } from "node:path";

import { PI_FLOOR, PI_PACKAGE, type PiVersion } from "@/adapters/pi/host.ts";
import {
  CARET_NPM_SOURCE,
  filtersOutExtensions,
  type PiCaretEntry,
  piRemoveArg,
  readPiCaretEntries,
  readPiSettings,
} from "@/adapters/pi/install.ts";
import type { Check } from "@/doctor/report.ts";
import { isNewer, parseVersionTriple } from "@/lib/semver.ts";

const HOST = { id: "pi-host", title: "pi host" };
const ENTRY = { id: "pi-caret-entry", title: "pi's caret entry" };
const VERSION = { id: "pi-caret-version", title: "pi's caret" };

type NpmEntry = Extract<PiCaretEntry, { form: "npm" }>;

/** The pi checks for pi's user settings under `agentDir`, or none when they list no
 * caret entry — a user without caret in pi pays no `pi` spawn or npm fetch. All three
 * are unknown when settings.json exists but can't be read. `pi-caret-version` is
 * skipped without an npm entry: npm's version says nothing about a local checkout. */
export async function readPiChecks(deps: {
  agentDir: string;
  home: string;
  piVersion: () => PiVersion;
  published: () => Promise<string | null>;
}): Promise<Check[]> {
  const settings = join(deps.agentDir, "settings.json");
  if (existsSync(settings) && readPiSettings(deps.agentDir) === null) {
    return unknownPiChecks(`couldn't read ${settings}`);
  }
  const entries = readPiCaretEntries(deps.agentDir, deps.home);
  if (entries.length === 0) return [];
  const checks = [hostCheck(deps.piVersion()), entryCheck(entries)];
  const npm = entries.find((e): e is NpmEntry => e.form === "npm");
  return npm === undefined ? checks : [...checks, versionCheck(npm, await deps.published())];
}

/** All three pi checks as unknown, for pi settings that can't be read. */
export function unknownPiChecks(reason: string): Check[] {
  return [HOST, ENTRY, VERSION].map(
    (base): Check => ({ ...base, status: "unknown", detail: "", reason }),
  );
}

function hostCheck(version: PiVersion): Check {
  const fail = (detail: string, remedy: string): Check => ({
    ...HOST,
    status: "fail",
    detail,
    remedy,
  });
  switch (version.status) {
    case "ok":
      return { ...HOST, status: "pass", detail: `pi ${version.version}` };
    case "missing":
      return fail("Couldn't run `pi --version`", `install \`${PI_PACKAGE}\` ${PI_FLOOR} or later`);
    case "too-old":
      return fail(
        `pi ${version.version} is older than ${PI_FLOOR}`,
        `upgrade \`${PI_PACKAGE}\` to ${PI_FLOOR} or later`,
      );
    case "pre-rename":
      return fail(
        `pi ${version.version} is the old \`@mariozechner/pi-coding-agent\``,
        `install \`${PI_PACKAGE}\` ${PI_FLOOR} or later, pi's package since the rename`,
      );
    default:
      return version satisfies never;
  }
}

/** Every fault in pi's caret entries joins into one fail, each with its remedy. */
function entryCheck(entries: readonly PiCaretEntry[]): Check {
  const faults: string[] = [];
  const remedies: string[] = [];
  if (entries.length > 1) {
    faults.push(
      `pi loads caret ${entries.length} times: ${entries.map((e) => `\`${e.source}\``).join(", ")}`,
    );
    const removes = entries.map((e) => `\`pi remove ${piRemoveArg(e)}\``).join(" or ");
    remedies.push(`run \`caret install\` to keep one, or drop the extra with ${removes}`);
  }
  for (const e of entries) {
    if (filtersOutExtensions(e)) {
      faults.push(`\`${e.source}\` filters out caret's extension`);
      remedies.push(`run \`pi remove ${piRemoveArg(e)}\`, then \`caret install\``);
    }
    if (e.form === "npm" && e.version === null) {
      faults.push(notInstalled(e));
      remedies.push(`run \`pi install ${e.source}\``);
    }
  }
  if (faults.length > 0) {
    return {
      ...ENTRY,
      status: "fail",
      detail: faults.join("; "),
      remedy: [...new Set(remedies)].join("; "),
    };
  }
  const [only] = entries as [PiCaretEntry];
  const version = only.version === null ? "" : ` ${only.version}`;
  return { ...ENTRY, status: "pass", detail: `pi loads caret${version} from \`${only.source}\`` };
}

function versionCheck(entry: NpmEntry, published: string | null): Check {
  const unknown = (reason: string): Check => ({
    ...VERSION,
    status: "unknown",
    detail: "Could not check which caret pi loads",
    reason,
  });
  const { version, source, pinned } = entry;
  if (version === null) return unknown(notInstalled(entry));
  if (published === null) return unknown("could not reach npm for the published caret version");
  if (parseVersionTriple(published) === null)
    return unknown(`npm reported an unreadable version (${published})`);
  if (parseVersionTriple(version) === null)
    return unknown(`pi's caret has an unreadable version (${version})`);
  if (!isNewer(published, version)) {
    const pin = pinned ? `, pinned by \`${source}\`` : "";
    return {
      ...VERSION,
      status: "pass",
      detail: `pi's caret is ${version}${pin} — already current`,
    };
  }
  if (pinned) {
    return {
      ...VERSION,
      status: "fail",
      detail: `pi pins \`${source}\`; ${published} is published`,
      remedy: `run \`pi install ${CARET_NPM_SOURCE}\` to unpin it`,
    };
  }
  return {
    ...VERSION,
    status: "fail",
    detail: `pi's caret is ${version}; ${published} is published`,
    remedy: "run `caret install`",
  };
}

function notInstalled(entry: PiCaretEntry): string {
  return `pi lists \`${entry.source}\` but its package isn't installed`;
}

// Whether the caret this daemon is, is behind — and what the user should run about it
// (EXC-1205). Split the way the OpenCode install target's upgrade check is: a pure
// verdict over gathered facts (`updateStatusFor`), and a throttled runner that gathers
// them (`runUpdateCheck`). Every effect arrives through UpdateCheckDeps, so the decision
// logic is unit-testable with fakes and reaches no module global.
//
// The verdict is PERSISTED, not just held in memory, which is the one place this
// diverges from the OpenCode plugin's analogous startup nudge. That plugin caches only
// the last-check stamp because it re-toasts on every un-throttled start; this daemon
// idle-shuts-down and respawns per review, so an in-memory-only verdict would read
// `unknown` on nearly every boot and the throttled path would have nothing to report.
// Caching the verdict beside the stamp is what makes "reading the verdict never
// triggers a synchronous network call" true without a network call hiding behind the
// route.
//
// A cached verdict is a claim about one specific build, so the record carries the
// version and commit it was made against. A record that does not match the running
// process is discarded on read — its `available` number describes a caret that is no
// longer running — and a build change likewise bypasses the 24h throttle, because the
// moment right after an upgrade or a rebuild is when the answer matters most.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { readJsonFileSync } from "@/lib/json-file.ts";
import type { CaretLogger } from "@/lib/log.ts";
import { isNewer } from "@/lib/semver.ts";
import { errorMessage, type UpdateStatus } from "@/lib/types.ts";

/** At most one check per day, the ceiling the issue sets. Not a timer: the daemon
 * idle-shuts-down and respawns per review, so a boot-time throttled check already
 * yields roughly one call a day and a `setInterval` would be a second mechanism doing
 * this one's job. */
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** What takes a published install to the newest release — the same command the README
 * documents for updating. */
const REFRESH_COMMAND = "bunx --no-cache @macintacos/caret@latest install --refresh";

/** What takes a local build to trunk's tip. `mise run build --install` is the real task
 * name (doc/DEVELOPMENT.md); `mise build --install` does not exist. */
const REBUILD_COMMAND = "mise run build --install";

/** The facts a verdict is decided over. Each upstream side is null when it could not be
 * read, and a branch that needs a null side yields `unknown` rather than guessing. */
export interface UpdateFacts {
  kind: "binary" | "bundle" | "dev";
  version: string;
  commit: string;
  /** npm's `latest` — what a published install would resolve to. */
  npmLatest: string | null;
  /** GitHub's newest release tag, `v` stripped. */
  release: string | null;
  /** How many commits trunk is ahead of `commit`. */
  aheadBy: number | null;
}

/** One persisted check: when it ran, the build it judged, and what it concluded. */
export interface UpdateRecord {
  checkedAt: number;
  version: string;
  commit: string;
  status: UpdateStatus;
}

/** The injected seam over the record file, so the throttle is testable without a clock
 * or a filesystem. Both halves are best-effort — a read that fails is "no record", and
 * a write that fails just means the next boot checks again. */
export interface UpdateCache {
  read(): UpdateRecord | null;
  write(entry: UpdateRecord): void;
}

/** Every effect runUpdateCheck performs, injected so the runner stays a function of its
 * deps (runDaemon wires the prod readers). */
export interface UpdateCheckDeps {
  kind: "binary" | "bundle" | "dev";
  version: string;
  commit: string;
  /** Whether the user has left the check on — `updates.check` in prefs.json. */
  enabled: () => Promise<boolean>;
  /** Wall clock in ms (Date.now in prod). */
  now: () => number;
  cache: UpdateCache;
  npmLatest: () => Promise<string | null>;
  release: () => Promise<string | null>;
  aheadBy: (commit: string) => Promise<number | null>;
  log: CaretLogger;
}

/** What the gathered facts mean. Pure — no clock, no network, no disk.
 *
 * A dev build has no upstream to be behind. A bundle resolves from npm, so npm's
 * `latest` is the only honest comparison. A binary is judged against the newest
 * release FIRST — that is the bigger news, and it takes precedence over the commit
 * distance — and only then against trunk. A build with no baked commit
 * (resolveCommit's "unknown") has nothing to compare, so the release decides alone
 * rather than degrading a readable verdict to `unknown`. */
export function updateStatusFor(facts: UpdateFacts): UpdateStatus {
  if (facts.kind === "dev") return { kind: "unavailable", reason: "dev" };

  if (facts.kind === "bundle") {
    if (facts.npmLatest === null) return unknown("could not reach npm for the published version");
    return isNewer(facts.npmLatest, facts.version)
      ? { kind: "behind-release", available: facts.npmLatest, command: REFRESH_COMMAND }
      : { kind: "current" };
  }

  if (facts.release === null) return unknown("could not reach GitHub for the newest release");
  if (isNewer(facts.release, facts.version)) {
    return { kind: "behind-release", available: facts.release, command: REFRESH_COMMAND };
  }
  if (facts.commit === "unknown") return { kind: "current" };
  if (facts.aheadBy === null) return unknown("could not compare this build against trunk");
  return facts.aheadBy > 0
    ? { kind: "behind-commit", aheadBy: facts.aheadBy, command: REBUILD_COMMAND }
    : { kind: "current" };
}

/** The last persisted verdict, or `unknown` when nothing usable is cached — absent,
 * unparseable, or recorded against a different version or commit than the one running
 * now. Synchronous: the daemon seeds its reported status from this before it binds. */
export function readCachedStatus(file: string, version: string, commit: string): UpdateStatus {
  const rec = fileUpdateCache(file).read();
  if (!rec || rec.version !== version || rec.commit !== commit) {
    return unknown("no update check has run for this build yet");
  }
  return rec.status;
}

/** Gather and decide, honoring the 24h throttle. Resolves to the `unavailable` verdict
 * when the check is off (a dev build, or the user's opt-out) — a constant the caller
 * can report as-is — and to null when the throttle says there is nothing new to gather,
 * so the caller keeps the verdict it already has. Never rejects: every failure path
 * settles as an `unknown` verdict rather than destabilizing the daemon. */
export async function runUpdateCheck(deps: UpdateCheckDeps): Promise<UpdateStatus | null> {
  if (deps.kind === "dev") return { kind: "unavailable", reason: "dev" };
  try {
    if (!(await deps.enabled())) return { kind: "unavailable", reason: "disabled" };

    const now = deps.now();
    const prev = deps.cache.read();
    const sameBuild = prev?.version === deps.version && prev?.commit === deps.commit;
    // A build change runs regardless: a freshly-upgraded user would otherwise have no
    // verdict at all for up to a day, and the extra call is tied to a user action
    // (running an install or a rebuild), not to a periodic path.
    if (prev && sameBuild && now - prev.checkedAt < CHECK_INTERVAL_MS) return null;

    const settle = (status: UpdateStatus): UpdateStatus => {
      deps.cache.write({ checkedAt: now, version: deps.version, commit: deps.commit, status });
      return status;
    };
    // Stamp up front so an offline or failed attempt still backs off a full day. The
    // status carried forward keeps the record whole: the previous verdict when it was
    // about this same build, and `unknown` otherwise.
    settle(prev && sameBuild ? prev.status : unknown("update check in progress"));

    const status = settle(await gather(deps));
    deps.log.info("update", `update check: ${status.kind}`);
    return status;
  } catch (err) {
    return unknown(errorMessage(err));
  }
}

/** A file-backed UpdateCache. Both halves swallow their failures — a missing, garbage,
 * or unwritable record must never disturb a daemon boot. */
export function fileUpdateCache(path: string): UpdateCache {
  return {
    read: () => asRecord(readJsonFileSync(path)),
    write: (entry) => {
      try {
        mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
        // 0600: the record shares the state dir with plan bodies; keep it private too.
        writeFileSync(path, JSON.stringify(entry, null, 2), { mode: 0o600 });
      } catch {
        // best-effort — a throttle-file write must never disrupt the daemon.
      }
    },
  };
}

/** Read only the upstream sides the install kind actually needs, short-circuiting a
 * compare the verdict would not consult: a binary that is already a release behind, one
 * whose release read failed, and one with no baked commit all decide without it. */
async function gather(deps: UpdateCheckDeps): Promise<UpdateStatus> {
  const base = { kind: deps.kind, version: deps.version, commit: deps.commit };
  if (deps.kind === "bundle") {
    return updateStatusFor({
      ...base,
      npmLatest: await deps.npmLatest(),
      release: null,
      aheadBy: null,
    });
  }
  const release = await deps.release();
  const decided = release === null || isNewer(release, deps.version) || deps.commit === "unknown";
  const aheadBy = decided ? null : await deps.aheadBy(deps.commit);
  return updateStatusFor({ ...base, npmLatest: null, release, aheadBy });
}

/** Narrow a parsed record, or null when it is not one. Every field is load-bearing —
 * a partial record can't answer whether it describes the running build. */
function asRecord(value: unknown): UpdateRecord | null {
  const r = value as Partial<UpdateRecord> | null;
  if (typeof r?.checkedAt !== "number") return null;
  if (typeof r.version !== "string" || typeof r.commit !== "string") return null;
  if (typeof (r.status as { kind?: unknown } | undefined)?.kind !== "string") return null;
  return r as UpdateRecord;
}

function unknown(reason: string): UpdateStatus {
  return { kind: "unknown", reason };
}

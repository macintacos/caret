// What's new after an upgrade: on load, whether the running caret is newer than the
// version this browser last saw, and so whether to open the release notes in between.
// The update report says what is running and whether the check may reach GitHub; the
// record is the browser's own (updatesPref.ts). First sight records silently, so a fresh
// install meets onboarding, never this. The record advances on dismissal, which is App's
// to perform, so a reload mid-read opens the notes again.

import { isNewer, parseVersionTriple } from "@core/lib/semver";
import type { ReleaseNote, UpdateReport } from "@core/lib/types";

/** What a load does about the releases since the last-seen version. */
export type UpgradeNotice =
  | { kind: "none" }
  | { kind: "record" }
  | { kind: "announce"; since: string };

/** The running caret, as GET /api/update reports it. */
export type RunningCaret = Pick<UpdateReport, "install" | "version" | "status">;

/** Announce only a strict upgrade past a record. A dev build is never announced, and the
 * opt-out records rather than reading, since the notes come from GitHub. A same-version
 * or downgraded load leaves the record alone, so it only ever moves forward. */
export function upgradeNotice(running: RunningCaret, lastSeen: string | null): UpgradeNotice {
  if (running.install === "dev") return { kind: "none" };
  const seen = lastSeen !== null && parseVersionTriple(lastSeen) ? lastSeen : null;
  if (seen !== null && !isNewer(running.version, seen)) return { kind: "none" };
  if (seen === null || running.status.kind === "unavailable") return { kind: "record" };
  return { kind: "announce", since: seen };
}

/** Every effect loadUpgradeNotes performs, injected so tests stage them. */
export interface UpgradeNotesDeps {
  /** The version this browser last saw What's new for, or null for none. */
  lastSeen: string | null;
  record: (version: string) => void;
  /** The release notes in (since, running]; rejects when they cannot be read. */
  notesSince: (since: string) => Promise<ReleaseNote[]>;
}

/** The notes to open on this load, or null for none. A failed read is silent and records
 * nothing, so the next load retries; an upgrade that crossed no published release records
 * the running version, since there is nothing to show for it. */
export async function loadUpgradeNotes(
  running: RunningCaret,
  deps: UpgradeNotesDeps,
): Promise<ReleaseNote[] | null> {
  const notice = upgradeNotice(running, deps.lastSeen);
  if (notice.kind === "record") deps.record(running.version);
  if (notice.kind !== "announce") return null;
  const notes = await deps.notesSince(notice.since).catch(() => null);
  if (notes?.length === 0) deps.record(running.version);
  return notes?.length ? notes : null;
}

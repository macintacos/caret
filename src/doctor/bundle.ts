// `caret doctor --bundle` (EXC-1188): a consent-gated archive of the raw material the
// report deliberately leaves out — the live logs in full, and the review records, plan
// bodies included. It is the one caret artifact that is NOT redacted, which is why
// nothing here touches the report: the two paths share only the state-dir paths they
// read, so a change to one cannot leak into the other.
//
// Membership is pinned rather than globbed from the state dir: the three live logs and
// the review records, and never logs/archive/, whose rotated segments would bloat the
// archive without saying anything about a failure happening now.

import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

import type { ZipEntry } from "@/doctor/zip.ts";

/** Every effect the bundle performs, injected so the consent gate's branches run without
 * a terminal and the membership rules run without writing an archive. */
export interface BundleDeps {
  stateDir: string;
  /** The live logs, absolute; each is stored under `logs/<basename>`. */
  logPaths: readonly string[];
  reviewsDir: string;
  now: () => Date;
  /** Whether this run can ask a question — both ends a terminal. */
  isInteractive: () => boolean;
  /** Ask whether to write. null is a cancel, which is a "no", not a failure. */
  confirm: () => Promise<boolean | null>;
  write: (path: string, entries: ZipEntry[], now: Date) => void;
}

/** What the run did, for the caller to report and turn into an exit code. */
export type BundleOutcome =
  | { kind: "written"; path: string }
  | { kind: "declined" }
  | { kind: "refused"; message: string };

/** A filename-safe, lexicographically chronological UTC stamp
 * ("20260604T123456789Z"), so archives sort by age. */
function stamp(now: Date): string {
  return now.toISOString().replace(/[-:.]/g, "");
}

/** Where a bundle goes by default: caret's own state dir, never the working directory —
 * which may itself be a synced folder, and this archive is not redacted. */
function bundlePath(stateDir: string, now: Date): string {
  return join(stateDir, `doctor-${stamp(now)}.zip`);
}

/** Read one member, or null when it is absent or unreadable — a bundle carries what it
 * could get rather than failing on a log that was never written. */
function member(path: string, name: string): ZipEntry | null {
  try {
    return { name, data: readFileSync(path) };
  } catch {
    return null;
  }
}

/** The same ceiling the report's `listReviewFiles` applies, for a harder reason: every
 * member is read whole into memory, and past 65535 entries the archive's 16-bit entry
 * count wraps and the container is malformed. */
const MAX_REVIEW_MEMBERS = 5000;

/** The live logs plus the review records, each under its own prefix. */
function entriesFor(deps: BundleDeps): ZipEntry[] {
  const logs = deps.logPaths.map((p) => member(p, `logs/${basename(p)}`));
  let reviews: string[];
  try {
    reviews = readdirSync(deps.reviewsDir).filter((f) => f.endsWith(".json"));
  } catch {
    reviews = []; // absent dir — a normal first run
  }
  const records = reviews
    .slice(0, MAX_REVIEW_MEMBERS)
    .map((f) => member(join(deps.reviewsDir, f), `reviews/${f}`));
  return [...logs, ...records].filter((e): e is ZipEntry => e !== null);
}

/** Gather the bundle and, once the user has agreed to it, write it. */
export async function runBundle(opts: { yes: boolean }, deps: BundleDeps): Promise<BundleOutcome> {
  if (!opts.yes) {
    if (!deps.isInteractive()) {
      return {
        kind: "refused",
        message:
          "a diagnostics bundle holds unredacted logs and full plan bodies, so it is never written unasked — re-run with --yes to confirm",
      };
    }
    if ((await deps.confirm()) !== true) return { kind: "declined" };
  }
  const now = deps.now();
  const path = bundlePath(deps.stateDir, now);
  deps.write(path, entriesFor(deps), now);
  return { kind: "written", path };
}

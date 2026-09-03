// What an update verdict LOOKS like (EXC-1207). The daemon decides whether this caret
// is behind and publishes the answer — including the exact upgrade command — on
// GET /api/update; this module turns that one verdict into the copy every surface
// renders, so the toast, the two badges, and the Updates pane can never disagree about
// what a status means.
//
// Pure and node-free, in the shape of notify.ts's bellPresentation and safeMode.ts: no
// mount, no fetch, no storage, so every arm unit-tests without a browser. Nothing here
// derives an upgrade command or branches on `install` beyond wording — `status.command`
// rides the wire precisely because the daemon is the only party that knows how this
// caret was installed.

import type { UpdateReport, UpdateStatus } from "@core/lib/types";

/** The daemon's `unknown` reason for a build GitHub cannot compare against trunk —
 * mirrored from NEEDS_COMPARE in src/daemon/update-check.ts, which is daemon-only and so
 * cannot be imported here. The two are coupled by this constant alone: a drift costs the
 * dedicated copy below and falls back to the generic arm, never a broken render. */
const UNCOMPARABLE = "could not compare this build against trunk";

/** Whether this verdict is worth showing the reviewer at all — the whole badge
 * condition. `current`, `unavailable`, and `unknown` are all quiet: only a caret that
 * is actually behind earns a dot. */
export function isUpdatePending(status: UpdateStatus): boolean {
  return status.kind === "behind-release" || status.kind === "behind-commit";
}

/** The identity of the thing being announced, for the once-per-version toast marker, or
 * null for a verdict with nothing to announce. A release is identified by the version
 * available; a commit verdict by how far behind it is, which is what moves when
 * something newer lands (and the daemon's 24h throttle bounds how often it can). */
export function updateSignature(status: UpdateStatus): string | null {
  if (status.kind === "behind-release") return `release:${status.available}`;
  if (status.kind === "behind-commit") return `commit:${status.aheadBy}`;
  return null;
}

/** The load-time nudge, or null when there is nothing to nudge about. Deliberately
 * commandless: a toast is the notice, and the pane is where the command lives. */
export function updateToast(report: UpdateReport): { title: string; message: string } | null {
  const { status } = report;
  if (status.kind === "behind-release") {
    return {
      title: "Update available",
      message: `caret ${status.available} is out — you're running ${report.version}.`,
    };
  }
  if (status.kind === "behind-commit") {
    return {
      title: "Update available",
      message: `caret is ${commits(status.aheadBy)} behind trunk.`,
    };
  }
  return null;
}

/** The Updates pane's copy for every status kind: a headline, a line of detail, and the
 * upgrade command verbatim when the verdict carries one.
 *
 * The two non-verdicts read as ordinary states rather than as failures, which is the
 * point of keeping them apart. `unavailable` is the check being off, and its two reasons
 * say which off it is; `unknown` is the check having run without reaching an answer —
 * routinely a locally-built binary whose commit GitHub cannot compare, which is the DAILY
 * reading on a developer's machine and is framed as normal rather than as a failure. */
export function updatePaneCopy(report: UpdateReport): {
  headline: string;
  detail: string;
  command: string | null;
} {
  const running = `You're running caret ${report.version}.`;
  const status = report.status;
  switch (status.kind) {
    case "behind-release":
      return {
        headline: `caret ${status.available} is available`,
        detail: running,
        command: status.command,
      };
    case "behind-commit":
      return {
        headline: `${commits(status.aheadBy)} behind trunk`,
        detail: running,
        command: status.command,
      };
    case "current":
      return { headline: "caret is up to date", detail: running, command: null };
    case "unavailable":
      return status.reason === "dev"
        ? {
            headline: "Update checks are off for dev builds",
            detail:
              "caret is running from source, so there is no published version to compare against.",
            command: null,
          }
        : {
            headline: "Update checks are off",
            detail: "Turn them back on to hear about a new caret when one is out.",
            command: null,
          };
    case "unknown":
      // The one reason worth its own words, because on a developer's machine it is the
      // normal daily reading rather than a fault: `mise run build --install` bakes an
      // unpushed commit into the binary, GitHub's compare 404s, and the check settles here.
      return status.reason === UNCOMPARABLE
        ? {
            headline: "Nothing to compare against",
            detail: `This caret was built locally, so its commit isn't on trunk for GitHub to compare. ${running}`,
            command: null,
          }
        : {
            headline: "No update information yet",
            // Every other reason is a genuine "could not tell", and the daemon's wording
            // says which. Shown as-is rather than flattened into one line that would hide
            // the case; the reasons carry nothing identifying (see update-check.ts).
            detail: `${sentence(status.reason)}. ${running}`,
            command: null,
          };
  }
}

/** `n` as a pluralized commit count. */
function commits(n: number): string {
  return `${n} commit${n === 1 ? "" : "s"}`;
}

/** A lowercase reason fragment as a sentence-cased clause. */
function sentence(reason: string): string {
  return reason.charAt(0).toUpperCase() + reason.slice(1);
}

// `caret band-link`: the link Claude Code's plan-waiting band (mod/hooks/band.tsx) shows
// — this session's pending review, else caret's UI — printed, or opened with --open.
// The mod asks this CLI rather than the daemon, so host, port, token and the
// [review] band setting resolve by caret's own rules.
//
// Like `caret reconcile`, it GATES NOTHING: every failure is a SILENT exit 0 with no
// stdout (no link means no band), never the CLI's fail-safe deny line. It never logs
// the URL, which can carry the login token.

import { bootHookLogging } from "@/commands/boot.ts";
import { browserLoginToken, openBrowser } from "@/commands/review.ts";
import { loadSettings } from "@/config/settings.ts";
import { daemonBaseUrl, localHostname, loginLink } from "@/daemon/address.ts";
import { sessionReview } from "@/daemon/client.ts";
import { logDebug } from "@/lib/log.ts";
import { reviewUrl } from "@/review/orchestrate.ts";

export interface BandLinkDeps {
  /** The session's pending review id; rejects when no daemon answers. */
  pendingReviewId: () => Promise<string | undefined>;
  sleep: (ms: number) => Promise<void>;
}

/** Poll for the session's review: the band starts with the hook, a beat before the review is posted. */
export async function awaitPendingReview(
  deps: BandLinkDeps,
  attempts = 25,
  intervalMs = 200,
): Promise<string | undefined> {
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await deps.sleep(intervalMs);
    const id = await deps.pendingReviewId().catch(() => undefined);
    if (id !== undefined) return id;
  }
  return undefined;
}

/** The band's link: the review when found, else caret's UI, logged in when `token` is set. */
export function bandLink(
  baseUrl: string,
  hostname: string,
  id: string | undefined,
  token: string | null,
): string {
  const url = reviewUrl(baseUrl, hostname, id);
  return token === null ? url : loginLink(url, token);
}

export async function runBandLinkSubcommand(opts: {
  session: string;
  open?: boolean;
}): Promise<void> {
  try {
    const s = loadSettings();
    bootHookLogging(s);
    if (s.review.band) {
      const baseUrl = daemonBaseUrl(s);
      const id = await awaitPendingReview({
        pendingReviewId: async () => (await sessionReview(baseUrl, opts.session))?.id,
        sleep: Bun.sleep,
      });
      const url = bandLink(baseUrl, localHostname(s.daemon.host), id, browserLoginToken(s.daemon));
      if (opts.open) openBrowser(url);
      else process.stdout.write(`${url}\n`);
    }
  } catch (err) {
    logDebug("band-link", "band link skipped", { err: String(err) });
  }
  process.exit(0);
}

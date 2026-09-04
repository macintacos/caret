// Node-side redaction for shareable logs (EXC-399). Two consumers share it: the
// live [logging].redact switch (src/lib/log.ts scrubs at emit time) and the
// after-the-fact `caret redact` subcommand (redactLogText/redactLogFiles),
// which a future feedback-submission UI can also call. The value-graph walk and
// the DENY_KEYS denylist live in src/redact/core.ts (browser-safe, shared with
// the UI side); this module adds the node-only string scrub (home paths) and
// the NDJSON file round-trips.
//
// pino's own `redact` option is deliberately unused: fast-redact censors
// whole values at enumerated key paths only — it cannot rewrite substrings
// inside err.stack/msg (the primary leak), cannot cover unbounded cause-chain
// depth without path enumeration, is fixed at logger construction so it can't
// hot-toggle with the settings service, and offers nothing after the fact.

import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";

import { daemonLogFile, daemonStderrLogFile, logFile } from "@/config/paths.ts";
import { CENSOR, scrubGraph } from "@/redact/core.ts";

/** Foreign home paths (another user's, or Linux logs read on macOS): drop only
 * the username segment, keep the shape and sub-path for debuggability. */
const FOREIGN_HOME = /(\/Users\/|\/home\/)[^/\s"']+/g;

/** Scrub identifiable paths inside a string: the current home directory
 * becomes ~ (literal replaceAll, not a regex, so metacharacters in the path
 * can't bite; degenerate homes like "/" are skipped so ~ isn't injected
 * everywhere), then any remaining /Users/<x> or /home/<x> loses its username
 * segment. `home` is injectable for tests only. */
export function scrubString(s: string, home = homedir()): string {
  const dehomed = home.length > 1 ? s.replaceAll(home, "~") : s;
  return dehomed.replace(FOREIGN_HOME, `$1${CENSOR}`);
}

/** Walk a record's value graph, scrubbing strings when `redact` is on and
 * censoring DENY_KEYS unconditionally — the shared scrubGraph walk with this
 * runtime's home-path string scrub wired in when the toggle is on (off, only
 * DENY_KEYS censoring applies). */
export function scrubValue(v: unknown, redact: boolean): unknown {
  return scrubGraph(v, redact ? scrubString : undefined);
}

/** After-the-fact scrub of NDJSON log text: parseable `{`-lines round-trip
 * through scrubValue (full redaction on), everything else — raw crash traces,
 * truncated/malformed records — is scrubbed as plain text. Never throws. */
export function redactLogText(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      if (line.startsWith("{")) {
        try {
          return JSON.stringify(scrubValue(JSON.parse(line), true));
        } catch {
          // Malformed (e.g. a mid-write truncation): fall through to text scrub.
        }
      }
      return scrubString(line);
    })
    .join("\n");
}

/** Scrub each existing log into a shareable sibling (caret.log →
 * caret.redacted.log, 0600 like the originals) and return the written paths.
 * Defaults to the three live logs, the daemon's raw stderr included — it holds
 * the crash traces daemon.log no longer carries (EXC-1068); rotated archives
 * are out of scope, gunzip one and pass it explicitly. Absent files are
 * skipped; write failures propagate to the caller (the `caret redact`
 * subcommand reports them — silently skipping a failed write would look like
 * success). */
export function redactLogFiles(
  files: string[] = [logFile(), daemonLogFile(), daemonStderrLogFile()],
): string[] {
  const written: string[] = [];
  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(file, "utf-8");
    } catch {
      continue; // absent or unreadable — nothing to share
    }
    const sibling = `${file.replace(/\.log$/, "")}.redacted.log`;
    writeFileSync(sibling, redactLogText(text), { mode: 0o600 });
    written.push(sibling);
  }
  return written;
}

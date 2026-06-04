// Redaction core for shareable logs (EXC-399). Two consumers share it: the
// live [logging].redact switch (src/log.ts scrubs at emit time) and the
// after-the-fact `caret redact` subcommand (redactLogText/redactLogFiles),
// which a future feedback-submission UI can also call.
//
// pino's own `redact` option was reviewed and rejected: fast-redact censors
// whole values at enumerated key paths only — it cannot rewrite substrings
// inside err.stack/msg (the primary leak), cannot cover unbounded cause-chain
// depth without path enumeration, is fixed at logger construction so it can't
// hot-toggle with the settings service, and offers nothing after the fact.

import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { daemonLogFile, logFile } from "./paths.ts";

const CENSOR = "<redacted>";

/** Keys whose values must never reach a log, toggle or no toggle — codifies
 * the "never log plan/prompt/feedback bodies" rule (EXC-444 added feedback:
 * reviewer prose is user-generated content like plan bodies) as a structural
 * invariant rather than a code-review convention. Exact-key matching only:
 * a future identifying key (hostname, user, email, …) must be added here
 * explicitly. */
const DENY_KEYS = new Set(["plan", "prompt", "feedback"]);

/** Cause chains are short; anything deeper than this is pathological. */
const MAX_DEPTH = 6;

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
 * censoring DENY_KEYS unconditionally. Builds new structures (never mutates),
 * caps depth, and tolerates cycles — `seen` tracks the current path only, so
 * repeated (shared) references are walked normally while true cycles cut off. */
export function scrubValue(v: unknown, redact: boolean): unknown {
  return walk(v, redact, 0, new WeakSet());
}

function walk(v: unknown, redact: boolean, depth: number, seen: WeakSet<object>): unknown {
  if (typeof v === "string") return redact ? scrubString(v) : v;
  if (v === null || typeof v !== "object") return v;
  if (seen.has(v)) return "<cyclic>";
  if (depth >= MAX_DEPTH) return "<depth-capped>";
  seen.add(v);
  let out: unknown;
  if (Array.isArray(v)) {
    out = v.map((el) => walk(el, redact, depth + 1, seen));
  } else {
    const obj: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      obj[k] = DENY_KEYS.has(k) ? CENSOR : walk(val, redact, depth + 1, seen);
    }
    out = obj;
  }
  seen.delete(v);
  return out;
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
 * Absent files are skipped; write failures propagate to the caller (the
 * `caret redact` subcommand reports them — silently skipping a failed write
 * would look like success). */
export function redactLogFiles(files: string[] = [logFile(), daemonLogFile()]): string[] {
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

---
description: Review caret's recent reviews and errors from its logs and help debug failures
---

caret persists every review and logs to its state dir. This command reviews the current
session — the plans sent for review and their outcomes — and surfaces recent errors so a
failure can be diagnosed. A failure usually first shows as a deny like "caret: … — denying
so no unreviewed plan ships."

## 1. Locate caret's state

```bash
dir="${XDG_STATE_HOME:-$HOME/.local/state}/caret"
```

- `reviews/<id>.json` — one JSON review record per file: `id`, `sessionId`, `cwd`,
  `title`, `status` (`pending`/`rejected`/`approved`/`expired`), a `versions` array, and
  (once resolved) a `decision`.
- `logs/caret.log` / `logs/daemon.log` — NDJSON, one object per line: `level` (pino
  numeric: 20 debug, 30 info, 40 warn, 50 error), `time`, `step`, `msg`, and on errors an
  `err` chain. Feedback and plan bodies are never logged.
- `logs/daemon-stderr.log` — the daemon's raw stderr: crash traces and other non-JSON
  output written outside the logger.

Live logs rotate into `logs/archive/<name>-<stamp>.log.gz`; those archives are out of
scope below — `gunzip -c` one and rerun the recipe against the result.

## 2. Session review

Reconstruct this session's reviews (newest session whose `cwd` matches the working
directory), grouped by status. Never select or echo `versions[].plan` or
`generalCommentDraft` — they hold full plan/draft bodies.

```bash
sid=$(jq -rs --arg cwd "$PWD" '[.[] | select(.cwd == $cwd)] | sort_by(.updatedAt) | last | .sessionId // empty' "$dir"/reviews/*.json)
jq -s --arg sid "$sid" '[.[] | select(.sessionId == $sid)] | sort_by(.createdAt) | .[] | {id, title, status, versions: (.versions | length), feedback: .decision.feedback}' "$dir"/reviews/*.json
```

If `$dir/reviews` is missing or empty the glob won't match — treat that as "no reviews
recorded", not a failure.

## 3. Recent errors

```bash
grep '^{' "$dir/logs/caret.log"  | jq -s '[.[] | select(.level >= 50)] | .[-5:]'
grep '^{' "$dir/logs/daemon.log" | jq -s '[.[] | select(.level >= 50)] | .[-5:]'
tail -n 40 "$dir/logs/daemon-stderr.log"
```

A "socket connection closed" on the hook side often has its real cause on the daemon side
— check both, and the stderr tail for a crash that never reached `daemon.log`. If neither
NDJSON log has a record with `level >= 50` and the stderr log holds no crash output,
report "caret has no errors recorded".

## 4. Debug

If a failure is present, reason from the failing step, msg, cause, and stack to the likely
cause and propose a fix. Keep output diagnostic-focused; never fetch or echo plan content
into the conversation.

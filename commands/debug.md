---
description: Review the current caret session — pending/approved/rejected/expired plans plus recent errors — and help debug failures
---

caret persists every review and logs to its state dir. This command reviews the current session —
the plans you've sent for review and their outcomes — and surfaces recent errors so a failure can be
diagnosed. A failure usually first shows as a deny like "caret: … — denying so no unreviewed plan
ships. See …/caret.log."

## 1. Locate caret's state

caret writes to its state dir — `$XDG_STATE_HOME/caret` when that variable is set, otherwise `~/.local/state/caret`:

- `reviews/<id>.json` — one JSON review record per file, kept on disk as history after it resolves.
  Each record carries `id`, `sessionId`, `cwd`, `title`, `status`
  (`pending`/`rejected`/`approved`/`expired`),
  a `versions` array (plan revisions), and — once resolved — a `decision`
  (`behavior`/`feedback`/`acceptMode`/`decidedAt`).
- `caret.log` — NDJSON records from the short-lived `caret review` hook process, one JSON object
  per line: `level` (pino numeric: 20 debug, 30 info, 40 warn, 50 error), `time` (epoch ms),
  `step`, `msg`, optional `sessionId`/`cwd`/`feedback`, and — on errors — `err` with `message`,
  `stack`, and a nested `cause` chain. Normal operation (a review decision, a format reject) logs
  at info; only genuine failures sit at level ≥ 50.
- `daemon.log` — the detached daemon's stdout/stderr: the same NDJSON shape (tagged with `pid`)
  for lifecycle and request errors, possibly interleaved with raw non-JSON lines (crash traces,
  port messages).

Lines that don't start with `{` (including pre-NDJSON sentinel records from older caret versions)
are skipped by the `grep '^{'` filters below.

Resolve the directory once:

```bash
dir="${XDG_STATE_HOME:-$HOME/.local/state}/caret"
```

## 2. Session review

Reconstruct the current session's reviews. Identify the session by filtering reviews whose `cwd`
matches the working directory and taking the `sessionId` of the most recently updated match, then
list every review in that session, oldest first:

```bash
sid=$(jq -rs --arg cwd "$PWD" '[.[] | select(.cwd == $cwd)] | sort_by(.updatedAt) | last | .sessionId // empty' "$dir"/reviews/*.json)
jq -s --arg sid "$sid" '[.[] | select(.sessionId == $sid)] | sort_by(.createdAt) | .[] | {id, title, status, versions: (.versions | length), decidedAt: .decision.decidedAt, feedback: .decision.feedback}' "$dir"/reviews/*.json
```

If `$dir/reviews` is missing or empty, the glob won't match and these commands error (shell or jq,
depending on the shell) — treat that as "no reviews recorded", not as a failure.

Present the result grouped by status:

- **pending** — awaiting a decision in the browser.
- **rejected** — changes requested; awaiting a revised plan. Include a short excerpt of the
  decision `feedback`.
- **approved** — plan accepted; terminal success.
- **expired** — abandoned by its hook (timeout) or superseded by a resubmitted plan; terminal,
  never reviewed (EXC-454).

For each review show its id, title, and version count (`versions` above — the number of plan
revisions). Note that the field whitelist above is deliberate: `versions[].plan` and
`generalCommentDraft` hold full plan and draft bodies — never select or echo them.

If no review matches the working directory (`sid` comes back empty), say so, then fall back to the
most recently updated session across all reviews — recompute `sid` and re-run the listing command
above with it:

```bash
sid=$(jq -rs 'sort_by(.updatedAt) | last | .sessionId // empty' "$dir"/reviews/*.json)
```

## 3. Recent errors

- **caret.log** — extract the **last 5 error records** (level ≥ 50), then report each one's step,
  msg, and `err` message/cause/stack:

  ```bash
  grep '^{' "$dir/caret.log" | jq -s '[.[] | select(.level >= 50)] | .[-5:]'
  ```

- **daemon.log** — same extraction for the daemon side, plus a raw tail for non-JSON crash output
  near the time of the hook failure:

  ```bash
  grep '^{' "$dir/daemon.log" | jq -s '[.[] | select(.level >= 50)] | .[-5:]'
  tail -n 40 "$dir/daemon.log"
  ```

  For a human-readable rendering of either log: `grep '^{' <log> | bunx pino-pretty`.

  If `jq` isn't available, fall back to `grep '^{' <log> | tail -n 20` and read the raw NDJSON
  directly — each line is a self-contained JSON record.

A "socket connection closed" on the hook side often has its real cause on the daemon side, so check
both. The surrounding info records (review created/resolved, plan rejected with its `feedback`)
give the timeline leading up to a failure:

```bash
grep '^{' "$dir/caret.log" | tail -n 10 | jq -c '{time, level, step, msg}'
```

## 4. Handle the empty case

Two independent axes — report each on its own:

- **No reviews for this project** — if the cwd matches no review and the fallback finds nothing,
  state that plainly. Don't imply a failure occurred; an absence of reviews just means none have
  been sent from here yet.
- **No error records** — if neither log contains a record with `level >= 50`, report **"caret has
  no errors recorded"**. Info records alone (rejected plans, routine lifecycle) are normal
  operation, not errors. The session review still renders if reviews exist.

## 5. Debug

If a failure is present (an error record at level ≥ 50) and the `/systematic-debugging` skill is
available, invoke it to drive root-cause investigation from the logged error (it's the right tool
for turning a stack trace into a confirmed root cause). Otherwise, reason from the failing step,
msg, cause, and stack to the likely cause and propose a fix.

If no failure is present, stop after the session review — there is nothing to debug.

Keep your output diagnostic-focused — step, msg, cause, stack. The logs deliberately avoid full
plan bodies, and review JSON contains them under `versions[].plan`; never fetch or echo plan content
into this conversation.

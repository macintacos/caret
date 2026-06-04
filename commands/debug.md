---
description: Inspect caret's most recent failure from its logs and help debug it
---

When a caret review fails you'll have seen a deny like "caret: … — denying so no unreviewed plan
ships. See …/caret.log." The details are written to two logs. This command surfaces the most recent
failure so it can be diagnosed.

## 1. Locate the logs

caret writes to its state dir — `$XDG_STATE_HOME/caret` when that variable is set, otherwise `~/.local/state/caret`:

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

## 2. Read the most recent failure

- **caret.log** — extract the **last error record** (level ≥ 50), then report its step, msg, and
  `err` message/cause/stack:

  ```bash
  grep '^{' "$dir/caret.log" | jq -s '[.[] | select(.level >= 50)] | last'
  ```

- **daemon.log** — same extraction for the daemon side, plus a raw tail for non-JSON crash output
  near the time of the hook failure:

  ```bash
  grep '^{' "$dir/daemon.log" | jq -s '[.[] | select(.level >= 50)] | last'
  tail -n 40 "$dir/daemon.log"
  ```

  For a human-readable rendering of either log: `grep '^{' <log> | bunx pino-pretty`.

A "socket connection closed" on the hook side often has its real cause on the daemon side, so check
both. The surrounding info records (review created/resolved, plan rejected with its `feedback`)
give the timeline leading up to the failure:

```bash
grep '^{' "$dir/caret.log" | tail -n 10 | jq -c '{time, level, step, msg}'
```

## 3. Handle the empty case

If neither log exists, or neither contains a record with `level >= 50`, report **"caret has no
errors recorded — nothing to debug"** and stop. Do not imply a failure occurred — info records
alone (rejected plans, routine lifecycle) are normal operation, not errors.

## 4. Debug

If the `/systematic-debugging` skill is available, invoke it to drive root-cause investigation from
the logged error (it's the right tool for turning a stack trace into a confirmed root cause).
Otherwise, reason from the failing step and stack to the likely cause and propose a fix.

Keep your output diagnostic-focused — step, msg, cause, stack. The logs deliberately avoid full
plan bodies; don't fetch or echo plan content into this conversation.

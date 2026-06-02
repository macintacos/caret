---
description: Inspect caret's most recent failure from its logs and help debug it
---

When a caret review fails you'll have seen a deny like "caret: … — denying so no unreviewed plan
ships. See …/caret.log." The details are written to two logs. This command surfaces the most recent
failure so it can be diagnosed.

## 1. Locate the logs

caret writes to its state dir — `$XDG_STATE_HOME/caret` when that variable is set, otherwise `~/.local/state/caret`:

- `caret.log` — errors from the short-lived `caret review` hook process. Structured: one record per
  failure, each opened by a `=== caret error <timestamp> step=<step> ===` line, followed by the
  message, any `cause:` chain, an optional `context:` line (sessionId/cwd, present only when known),
  and the stack.
- `daemon.log` — the detached daemon's stdout/stderr plus its lifecycle log (`[caret daemon] …`).

Resolve the directory once:

```bash
dir="${XDG_STATE_HOME:-$HOME/.local/state}/caret"
```

## 2. Read the most recent failure

- **caret.log** — show the **last** record (from the final `=== caret error` header to end of
  file), then report its step, message, cause chain, and stack:

  ```bash
  awk '/^=== caret error /{b=""} {b=b $0 ORS} END{printf "%s", b}' "$dir/caret.log"
  ```

- **daemon.log** — show the tail and look for a `[caret daemon] request error:` line or a crash
  near the time of the hook failure:

  ```bash
  tail -n 40 "$dir/daemon.log"
  ```

A "socket connection closed" on the hook side often has its real cause on the daemon side, so check
both.

## 3. Handle the empty case

If neither log exists, or both are empty, report **"caret has no errors recorded — nothing to
debug"** and stop. Do not imply a failure occurred.

## 4. Debug

If the `/systematic-debugging` skill is available, invoke it to drive root-cause investigation from
the logged error (it's the right tool for turning a stack trace into a confirmed root cause).
Otherwise, reason from the failing step and stack to the likely cause and propose a fix.

Keep your output diagnostic-focused — step, message, cause, stack. The logs deliberately avoid full
plan bodies; don't fetch or echo plan content into this conversation.

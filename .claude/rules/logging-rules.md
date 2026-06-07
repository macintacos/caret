---
name: logging-rules
description: Contributor conventions for caret's pino NDJSON logging — when to log, levels, message style, redaction, and where logs live.
---

# Logging Rules

caret logs as leveled NDJSON via pino, across two sinks — plus a browser bridge that writes through
the second — sharing one record shape (`{"level":30,"time":...,"step":"x","msg":"...",...}`):

- **Hook processes** (the short-lived `caret review` hook) call
  `logDebug/logInfo/logWarn/logError(step, msg, extra?)` from `src/log.ts`, which append to
  `caret.log`.
- **The daemon** holds a `CaretLogger` built by `createDaemonLogger` (`src/log.ts`) and writes NDJSON
  to stderr, which `spawnDaemon` redirects into `daemon.log`.
- **The browser UI** has no sink of its own: `uiLog` (`ui/src/lib/log.ts`) batches events to the
  daemon's `POST /api/logs` (EXC-445), which writes them through the daemon's `CaretLogger` — they
  land in `daemon.log` tagged `source: "ui"`, with leveling and redaction applied like any other
  record.

`error` is special: it takes the raw thrown value, not a string. For an `Error`, the `cause` chain is
serialized into the record's `err` field and the `msg` derives from the error's message; for any
other value the stringified value becomes the `msg`.

Logging is non-essential and **never throws**. Construction and every emit are wrapped, degrading to
a silent no-op on failure — a logging failure must never turn an allow into a deny or crash a hook.
Two consequences for contributors:

- Never let a log call's failure destabilize the caller. You don't need to guard log calls; they
  already swallow everything.
- Never put load-bearing side effects in log arguments. The expression you pass may never run (the
  emit can no-op), so it must be free of effects the rest of the code depends on.

House style, from real call sites:

```ts
log.info("review", "review created: abc123");
logInfo("decision", "plan approved", { ...ctx });
log.info("idle", "idle shutdown");
```

## When to add a log

Log the events a human or LLM would want on a timeline when reconstructing what happened:

- **Lifecycle events** — start, stop, listen, idle shutdown.
- **Decisions and state changes** — review created/resolved, plan approved/rejected.
- **Genuine failures** — at `error` (see below).

Do **not** log per-iteration noise, nor anything already visible in an adjacent record. A second line
that restates the line above it is clutter, not signal.

## Which level

| Level   | Numeric | When to use                                                                                  |
| ------- | ------- | -------------------------------------------------------------------------------------------- |
| `debug` | 20      | Diagnostic detail for tracing a flow. Off by default.                                        |
| `info`  | 30      | Normal operation worth a timeline entry. This is the default level.                          |
| `warn`  | 40      | A recoverable oddity that deserves attention but didn't fail the operation.                  |
| `error` | 50      | Genuine failures only.                                                                        |

`error` is for genuine failures only. `/caret:debug` and users treat any record at level ≥ 50 as a
failure, so a noisy `error` level cries wolf — a recoverable oddity is a `warn`, not an `error`.

## Message style

This is an explicit acceptance criterion; honor it faithfully.

Log messages are written for clarity and human-readability — humans and LLMs alike read them to make
sense of what's going on, so they must not be under-descriptive. But keep them short: treat ~50
characters as a loose maximum. Detail belongs in structured metadata (`extra`), which has no hard
limit but should stay reasonable. A reader should be able to scan log lines without being overwhelmed
and distinguish important events by their informative messages alone.

Concretely:

- Messages are **lowercase, factual, present tense**: `"review created: <id8>"`, `"plan rejected"`.
  Review ids in messages are truncated to their first 8 chars via `shortId` (`src/log.ts`) — the
  full id rides in the record's `reviewId` field.
- `step` is a **short fixed lowercase token** naming the operation (`review`, `resolve`,
  `decision`, `idle`, `listen`, `settings`, `signal`, `store`, `prefs`, `draft`, `env`, `ui`,
  `poll`, `render`, `prewarm`, `retire`, `spawn`, `request`, `fatal`). Reuse an existing token
  before minting a new one.
- Review-scoped records carry structured `reviewId` / `sessionId` fields in `extra` so one session
  stitches across the two log streams (EXC-444).
- Every record carries a `source` field naming the emitting process — `"hook"`, `"daemon"`, or
  `"ui"` (EXC-445). The logger attaches its own token unless `extra.source` is already set; the
  explicit value winning is how bridged browser events stay `"ui"` through the daemon's logger.
- Hook and daemon records carry a `caller` field — the emitting call site as a repo-relative
  `file:line`, stamped by `wrap()` in `src/log.ts` (EXC-451). Bridged UI records carry none. It is
  best-effort: the field is omitted if the stack can't be parsed (e.g. an unmapped compiled binary).
- `extra` keys must **not collide** with the record's own fields: `level`, `time`, `msg`, `step`,
  `pid`, `err`, `caller`.

## The redaction rule

**Never log identifiable data.**

- **Plan, prompt, and feedback bodies are structurally censored.** The `DENY_KEYS` set in
  `src/redact-core.ts` censors `plan`, `prompt`, and `feedback` values unconditionally — toggle or
  no toggle. Never log them under any key.
- **New identifying keys must be added to `DENY_KEYS` explicitly.** Matching is exact-key only, so a
  hostname, user, email, or similar identifying key you introduce will leak until you add it to the
  set. `DENY_KEYS` and the censoring graph-walk live **once** in `src/redact-core.ts` — a
  browser-safe pure-TS module both runtimes import: the daemon/hook side via `src/redact.ts` (which
  adds the home-path string scrub and applies it at write time) and the browser side via the
  `@core` alias in `ui/src/lib/log.ts` (which censors before the dev console mirror). A new key
  added there covers both sides at once.
- **Day-to-day logs are raw.** `[logging].redact` defaults to `false`. `caret redact` produces
  shareable `*.redacted.log` copies after the fact, and `redact = true` scrubs (home paths → `~`,
  usernames in foreign home paths censored) at write time. Write every message and `extra` assuming
  it may be shared.
- **The review `cwd` is raw locally, scrubbed on share.** `review.ts` logs the review's working
  directory verbatim in the `review requested` record (and every `ctx`-spreading record) under the
  default `redact = false`, because which project a review came from is genuine diagnostic context.
  It is an absolute path carrying a username, so it is identifying — but it is deliberately
  **not** a `DENY_KEY` (that would censor it unconditionally, even in local debug logs,
  contradicting the scrub-on-share model). The home-path scrub covers it instead: `redact = true`
  / `caret redact` turns the current user's home into `~` and censors a foreign home's username
  segment, so a shared log leaks no identifying path. That is the scrub-on-share treatment any
  path-valued field gets; content keys (`plan`/`prompt`/`feedback`) are the `DENY_KEYS` exception
  precisely because their bodies must never appear at any toggle.

## Where logs live

Logs live under `$XDG_STATE_HOME/caret` (default `~/.local/state/caret`):

- `caret.log` — records from the short-lived hook processes.
- `daemon.log` — the daemon's stdout/stderr: the same NDJSON shape (tagged with `pid`), possibly
  interleaved with raw non-JSON crash output.

`caret.log` is created `0600`, inside a `0700` state dir; `daemon.log` is a plain append-mode
redirect. The `0700` state dir is enforced by `ensureStateDir()` (`src/paths.ts`), which every
mkdir-of-stateDir site routes through (log, store, prefs, lock, spawn) — it chmods an already
existing dir, so the mode holds regardless of which caller creates the dir first (EXC-539). Writes
are synchronous, so a record logged just before `process.exit` (fail-safe and signal paths) is
durable.

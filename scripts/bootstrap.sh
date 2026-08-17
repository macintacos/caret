#!/usr/bin/env bash
#
# Dep-free bootstrap preamble (EXC-932). A .mise/tasks/ forwarder sources it
# before it reaches bun:
#
#   source "$(dirname "${BASH_SOURCE[0]}")/../../scripts/bootstrap.sh" || exit 1
#
# The `|| exit 1` is part of the contract, not decoration: a failed install —
# cold, or the warm path's refresh — returns non-zero here, and the `exec bun …`
# that follows would otherwise die on a bare command-not-found instead of the
# real error.
#
# Every forwarder is `exec bun scripts/tasks/cli.ts <name> "$@"`, and cli.ts
# imports its CLI framework and every task module at load time — so on a fresh
# clone the process dies during module resolution, before any task code runs,
# and `mise run setup` cannot fix the very state it exists to fix. That is why
# this file stays pure bash: no imports, no runtime, no deps.
#
# SOURCED, NOT EXECUTED. The CARET_BOOTSTRAPPED marker only reaches the
# forwarder if this runs in the forwarder's own shell; an executed subprocess
# would export it into a process that immediately dies. That rules out `exit`
# (it would kill the caller) and `set -euo pipefail` (it would mutate the
# caller's shell options), hence the function wrapper: `return` is legal either
# way, and failures chain through `||` instead of `set -e`.
#
# The marker is deliberately asymmetric — set on the cold path, left unset on
# the warm one — so it answers "did I just install everything?", not "has this
# run?". Its reader is scripts/tasks/setup.ts: when the marker is set, `setup`
# skips the three steps below and runs only the e2e Chromium download, which the
# preamble deliberately excludes. A warm-but-stale run does only the middle step,
# so it too leaves the marker unset: claiming it would make a following
# `mise run setup` skip two steps nothing has vouched for.
#
# `mise exec -- bun …` rather than bare `bun …` is load-bearing. mise computes a
# task's PATH from the tools installed at launch; on a fresh clone bun is not
# among them, so that PATH is stale the moment `mise install` below puts bun on
# disk. `mise exec --` re-resolves the tool from mise.toml for that one command,
# regardless of whether the user activated mise via shims or the shell hook.

caret_bootstrap() {
  local root stamp
  root="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." >/dev/null 2>&1 && pwd)" || return 1
  stamp="$root/node_modules/.caret-deps"

  # Warm: deps unpacked and bun resolvable. A checkout can still be warm and
  # wrong — a pull that adds a dependency moves bun.lock ahead of what is
  # unpacked, and the task then dies resolving a module that never landed
  # (EXC-1064) — so the warm path asks a second question before returning.
  if [ -d "$root/node_modules" ] && command -v bun >/dev/null 2>&1; then
    # The stamp is this file's own, written after each successful install; a
    # manifest newer than it means the tree may be behind. Deliberately not a
    # probe of bun's internals: a no-op `bun install` doesn't touch
    # node_modules/.bun, so a lockfile whose content changed without changing
    # the on-disk tree would keep that guard permanently stale. Deciding is all
    # this does — `bun install` is the authority on what is actually missing,
    # it is idempotent, and a no-op run costs milliseconds. The two `-nt` tests
    # are builtins, so the common case stays as cheap and as silent as before.
    #
    # Stamped only on success, so a failed install leaves the guard armed and
    # the next task retries rather than declaring the tree current.
    if [ "$root/bun.lock" -nt "$stamp" ] || [ "$root/package.json" -nt "$stamp" ]; then
      (
        cd "$root" || exit 1
        mise exec -- bun install
      ) >&2 </dev/null || return 1
      : >"$stamp"
    fi
    return 0
  fi

  # Cold. Subshell so a sourced preamble never moves the caller's cwd; `&&`
  # aborts on the first failure. These mirror the first three steps of
  # `mise run setup`; Chromium is deliberately excluded — the tasks CLI doesn't
  # need it, and downloading a browser on every fresh clone isn't this job.
  #
  # stdout goes to stderr: install chatter is a diagnostic, and the forwarders
  # for `preflight`, `release` and `caret` all treat their stdout as a
  # machine-readable channel that a first-run install must not pollute.
  #
  # stdin is the mirror image: `.mise/tasks/caret` documents
  # `mise run caret review < payload.json`, so on a fresh clone this subshell
  # sits between that payload and its reader. /dev/null keeps a first-run
  # installer from eating bytes the task itself is waiting for.
  (
    cd "$root" || exit 1
    mise install &&
      mise exec -- bun install &&
      mise exec -- bun ui/generate-palette-css.ts
  ) >&2 </dev/null || return 1

  : >"$stamp"
  export CARET_BOOTSTRAPPED=1
}

caret_bootstrap

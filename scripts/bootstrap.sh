#!/usr/bin/env bash
#
# Dep-free bootstrap preamble (EXC-932). A .mise/tasks/ forwarder sources it
# before it reaches bun:
#
#   source "$(dirname "${BASH_SOURCE[0]}")/../../scripts/bootstrap.sh" || exit 1
#
# The `|| exit 1` is part of the contract, not decoration: a failed cold install
# returns non-zero here, and the `exec bun …` that follows would otherwise die
# on a bare command-not-found instead of the real error.
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
# run?". EXC-934 is its reader: a `setup` that already installed via the
# preamble can skip those steps. Nothing reads it yet.
#
# `mise exec -- bun …` rather than bare `bun …` is load-bearing. mise computes a
# task's PATH from the tools installed at launch; on a fresh clone bun is not
# among them, so that PATH is stale the moment `mise install` below puts bun on
# disk. `mise exec --` re-resolves the tool from mise.toml for that one command,
# regardless of whether the user activated mise via shims or the shell hook.

caret_bootstrap() {
  local root
  root="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." >/dev/null 2>&1 && pwd)" || return 1

  # Warm: deps unpacked and bun resolvable — the test itself is two builtins.
  # Lockfile staleness stays `mise run setup`'s job, not the preamble's.
  if [ -d "$root/node_modules" ] && command -v bun >/dev/null 2>&1; then
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

  export CARET_BOOTSTRAPPED=1
}

caret_bootstrap

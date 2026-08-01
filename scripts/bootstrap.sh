#!/usr/bin/env bash
#
# Dep-free bootstrap preamble (EXC-932). Every file task in .mise/tasks/ is a
# one-line forwarder into scripts/tasks/cli.ts, which imports its CLI framework
# and every task module at load time — so on a fresh clone the process dies
# during module resolution, before any task code runs, and `mise run setup`
# cannot fix the very state it exists to fix. This file is what a forwarder
# sources first, so it must stay pure bash: no imports, no runtime, no deps.
#
# SOURCED, NOT EXECUTED. The CARET_BOOTSTRAPPED marker only reaches the
# forwarder if this runs in the forwarder's own shell; an executed subprocess
# would export it into a process that immediately dies. That rules out `exit`
# (it would kill the caller) and `set -euo pipefail` (it would mutate the
# caller's shell options), hence the function wrapper: `return` is legal either
# way, and failures chain through `||` instead of `set -e`.
#
# `mise exec -- bun …` rather than bare `bun …` is load-bearing. mise computes a
# task's PATH from the tools installed at launch; on a fresh clone bun is not
# among them, so that PATH is stale the moment `mise install` below puts bun on
# disk. `mise exec --` re-resolves the tool from mise.toml for that one command,
# regardless of whether the user activated mise via shims or the shell hook.

caret_bootstrap() {
  local root
  root="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." >/dev/null 2>&1 && pwd)" || return 1

  # Warm: deps unpacked and bun resolvable. A stat plus a builtin — no forks.
  # Lockfile staleness stays `mise run setup`'s job, not the preamble's.
  if [ -d "$root/node_modules" ] && command -v bun >/dev/null 2>&1; then
    return 0
  fi

  # Cold. Subshell so a sourced preamble never moves the caller's cwd; `&&`
  # aborts on the first failure. These mirror the first three steps of
  # `mise run setup`; Chromium is deliberately excluded — the tasks CLI doesn't
  # need it, and downloading a browser on every fresh clone isn't this job.
  (
    cd "$root" || exit 1
    mise install &&
      mise exec -- bun install &&
      mise exec -- bun ui/generate-palette-css.ts
  ) || return 1

  export CARET_BOOTSTRAPPED=1
}

caret_bootstrap

#!/usr/bin/env bash
#
# caret installer — registers the *published* caret with your coding agent(s):
# Claude Code (its native plugin marketplace, so you never need
# `claude --plugin-dir`) and/or OpenCode (its `plugin` array). It installs
# prebuilt artifacts — no `git clone`, no compile step.
#
#   curl -fsSL https://raw.githubusercontent.com/macintacos/caret/trunk/scripts/install.sh | bash
#
# Claude Code gets the published plugin from the `macintacos/caret` marketplace;
# OpenCode gets the published `@macintacos/caret` npm package (added to its
# `plugin` array, with the `/caret:*` command files) via `bunx`. Requires `bun`
# (https://bun.sh) on your PATH — caret runs from a `bun` bundle, and the
# OpenCode step runs the published package through `bunx`; plus
# `claude` (https://claude.com/claude-code) for the Claude Code target.
#
# It detects which agent(s) you have and, when both are present, prompts (on a
# TTY) or installs into both. Set CARET_AGENTS=claude or CARET_AGENTS=claude,opencode
# to choose non-interactively. Re-run any time to update — Claude re-pulls the
# latest published plugin and `bunx @macintacos/caret@latest` re-resolves the
# newest OpenCode package.
#
# Set CARET_DRY_RUN=1 to preview without changing anything: it runs the same
# read-only detection, then prints the exact commands it would run. As an env
# var it survives the piped `curl … | CARET_DRY_RUN=1 bash`.
#
# Pass --from-local for the dev loop (what `mise run build --install` calls): it
# builds nothing — it REUSES the already-built bin/caret-native + bin/ui from the
# checkout it runs in, installs THAT local build into Claude Code via a private
# dev marketplace (symlinked to the checkout) and into OpenCode via the freshly
# built binary, then prewarms so the fresh build takes over the daemon via
# `caret prewarm`. The takeover retires a current-build daemon; a long-running
# legacy daemon (no /api/retire, no lock) can't be retired and keeps serving
# until it idle-exits — restart it manually (kill its pid) once to migrate.
# Requires `git`. Dev only — it mutates your Claude plugin state and daemon, so
# it is not for the piped curl install. CARET_DRY_RUN=1 previews it too.
#
# STRUCTURE: everything below is functions, invoked by main() at the very bottom
# — but only when this file is executed (directly or via `curl | bash`), not when
# it is sourced. scripts/install-lib.test.sh sources it to unit-test the helpers.

set -euo pipefail

# --- constants --------------------------------------------------------------
MARKETPLACE="caret" # the registered marketplace + plugin name (caret@caret)
PLUGIN="caret"
PACKAGE="@macintacos/caret"        # the published npm package (OpenCode target, via bunx)
MARKETPLACE_SRC="macintacos/caret" # the public marketplace source (Claude target)

# --- mutable state (safe defaults so the file is sourceable for unit tests) --
# main() re-derives DRY_RUN / FANCY / the targets from the environment; these
# defaults just keep every helper safe to call under `set -u` after a bare source.
DRY_RUN=0
FROM_LOCAL=0
FANCY=0
WANT_CLAUDE=0
WANT_OPENCODE=0
REPO_DIR=""
REF_DESC=""
VERSION=""
PLAN=()
SPIN_PID=""
SPIN_LABEL=""
C_RESET='' C_BLUE='' C_GREEN='' C_RED='' C_DIM='' C_BOLD=''

# ============================================================================
# Presentation + execution library
# Generic, install-agnostic helpers: colored output, the print-or-execute run()
# chokepoint, and the animated step runner. Kept together so they read as a unit.
# ============================================================================

# Enable color + glyphs only on an interactive terminal with NO_COLOR unset.
# Anywhere else (a pipe, CI, `| cat`) FANCY stays 0 and every helper degrades to
# a plain line with no escape codes.
setup_colors() {
  if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then FANCY=1; else FANCY=0; fi
  if [ "$FANCY" -eq 1 ]; then
    C_RESET=$'\033[0m'
    C_BLUE=$'\033[1;34m'
    C_GREEN=$'\033[0;32m'
    C_RED=$'\033[1;31m'
    C_DIM=$'\033[2m'
    C_BOLD=$'\033[1m'
  else
    C_RESET='' C_BLUE='' C_GREEN='' C_RED='' C_DIM='' C_BOLD=''
  fi
}

info() { printf '%s==>%s %s\n' "$C_BLUE" "$C_RESET" "$1"; }
err() { printf '%serror:%s %s\n' "$C_RED" "$C_RESET" "$1" >&2; }

# A section header. Silent in dry-run — the plan summary speaks for that mode.
section() {
  if [ "$DRY_RUN" -eq 1 ]; then return 0; fi
  printf '\n%s%s%s\n' "$C_BOLD" "$1" "$C_RESET"
}

# Per-step result glyphs: ✓ done, ✗ failed. The in-progress "→ …" line and the
# spinner are owned by step(); ok()/fail_step() just render the settled line.
# All silent in dry-run — the plan summary speaks for that mode.
ok() {
  if [ "$DRY_RUN" -eq 1 ]; then return 0; fi
  printf '  %s✓%s %s\n' "$C_GREEN" "$C_RESET" "$1"
}
fail_step() {
  if [ "$DRY_RUN" -eq 1 ]; then return 0; fi
  printf '  %s✗%s %s\n' "$C_RED" "$C_RESET" "$1"
}

require() {
  command -v "$1" >/dev/null 2>&1 || {
    err "missing \`$1\` — $2"
    exit 1
  }
}

# Every mutating command goes through run(): in dry-run it is recorded (quoted)
# into PLAN and not executed; otherwise it runs under `set -euo pipefail`. One
# chokepoint means the dry-run preview IS the real command list — it can't drift.
quote() {
  local q
  q="$(printf '%q ' "$@")"
  printf '%s' "${q% }"
}
run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    PLAN+=("$(quote "$@")")
    return 0
  fi
  "$@"
}

# Reap the spinner and restore the cursor on every exit path (EXIT/INT trap,
# installed by main()).
cleanup() {
  if [ -n "$SPIN_PID" ]; then
    kill "$SPIN_PID" 2>/dev/null || true
    wait "$SPIN_PID" 2>/dev/null || true
    SPIN_PID=""
  fi
  if [ "$FANCY" -eq 1 ]; then printf '\033[?25h'; fi
}

spinner() {
  # Braille dots as an array so each frame is one whole glyph regardless of
  # locale (a multibyte ${str:i:1} substring would slice bytes, not characters).
  local frames=(⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏) i=0 n=10
  printf '\033[?25l' # hide cursor while we animate
  while :; do
    # Bright spinner, dimmed label — so the bright ✓ of a settled step stands
    # out against the steps still in flight.
    printf '\r  %s%s%s %s%s%s' "$C_BLUE" "${frames[i]}" "$C_RESET" "$C_DIM" "$SPIN_LABEL" "$C_RESET"
    i=$(((i + 1) % n))
    sleep 0.08
  done
}

# step LABEL BODY…  — render BODY as one animated step. BODY is a run()-wrapped
# command, a small body function that chains its run() calls with && / || (so its
# exit status is "failed iff a non-best-effort command failed" — set -e is
# suppressed inside an if-tested function, so the chaining, not set -e, drives the
# abort), or `:` for an informational step with no command of its own. On a TTY a
# braille spinner animates while BODY runs, collapsing to a green ✓ on success or
# a red ✗ + the captured output on failure; elsewhere a plain "→ …" line. Output
# is captured and shown only on failure, so a clean run is a quiet ✓ column. In
# dry-run step() just runs BODY (to record the plan) and draws nothing.
step() {
  local label="$1"
  shift
  if [ "$DRY_RUN" -eq 1 ]; then
    "$@"
    return 0
  fi
  local log rc=0
  log="$(mktemp)"
  if [ "$FANCY" -eq 1 ]; then
    SPIN_LABEL="$label"
    spinner &
    SPIN_PID=$!
    if "$@" >"$log" 2>&1; then rc=0; else rc=$?; fi
    kill "$SPIN_PID" 2>/dev/null || true
    wait "$SPIN_PID" 2>/dev/null || true
    SPIN_PID=""
    printf '\r\033[K'  # clear the spinner line
    printf '\033[?25h' # restore the cursor
  else
    printf '  %s→%s %s\n' "$C_BLUE" "$C_RESET" "$label"
    if "$@" >"$log" 2>&1; then rc=0; else rc=$?; fi
  fi
  if [ "$rc" -eq 0 ]; then
    ok "$label"
  else
    fail_step "$label"
    cat "$log" >&2
  fi
  rm -f "$log"
  return "$rc"
}

# The dry-run summary: the source, the exact commands that would run, and an
# explicit "nothing changed" closer. Drawn with a left bar so it needs no
# right-edge width math, and it reads fine plain (no color) too.
print_plan() {
  local i=1 cmd
  printf '\n%s┌─ DRY RUN ─ caret installer%s\n' "$C_BOLD" "$C_RESET"
  printf '%s│%s\n' "$C_DIM" "$C_RESET"
  if [ "$FROM_LOCAL" -eq 1 ]; then
    printf '%s│%s  Source   local checkout at %s\n' "$C_DIM" "$C_RESET" "$REPO_DIR"
    printf '%s│%s           reuse the freshly-built bin/caret-native + bin/ui (%s) — no rebuild, then prewarm the daemon\n' \
      "$C_DIM" "$C_RESET" "$REF_DESC"
  else
    printf '%s│%s  Source   published caret — the Claude Code plugin marketplace + the %s npm package (no clone, no build)\n' \
      "$C_DIM" "$C_RESET" "$PACKAGE"
  fi
  printf '%s│%s\n' "$C_DIM" "$C_RESET"
  printf '%s│%s  Would run, in order:\n' "$C_DIM" "$C_RESET"
  if [ "${#PLAN[@]}" -gt 0 ]; then
    for cmd in "${PLAN[@]}"; do
      printf '%s│%s    %2d  %s\n' "$C_DIM" "$C_RESET" "$i" "$cmd"
      i=$((i + 1))
    done
  fi
  printf '%s│%s\n' "$C_DIM" "$C_RESET"
  printf '%s└─%s dry run complete — nothing was changed.\n' "$C_BOLD" "$C_RESET"
}

# ============================================================================
# Install-specific helpers
# ============================================================================

# --from-local is the only supported flag; anything else is a hard error.
parse_args() {
  local arg
  for arg in "$@"; do
    case "$arg" in
    --from-local) FROM_LOCAL=1 ;;
    *)
      err "unknown argument: $arg (the only supported flag is --from-local)"
      exit 1
      ;;
    esac
  done
}

# caret installs into Claude Code and/or OpenCode. Detect which agent each
# machine has, then choose targets: CARET_AGENTS (comma list, e.g. "claude" or
# "claude,opencode") overrides; else with both present, prompt on a TTY and
# otherwise install into both; with one present, use it; with neither, default to
# Claude for back-compat. `claude` is required only when Claude is a target.
select_targets() {
  local have_claude=0 have_opencode=0 reply=""
  command -v claude >/dev/null 2>&1 && have_claude=1
  if command -v opencode >/dev/null 2>&1 || [ -d "${XDG_CONFIG_HOME:-$HOME/.config}/opencode" ]; then
    have_opencode=1
  fi
  if [ -n "${CARET_AGENTS:-}" ]; then
    case ",$CARET_AGENTS," in *,claude,*) WANT_CLAUDE=1 ;; esac
    case ",$CARET_AGENTS," in *,opencode,*) WANT_OPENCODE=1 ;; esac
  elif [ "$have_claude" -eq 1 ] && [ "$have_opencode" -eq 1 ]; then
    if [ -t 0 ] && [ "$DRY_RUN" -eq 0 ]; then
      printf 'Both Claude Code and OpenCode detected. Install caret into which? [both/claude/opencode] (both): '
      read -r reply </dev/tty 2>/dev/null || reply=""
      case "$reply" in
      claude) WANT_CLAUDE=1 ;;
      opencode) WANT_OPENCODE=1 ;;
      *)
        WANT_CLAUDE=1
        WANT_OPENCODE=1
        ;;
      esac
    else
      WANT_CLAUDE=1
      WANT_OPENCODE=1
    fi
  else
    WANT_CLAUDE="$have_claude"
    WANT_OPENCODE="$have_opencode"
  fi
  # Neither detected (or CARET_AGENTS matched nothing): default to Claude.
  if [ "$WANT_CLAUDE" -eq 0 ] && [ "$WANT_OPENCODE" -eq 0 ]; then
    WANT_CLAUDE=1
  fi
  if [ "$WANT_CLAUDE" -eq 1 ]; then
    require claude "install Claude Code (https://claude.com/claude-code), then re-run"
  fi
}

# Register a Claude plugin marketplace by SOURCE (a public `owner/repo` or a local
# dev-marketplace dir), idempotently: add, else fall back to updating the existing
# `caret` marketplace. The add's "already on disk" chatter is hidden so a re-run
# stays clean; a real add failure falls through to the visible-stderr update,
# whose failure (no `|| true`) aborts the step.
register_marketplace_from() {
  run claude plugin marketplace add "$1" >/dev/null 2>&1 ||
    run claude plugin marketplace update "$MARKETPLACE" >/dev/null
}

# --from-local only: generate a private dev marketplace whose plugin source
# symlinks to the checkout (make-dev-marketplace.sh owns the generation so the
# whole step stays one run()-tracked command in the dry-run plan), then register
# it. This is what makes the local build — not the published package — install.
register_dev_marketplace() {
  run bash "$REPO_DIR/scripts/make-dev-marketplace.sh" "$REPO_DIR" "$1" &&
    register_marketplace_from "$1"
}

# Reinstall so the latest plugin always lands in the cache, even when the version
# is unchanged. uninstall/enable are best-effort (|| true); install is the only
# fatal command, so the step fails iff install fails. Shared by both install
# paths — only the marketplace SOURCE differs (public vs the private dev dir).
install_claude_plugin() {
  run claude plugin uninstall "${PLUGIN}@${MARKETPLACE}" >/dev/null 2>&1 || true
  run claude plugin install "${PLUGIN}@${MARKETPLACE}" --scope user >/dev/null &&
    { run claude plugin enable "${PLUGIN}@${MARKETPLACE}" >/dev/null 2>&1 || true; }
}

# --from-local only: prewarm so the fresh build takes over the daemon (EXC-555).
# The just-built `caret prewarm` runs ensureDaemon, whose build fingerprint
# differs from the running daemon's, so its same-world/state-dir-gated takeover
# retires the old daemon and spawns this build — no explicit "kill the daemon"
# step. Best-effort in two ways: `|| true` keeps a hiccup from aborting the
# install, and ensureDaemon REUSES (does not retire) a daemon it can't step down —
# a legacy build with no /api/retire endpoint and no lock file — which then keeps
# serving until it idle-exits. It can't report which path it took, so the step
# does NOT claim the swap is done; it reports only that prewarm ran.
prewarm_daemon() { run ./bin/caret-native prewarm >/dev/null 2>&1 || true; }

# --from-local only: resolve the caret checkout this script lives in (detected by
# its marketplace manifest, via the script's own on-disk path — not the cwd) into
# REPO_DIR / REF_DESC, or exit with guidance.
resolve_local_checkout() {
  local src candidate
  src="${BASH_SOURCE[0]:-}"
  REPO_DIR=""
  if [ -n "$src" ] && [ -f "$src" ]; then
    candidate="$(cd "$(dirname "$src")/.." 2>/dev/null && pwd || true)"
    if [ -n "$candidate" ] && [ -f "$candidate/.claude-plugin/marketplace.json" ]; then
      REPO_DIR="$candidate"
    fi
  fi
  if [ -z "$REPO_DIR" ]; then
    err "--from-local must run from inside a caret checkout (no .claude-plugin/marketplace.json found)"
    exit 1
  fi
  REF_DESC="$(git -C "$REPO_DIR" describe --tags --always --dirty 2>/dev/null || echo 'unknown ref')"
}

# The dev loop (what `mise run build --install` runs). Build nothing: reuse the
# artifacts `mise run build` just produced and install THIS checkout — into Claude
# via a private dev marketplace symlinked to the checkout, into OpenCode via the
# freshly built binary — then cycle the daemon.
run_dev_install() {
  require git "install git, then re-run"
  resolve_local_checkout
  VERSION="$REF_DESC"

  section "Installing caret $VERSION"
  step "Reusing the freshly built checkout at $REPO_DIR ($REF_DESC) — no rebuild" :
  run cd "$REPO_DIR"
  # Reuse mode (EXC-555): `mise run build` already produced the artifacts;
  # --from-local does NOT rebuild. Assert they exist rather than silently
  # rebuilding — a missing artifact is a misuse, not a fallback.
  if [ "$DRY_RUN" -eq 0 ] && { [ ! -x bin/caret-native ] || [ ! -d bin/ui ]; }; then
    err "--from-local needs the build artifacts bin/caret-native + bin/ui — run \`mise run build\` first"
    exit 1
  fi

  if [ "$WANT_CLAUDE" -eq 1 ]; then
    local dev_marketplace="${XDG_STATE_HOME:-$HOME/.local/state}/caret/dev-marketplace"
    step "Registering the caret marketplace" register_dev_marketplace "$dev_marketplace"
    step "Installing the caret plugin" install_claude_plugin
  fi

  # OpenCode: add the array entry + command files via the freshly built binary's
  # own tested subcommand (the config/JSON logic lives in TS, not bash). It acquires
  # rumdl too, so there is no separate rumdl step.
  if [ "$WANT_OPENCODE" -eq 1 ]; then
    step "Installing caret into OpenCode (plugin array + commands, plus rumdl)" \
      run "$REPO_DIR/bin/caret" install --target opencode
  fi

  step "Prewarming the fresh build's daemon" prewarm_daemon
}

# The version `@latest` resolves to on the registry — for display only. Best-effort:
# one read-only lookup, falling back to the literal "latest" when curl is missing or
# offline. Never fatal, never blocks the install (the `@latest` install is unchanged).
resolve_published_version() {
  local encoded="${PACKAGE//\//%2F}" v=""
  if command -v curl >/dev/null 2>&1; then
    v="$(curl -fsSL --max-time 5 "https://registry.npmjs.org/-/package/${encoded}/dist-tags" 2>/dev/null |
      grep -o '"latest":"[^"]*"' | head -1 | cut -d'"' -f4)"
  fi
  printf '%s' "${v:-latest}"
}

# The end-user install (the curl one-liner). No clone, no compile: register the
# public plugin with Claude Code and hand OpenCode the published package. `bun` is
# needed for the OpenCode step (bunx) and to run the caret bundle at hook time.
run_user_install() {
  if [ "$WANT_OPENCODE" -eq 1 ]; then
    require bun "install Bun from https://bun.sh, then re-run"
  fi

  # Skip the registry lookup in dry-run — the section is silent and print_plan,
  # not the version banner, speaks for that mode; no reason to touch the network.
  if [ "$DRY_RUN" -eq 0 ]; then VERSION="$(resolve_published_version)"; fi
  section "Installing caret $VERSION"

  if [ "$WANT_CLAUDE" -eq 1 ]; then
    # The CLI form of the README's `/plugin marketplace add macintacos/caret` +
    # `/plugin install caret@caret`.
    step "Registering the caret marketplace" register_marketplace_from "$MARKETPLACE_SRC"
    step "Installing the caret plugin" install_claude_plugin
  fi

  # OpenCode: run the published package's tested installer via bunx — it adds the
  # `@macintacos/caret` array entry and drops the `/caret:*` command files.
  # `--no-cache` forces bunx to re-resolve `@latest` against the registry rather
  # than a stale cached manifest: a manifest cached before 0.4.0 resolves to a
  # version with no `bin`, so bunx fails with "could not determine executable to
  # run for package @macintacos/caret".
  # It also acquires rumdl (the plan formatter) — `caret install` always does — which is
  # why there is no separate rumdl step. A Claude-only install never runs the caret CLI
  # (it drives `claude plugin` directly, so it needs no bun), and the daemon downloads
  # rumdl on the first plan regardless, so that path pays the download then. (EXC-828)
  if [ "$WANT_OPENCODE" -eq 1 ]; then
    step "Installing caret into OpenCode (plugin array + commands, plus rumdl)" \
      run bunx --no-cache "${PACKAGE}@latest" install --target opencode
  fi
}

print_summary() {
  echo
  if [ "$WANT_CLAUDE" -eq 1 ] && [ "$WANT_OPENCODE" -eq 1 ]; then
    info "caret $VERSION installed for Claude Code + OpenCode. Restart each, then try /caret:demo."
  elif [ "$WANT_OPENCODE" -eq 1 ]; then
    info "caret $VERSION installed for OpenCode. Restart OpenCode, then try /caret:demo."
  else
    info "caret $VERSION installed for Claude Code. Restart Claude Code (or run /reload-plugins), then try /caret:demo."
  fi
}

main() {
  # DRY_RUN is an env var, not a flag, so it survives a piped
  # `curl … | CARET_DRY_RUN=1 bash` (no `bash -s --` needed).
  [ "${CARET_DRY_RUN:-0}" = "1" ] && DRY_RUN=1
  setup_colors
  parse_args "$@"
  trap cleanup EXIT
  trap 'cleanup; exit 130' INT

  # bun is only needed to build/run; --from-local reuses the artifacts and never
  # invokes bun, so it must not require it (EXC-555). The user path requires bun
  # only for the OpenCode step (inside run_user_install).
  select_targets

  if [ "$FROM_LOCAL" -eq 1 ]; then
    run_dev_install
  else
    run_user_install
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    print_plan
  else
    print_summary
  fi
}

# Run main only when executed (directly or via `curl | bash`), not when sourced.
# `return` succeeds solely in a sourced context, so a failing return means
# "executed" — this is robust for the piped install, where `${BASH_SOURCE[0]}` is
# unset and a `$0`-based guard would wrongly skip. Unit tests source this file to
# exercise the helpers above without running main.
if ! (return 0 2>/dev/null); then
  main "$@"
fi

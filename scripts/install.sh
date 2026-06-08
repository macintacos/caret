#!/usr/bin/env bash
#
# caret installer — builds caret on your machine and registers it with Claude
# Code through the native plugin system, so you never need `claude --plugin-dir`.
#
#   curl -fsSL https://raw.githubusercontent.com/macintacos/caret/trunk/scripts/install.sh | bash
#
# It clones caret at its latest release tag (vX.Y.Z) — no manual `git clone`
# needed — builds the platform-specific binary, and installs it as a plugin.
# Re-run any time to update — it fetches the latest release, rebuilds, and
# reinstalls. Requires `git`, `bun` (https://bun.sh), and `claude`.
#
# Set CARET_DRY_RUN=1 to preview without changing anything: it runs the same
# read-only detection, then prints the exact commands it would run. As an env
# var it survives the piped `curl … | CARET_DRY_RUN=1 bash`.
#
# Pass --from-local for the dev loop (what `mise run build --install` calls):
# it forces local-checkout mode and REUSES the already-built bin/caret + bin/ui
# instead of rebuilding, reinstalls the plugin, then cycles the daemon to the
# fresh build via `caret prewarm`. Dev only — it mutates your Claude plugin
# state and daemon, so it is not for the piped curl install. CARET_DRY_RUN=1
# previews it like any other run.

set -euo pipefail

REPO_URL="https://github.com/macintacos/caret.git"
MARKETPLACE="caret"
PLUGIN="caret"

# Dry-run is an env var, not a flag, so it survives a piped
# `curl … | CARET_DRY_RUN=1 bash` (no `bash -s --` needed).
DRY_RUN=0
if [ "${CARET_DRY_RUN:-0}" = "1" ]; then DRY_RUN=1; fi

# Parse --from-local (EXC-555; the header comment documents what it does). It is
# the only supported flag, so anything else is a hard error. err() isn't defined
# yet at this point, so this uses a raw stderr printf.
FROM_LOCAL=0
for arg in "$@"; do
  case "$arg" in
  --from-local) FROM_LOCAL=1 ;;
  *)
    printf 'error: unknown argument: %s (the only supported flag is --from-local)\n' "$arg" >&2
    exit 1
    ;;
  esac
done

# --- presentation -----------------------------------------------------------
# Color and glyphs only on an interactive terminal with NO_COLOR unset. Anywhere
# else (a pipe, CI, `| cat`) FANCY stays 0 and every helper degrades to a plain
# line with no escape codes.
FANCY=0
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then FANCY=1; fi

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

info() { printf '%s==>%s %s\n' "$C_BLUE" "$C_RESET" "$1"; }
err() { printf '%serror:%s %s\n' "$C_RED" "$C_RESET" "$1" >&2; }

# A section header. Silent in dry-run — the plan summary speaks for that mode.
section() {
  if [ "$DRY_RUN" -eq 1 ]; then return 0; fi
  printf '\n%s%s%s\n' "$C_BOLD" "$1" "$C_RESET"
}

# Per-step glyphs: → starting, ✓ done. STEP_LABEL lets ok() restate the label
# without the caller repeating it. Both are silent in dry-run.
STEP_LABEL=""
step() {
  STEP_LABEL="$1"
  if [ "$DRY_RUN" -eq 1 ]; then return 0; fi
  printf '  %s→%s %s\n' "$C_BLUE" "$C_RESET" "$1"
}
ok() {
  if [ "$DRY_RUN" -eq 1 ]; then return 0; fi
  printf '  %s✓%s %s\n' "$C_GREEN" "$C_RESET" "${1:-$STEP_LABEL}"
}
fail_step() {
  if [ "$DRY_RUN" -eq 1 ]; then return 0; fi
  printf '  %s✗%s %s\n' "$C_RED" "$C_RESET" "${1:-$STEP_LABEL}"
}

require() {
  command -v "$1" >/dev/null 2>&1 || {
    err "missing \`$1\` — $2"
    exit 1
  }
}

# --- print-or-execute -------------------------------------------------------
# Every mutating command goes through run(): in dry-run it is recorded (quoted)
# into PLAN and not executed; otherwise it runs under `set -euo pipefail`. One
# chokepoint means the dry-run preview IS the real command list — it can't drift.
PLAN=()
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

# --- spinner-wrapped long steps ---------------------------------------------
# Long steps (dependency install, the two builds) get a spinner on a TTY and a
# plain "→ …" line otherwise. Their output is captured and shown only on
# failure, so a success collapses to a quiet ✓ while a failure stays legible.
# Safe under `set -euo pipefail`: the command runs inside an `if` (a failure is
# caught, not aborted mid-helper), the real exit code is returned to the caller,
# and the EXIT/INT trap restores the cursor and reaps the spinner on every path.
SPIN_PID=""
SPIN_LABEL=""
cleanup() {
  if [ -n "$SPIN_PID" ]; then
    kill "$SPIN_PID" 2>/dev/null || true
    wait "$SPIN_PID" 2>/dev/null || true
    SPIN_PID=""
  fi
  if [ "$FANCY" -eq 1 ]; then printf '\033[?25h'; fi
}
trap cleanup EXIT
trap 'cleanup; exit 130' INT

spinner() {
  local frames='\|/-' i=0
  printf '\033[?25l' # hide cursor while we animate
  while :; do
    i=$(((i + 1) % 4))
    printf '\r  %s%s%s %s' "$C_BLUE" "${frames:i:1}" "$C_RESET" "$SPIN_LABEL"
    sleep 0.1
  done
}

run_long() {
  local label="$1"
  shift
  if [ "$DRY_RUN" -eq 1 ]; then
    run "$@"
    return 0
  fi
  STEP_LABEL="$label"
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

# The dry-run summary: what was detected, the exact commands that would run, and
# an explicit "nothing changed" closer. Drawn with a left bar so it needs no
# right-edge width math, and it reads fine plain (no color) too.
print_plan() {
  local i=1 cmd
  printf '\n%s┌─ DRY RUN ─ caret installer%s\n' "$C_BOLD" "$C_RESET"
  printf '%s│%s\n' "$C_DIM" "$C_RESET"
  if [ "$SRC_KIND" = "local" ]; then
    printf '%s│%s  Source   local checkout at %s\n' "$C_DIM" "$C_RESET" "$REPO_DIR"
    if [ "$FROM_LOCAL" -eq 1 ]; then
      printf '%s│%s           reuse the freshly-built bin/caret + bin/ui (%s) — no rebuild, then cycle the daemon\n' \
        "$C_DIM" "$C_RESET" "$REF_DESC"
    else
      printf '%s│%s           build the current ref (%s) in place — no tag lookup, no clone\n' \
        "$C_DIM" "$C_RESET" "$REF_DESC"
    fi
  else
    printf '%s│%s  Source   caret release %s\n' "$C_DIM" "$C_RESET" "$TAG"
    if [ "$SRC_ACTION" = "update" ]; then
      printf '%s│%s           fast-forward the existing checkout at %s\n' "$C_DIM" "$C_RESET" "$REPO_DIR"
    else
      printf '%s│%s           clone fresh into %s\n' "$C_DIM" "$C_RESET" "$REPO_DIR"
    fi
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

# --- preflight (read-only) --------------------------------------------------
# Runs in dry-run too: a missing tool hard-fails here exactly as in a real run.
require git "install git, then re-run"
# bun is only needed to build; --from-local reuses the artifacts and never
# invokes bun, so it must not require it (EXC-555).
if [ "$FROM_LOCAL" -eq 0 ]; then
  require bun "install Bun from https://bun.sh, then re-run"
fi
require claude "install Claude Code (https://claude.com/claude-code), then re-run"

# Latest published release tag (vX.Y.Z), newest first — mirrors the sort used by
# the release tooling in scripts/release/git.ts.
latest_release_tag() {
  local out ref
  # Distinguish "couldn't reach the remote" from "remote has no release tags":
  # ls-remote exits non-zero only on the former; an empty result is the latter.
  if ! out="$(git ls-remote --tags --refs --sort=-v:refname "$REPO_URL" 'v*.*.*' 2>/dev/null)"; then
    err "could not reach $REPO_URL to list release tags — check your connection and re-run"
    exit 1
  fi
  ref="${out%%$'\n'*}"     # first line: "<sha>\trefs/tags/vX.Y.Z"
  printf '%s' "${ref##*/}" # strip through the last slash -> "vX.Y.Z"
}

# --- source resolution (read-only) ------------------------------------------
# If this script is being run from a file inside an existing caret checkout
# (dev, or already cloned), build that checkout in place. Otherwise resolve the
# latest release and clone (or fast-forward) into a stable data directory. This
# detection is identical in dry-run and a real run — only execution differs.
REPO_DIR=""
SRC_KIND=""
REF_DESC=""
TAG=""
SRC_ACTION=""
src="${BASH_SOURCE[0]:-}"
if [ -n "$src" ] && [ -f "$src" ]; then
  candidate="$(cd "$(dirname "$src")/.." 2>/dev/null && pwd || true)"
  if [ -n "$candidate" ] && [ -f "$candidate/.claude-plugin/marketplace.json" ]; then
    REPO_DIR="$candidate"
    SRC_KIND="local"
    REF_DESC="$(git -C "$REPO_DIR" describe --tags --always --dirty 2>/dev/null || echo 'unknown ref')"
  fi
fi
if [ "$FROM_LOCAL" -eq 1 ]; then
  # --from-local never fetches or clones: it builds nothing and reuses the
  # checkout it is run from. Require that local detection above succeeded.
  if [ "$SRC_KIND" != "local" ]; then
    err "--from-local must run from inside a caret checkout (no .claude-plugin/marketplace.json found)"
    exit 1
  fi
elif [ -z "$REPO_DIR" ]; then
  SRC_KIND="release"
  REPO_DIR="${CARET_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/caret}"
  TAG="$(latest_release_tag)"
  if [ -z "$TAG" ]; then
    err "no caret release tags (vX.Y.Z) found at $REPO_URL — the release process may not have run yet"
    exit 1
  fi
  if [ -d "$REPO_DIR/.git" ]; then
    SRC_ACTION="update"
  else
    SRC_ACTION="clone"
  fi
fi

# --- fetch / source ---------------------------------------------------------
# The network steps go through run_long, so git's transfer chatter (the remote:
# counting lines, "Unpacking objects", the ref-update summary) is captured and
# shown only on failure — a clean fetch collapses to a quiet ✓, like the builds.
if [ "$SRC_KIND" = "local" ]; then
  section "Source"
  if [ "$FROM_LOCAL" -eq 1 ]; then
    step "Reusing the freshly built checkout at $REPO_DIR ($REF_DESC) — no rebuild"
  else
    step "Building the local checkout at $REPO_DIR ($REF_DESC) in place"
  fi
  ok
else
  section "Fetch"
  if [ "$SRC_ACTION" = "update" ]; then
    # fetch + checkout as one step so the ✓ prints only after both succeed. The
    # checkout is already --quiet; the fetch is the noisy half run_long hushes.
    # shellcheck disable=SC2016  # $1/$2 are the inner `bash -c` positional args, expanded at runtime
    run_long "Updating $REPO_DIR to release $TAG" \
      bash -c 'git -C "$1" fetch --depth 1 --force origin "refs/tags/$2:refs/tags/$2" && git -C "$1" checkout --quiet --detach "$2"' _ "$REPO_DIR" "$TAG"
  else
    run_long "Cloning release $TAG into $REPO_DIR" \
      git clone --depth 1 --branch "$TAG" "$REPO_URL" "$REPO_DIR"
  fi
fi

# --- build ------------------------------------------------------------------
run cd "$REPO_DIR"

if [ "$FROM_LOCAL" -eq 1 ]; then
  # Reuse mode (EXC-555): `mise run build` (build-bin) already produced the
  # artifacts; --from-local does NOT rebuild. Assert they exist rather than
  # silently rebuilding — a missing artifact is a misuse, not a fallback.
  if [ "$DRY_RUN" -eq 0 ] && { [ ! -x bin/caret ] || [ ! -d bin/ui ]; }; then
    err "--from-local needs the build artifacts bin/caret + bin/ui — run \`mise run build\` first"
    exit 1
  fi
else
  section "Build"
  run_long "Installing build dependencies" bun install
  run_long "Building the UI" bash -c 'cd ui && bunx vite build'
  # Compile through the one build task so the flags can't drift from a local
  # `mise run build`: it generates the embed manifest from ui/dist, embeds the
  # sourcemap (readable src/*.ts stack frames), bakes the commit (EXC-452), and
  # copies the UI tree beside the binary as a fallback. Run as a plain bash script
  # so the installer needs only bun, not mise; in dry-run run_long records it
  # without executing, so its `git rev-parse` never fires in a non-checkout.
  # build-ui above leaves ui/dist in place for it.
  run_long "Compiling the caret binary" bash .mise/tasks/build-bin

  if [ "$DRY_RUN" -eq 0 ] && [ ! -x bin/caret ]; then
    err "build did not produce bin/caret"
    exit 1
  fi
fi

# --- register ---------------------------------------------------------------
section "Register"
# Register caret's directory as a local marketplace (idempotent: add, else
# update). The add's chatter — it prints an "already on disk" note to stdout
# when the marketplace exists — is hidden so a re-run stays clean; a real
# failure still aborts via the visible-stderr update fallback.
step "Registering the caret marketplace"
run claude plugin marketplace add "$REPO_DIR" >/dev/null 2>&1 || run claude plugin marketplace update "$MARKETPLACE" >/dev/null
ok

# Reinstall so the freshly built binary always lands in the plugin cache, even
# when the version is unchanged. uninstall/enable are best-effort (|| true);
# their routine noise is hidden, matching the pre-polish installer.
step "Installing the caret plugin"
run claude plugin uninstall "${PLUGIN}@${MARKETPLACE}" >/dev/null 2>&1 || true
run claude plugin install "${PLUGIN}@${MARKETPLACE}" --scope user >/dev/null
run claude plugin enable "${PLUGIN}@${MARKETPLACE}" >/dev/null 2>&1 || true
ok

# --- daemon cycle (--from-local only) ---------------------------------------
# Cycle the running daemon to the freshly-built binary (EXC-555). The just-built
# `caret prewarm` runs ensureDaemon, whose build fingerprint differs from the
# stale-build daemon's, so its same-world/state-dir-gated takeover retires the
# old daemon and spawns this build — there is no explicit "kill the daemon" step.
# Best-effort (`|| true`): a daemon hiccup must not abort an otherwise-clean
# install. Routed through run(), so CARET_DRY_RUN previews it and never performs
# a real retire/spawn.
if [ "$FROM_LOCAL" -eq 1 ]; then
  section "Daemon"
  step "Cycling the daemon to the fresh build"
  run ./bin/caret prewarm >/dev/null 2>&1 || true
  ok
fi

if [ "$DRY_RUN" -eq 1 ]; then
  print_plan
else
  echo
  info "caret installed. Restart Claude Code (or run /reload-plugins), then try /caret:demo."
fi

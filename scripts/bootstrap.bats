#!/usr/bin/env bats
#
# Hermetic tests for scripts/bootstrap.sh — the dep-free preamble a mise task
# forwarder sources before it reaches bun (EXC-932). Each case builds a throwaway
# checkout root plus a PATH holding nothing but stubs and the few real binaries
# the script and those stubs shell out to, sources the script in a fresh shell,
# and asserts on what the fake `mise` was asked to do — and where it was asked to
# do it.
#
#   mise x -- bats scripts/bootstrap.bats
#
# `run -<status>` asserts the exit code inline, which is why 1.5.0 is the floor.

bats_require_minimum_version 1.5.0

setup_file() {
  SCRIPT="$(cd "$(dirname "$BATS_TEST_FILENAME")" && pwd)/bootstrap.sh"
  BASH_BIN="$(command -v bash)"
  export SCRIPT BASH_BIN
}

# bash 3.2's `-nt` compares whole seconds, so staleness cases place their
# fixtures decades apart rather than racing a `sleep`.
OLD_MTIME=200001010000
NEW_MTIME=200001020000

touch_at() { : >"$1" && touch -t "$2" "$1"; }

# A throwaway checkout root holding just the script under test, reported as its
# physical path — the script resolves its own root with `cd -P`, and
# $BATS_TEST_TMPDIR is under the /var symlink on macOS, so a logical path would
# never compare equal to what the script computes.
make_root() {
  local root="$BATS_TEST_TMPDIR/checkout"
  mkdir -p "$root/scripts"
  cp "$SCRIPT" "$root/scripts/bootstrap.sh"
  (cd -P "$root" && pwd | tr -d '\n')
}

# A PATH holding a fake `mise` that logs its argv and cwd — plus anything it
# managed to read off stdin, which must be nothing — and optionally fails on a
# chosen subcommand ($1 is the exit code, $2 the subcommand, defaulting to
# `install` so a warm-path `mise exec -- bun install` can be failed too), plus
# the real binaries the script and this stub shell out to. The stub creates
# node_modules on `bun install` because the real thing does, and a cold run's
# stamp lands inside it. Cases run with PATH set to this alone, so a real bun on
# the developer's machine can't leak in and turn a cold case warm.
make_stub_path() {
  local stub="$BATS_TEST_TMPDIR/stub" fail_rc="${1:-0}" fail_on="${2:-install}"
  mkdir -p "$stub"
  cat >"$stub/mise" <<STUB
#!$BASH_BIN
if read -r stdin_line; then leak=" <stdin:\$stdin_line>"; else leak=""; fi
echo "\$* @ \$PWD\$leak" >>"$stub/mise.log"
[ "\$1" = $fail_on ] && exit $fail_rc
case "\$*" in "exec -- bun install") mkdir -p "\$PWD/node_modules" ;; esac
exit 0
STUB
  chmod +x "$stub/mise"
  ln -s "$(command -v dirname)" "$stub/dirname"
  ln -s "$(command -v mkdir)" "$stub/mkdir"
  printf '%s' "$stub"
}

# The same PATH plus a `bun` on it — the half of the warm test that
# `command -v bun` answers.
make_bun_stub_path() {
  local stub
  stub="$(make_stub_path "$@")"
  printf '#!%s\nexit 0\n' "$BASH_BIN" >"$stub/bun"
  chmod +x "$stub/bun"
  printf '%s' "$stub"
}

# Source the script the way a forwarder does, reporting the exported marker, the
# return code, and the caller's cwd afterwards — the preamble must leave that
# last one alone. env -i drops every inherited var, so PATH is exactly $1, and
# the `cd /` makes the cwd assertion independent of where this suite was run.
# $3 is the payload on stdin, standing in for `mise run caret review < file`.
#
# The marker is read back from a CHILD process, because export is its whole
# contract: its reader is scripts/tasks/setup.ts, a separate process, and a bare
# assignment would read back identically in the sourcing shell.
run_bootstrap() {
  # SC2016: the single quotes are the point — $1, $? and the marker must expand
  # in the inner shell that does the sourcing, not in this one.
  # shellcheck disable=SC2016
  env -i PATH="$1" "$BASH_BIN" -c '
    cd /; source "$1"; rc=$?
    echo "MARKER=$("$2" -c "echo \${CARET_BOOTSTRAPPED:-unset}") RC=$rc PWD=[$PWD]"
  ' _ "$2/scripts/bootstrap.sh" "$BASH_BIN" <<<"${3-}"
}

mise_log() { cat "$stub/mise.log"; }

@test "cold: installs everything at the root, stamps, and leaves the caller's cwd" {
  root="$(make_root)"
  stub="$(make_stub_path)"
  run -0 run_bootstrap "$stub" "$root"
  [[ "$output" == *"MARKER=1 RC=0 PWD=[/]"* ]]
  [ "$(mise_log)" = "install @ $root
exec -- bun install @ $root
exec -- bun ui/generate-palette-css.ts @ $root" ]
  [ -e "$root/node_modules/.caret-deps" ]
}

@test "cold failure: returns non-zero, marker unset, aborts before the bun steps" {
  root="$(make_root)"
  stub="$(make_stub_path 1)"
  run -0 run_bootstrap "$stub" "$root"
  [[ "$output" == *"MARKER=unset RC=1"* ]]
  [ "$(mise_log)" = "install @ $root" ]
}

@test "warm+fresh: returns 0 without the marker and never invokes mise" {
  root="$(make_root)"
  mkdir -p "$root/node_modules"
  touch_at "$root/bun.lock" "$OLD_MTIME"
  touch_at "$root/package.json" "$OLD_MTIME"
  touch_at "$root/node_modules/.caret-deps" "$NEW_MTIME"
  stub="$(make_bun_stub_path)"
  run -0 run_bootstrap "$stub" "$root"
  [[ "$output" == *"MARKER=unset RC=0"* ]]
  [ ! -e "$stub/mise.log" ]
}

# Warm needs BOTH conditions; each alone takes the cold path.
@test "node_modules without bun still takes the cold path" {
  root="$(make_root)"
  mkdir -p "$root/node_modules"
  stub="$(make_stub_path)"
  run -0 run_bootstrap "$stub" "$root"
  [[ "$output" == *"MARKER=1 RC=0"* ]]
}

@test "bun without node_modules still takes the cold path" {
  root="$(make_root)"
  stub="$(make_bun_stub_path)"
  run -0 run_bootstrap "$stub" "$root"
  [[ "$output" == *"MARKER=1 RC=0"* ]]
}

# `.mise/tasks/caret` documents `mise run caret review < payload.json`, so a
# first-run install sits between that payload and its reader — and must not
# swallow a byte of it on the way past.
@test "cold: the install steps never read the caller's stdin" {
  root="$(make_root)"
  stub="$(make_stub_path)"
  run -0 run_bootstrap "$stub" "$root" '{"kind":"review"}'
  [[ "$output" == *"MARKER=1 RC=0"* ]]
  [[ "$(mise_log)" != *"<stdin:"* ]]
}

# A warm checkout with every mtime level; the caller then moves one manifest
# ahead of the stamp.
seed_warm_stale() {
  root="$(make_root)"
  mkdir -p "$root/node_modules"
  touch_at "$root/bun.lock" "$OLD_MTIME"
  touch_at "$root/package.json" "$OLD_MTIME"
  touch_at "$root/node_modules/.caret-deps" "$OLD_MTIME"
  stub="$(make_bun_stub_path)"
}

# The ticket's state (EXC-1064): a pull moves bun.lock ahead of what is unpacked
# in node_modules, so the warm test says "installed" and the task dies resolving
# a dependency that never landed. Only `bun install` runs — the palette step and
# `mise install` stay the cold path's business. A payload goes in because this
# branch now sits between `mise run caret review < payload.json` and its reader
# far more often than the cold path ever did; a leaked byte shows up in the
# exact-equality log check.
#
# The two manifests are separate cases rather than a loop, so bats isolates them
# — the loop the .sh suite needed shared a root and a stub across both values.
@test "warm+stale (bun.lock): bun install alone at the root, then re-stamps" {
  seed_warm_stale
  touch_at "$root/bun.lock" "$NEW_MTIME"
  run -0 run_bootstrap "$stub" "$root" '{"kind":"review"}'
  [[ "$output" == *"MARKER=unset RC=0 PWD=[/]"* ]]
  [ "$(mise_log)" = "exec -- bun install @ $root" ]
  # Existence proves nothing here — the fixture back-dated a stamp to create the
  # staleness. The guard must have cleared, so the manifest is no longer ahead.
  [ ! "$root/bun.lock" -nt "$root/node_modules/.caret-deps" ]
}

@test "warm+stale (package.json): bun install alone at the root, then re-stamps" {
  seed_warm_stale
  touch_at "$root/package.json" "$NEW_MTIME"
  run -0 run_bootstrap "$stub" "$root" '{"kind":"review"}'
  [[ "$output" == *"MARKER=unset RC=0 PWD=[/]"* ]]
  [ "$(mise_log)" = "exec -- bun install @ $root" ]
  [ ! "$root/package.json" -nt "$root/node_modules/.caret-deps" ]
}

# A missing stamp is `-nt`-true, so the first task after this lands reinstalls
# once and stamps. Without that, an already-warm clone would sit un-repaired
# until some future pull happened to touch a manifest.
@test "warm+unstamped: bun install alone at the root, and it repairs itself once" {
  root="$(make_root)"
  mkdir -p "$root/node_modules"
  touch_at "$root/bun.lock" "$OLD_MTIME"
  stub="$(make_bun_stub_path)"
  run -0 run_bootstrap "$stub" "$root"
  [[ "$output" == *"MARKER=unset RC=0"* ]]
  [ "$(mise_log)" = "exec -- bun install @ $root" ]
  [ -e "$root/node_modules/.caret-deps" ]
}

@test "warm+stale failure: no stamp, so the next run retries the install" {
  root="$(make_root)"
  mkdir -p "$root/node_modules"
  touch_at "$root/bun.lock" "$NEW_MTIME"
  stub="$(make_bun_stub_path 1 exec)"
  run -0 run_bootstrap "$stub" "$root"
  [[ "$output" == *"MARKER=unset RC=1"* ]]
  [ ! -e "$root/node_modules/.caret-deps" ]
}

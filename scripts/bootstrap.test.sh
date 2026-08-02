#!/usr/bin/env bash
#
# Hermetic tests for scripts/bootstrap.sh — the dep-free preamble a mise task
# forwarder sources before it reaches bun (EXC-932). Each case builds a throwaway
# checkout root plus a PATH holding nothing but stubs and the one coreutil the
# script needs, sources the script in a fresh shell, and asserts on what the fake
# `mise` was asked to do — and where it was asked to do it.
#
#   bash scripts/bootstrap.test.sh
#
set -uo pipefail

test_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
script="$test_dir/bootstrap.sh"
bash_bin="$(command -v bash)"

fails=0
ok() { printf 'ok   - %s\n' "$1"; }
fail() {
  printf 'FAIL - %s\n' "$1" >&2
  fails=$((fails + 1))
}
assert_contains() {
  case "$1" in
  *"$2"*) ok "$3" ;;
  *) fail "$3 (missing substring: $2; got: $1)" ;;
  esac
}

# A throwaway checkout root holding just the script under test. Reported as its
# physical path, because the script resolves its own root with `cd -P` — on
# macOS a bare mktemp path is under the /var symlink and would never compare
# equal to what the script computes.
make_root() {
  local root
  root="$(mktemp -d "${TMPDIR:-/tmp}/caret-bootstrap.XXXXXX")"
  mkdir -p "$root/scripts"
  cp "$script" "$root/scripts/bootstrap.sh"
  (cd -P "$root" && pwd | tr -d '\n')
}

# A PATH holding a fake `mise` that logs its argv and cwd — plus anything it
# managed to read off stdin, which must be nothing — and optionally fails on
# `install`, plus the one real binary the script shells out to. Cases run with
# PATH set to this alone, so a real bun on the developer's machine can't leak in
# and turn a cold case warm.
make_stub_path() {
  local stub install_rc="${1:-0}"
  stub="$(mktemp -d "${TMPDIR:-/tmp}/caret-bootstrap-bin.XXXXXX")"
  cat >"$stub/mise" <<STUB
#!$bash_bin
read -r stdin_line || stdin_line=
echo "\$* @ \$PWD\${stdin_line:+ <stdin:\$stdin_line>}" >>"$stub/mise.log"
[ "\$1" = install ] && exit $install_rc
exit 0
STUB
  chmod +x "$stub/mise"
  ln -s "$(command -v dirname)" "$stub/dirname"
  printf '%s' "$stub"
}

# Source the script the way a forwarder does, reporting the exported marker, the
# return code, and the caller's cwd afterwards — the preamble must leave that
# last one alone. env -i drops every inherited var, so PATH is exactly $1, and
# the `cd /` makes the cwd assertion independent of where this suite was run.
# $3 is the payload on stdin, standing in for `mise run caret review < file`.
run_bootstrap() {
  # SC2016: the single quotes are the point — $1, $? and the marker must expand
  # in the inner shell that does the sourcing, not in this one.
  # shellcheck disable=SC2016
  env -i PATH="$1" "$bash_bin" -c '
    cd /; source "$1"; rc=$?
    echo "MARKER=${CARET_BOOTSTRAPPED:-unset} RC=$rc PWD=[$PWD]"
  ' _ "$2/scripts/bootstrap.sh" <<<"${3-}"
}

# --- 1. cold: no deps, no bun — installs everything, at the root ----------
root="$(make_root)"
stub="$(make_stub_path)"
out="$(run_bootstrap "$stub" "$root" 2>&1)"
assert_contains "$out" "MARKER=1 RC=0 PWD=[/]" "cold: exports the marker, returns 0, leaves the caller's cwd"
assert_contains "$(cat "$stub/mise.log" 2>&1)" "install @ $root
exec -- bun install @ $root
exec -- bun ui/generate-palette-css.ts @ $root" "cold: mise install, bun install, then the palette generator — each at the checkout root"
rm -rf "$root" "$stub"

# --- 2. cold: aborts on the first failing step ----------------------------
root="$(make_root)"
stub="$(make_stub_path 1)"
out="$(run_bootstrap "$stub" "$root" 2>&1)"
assert_contains "$out" "MARKER=unset RC=1" "cold failure: returns non-zero, marker unset"
log="$(cat "$stub/mise.log" 2>&1)"
if [ "$log" = "install @ $root" ]; then
  ok "cold failure: aborts before the bun steps"
else
  fail "cold failure: aborts before the bun steps (log: $log)"
fi
rm -rf "$root" "$stub"

# --- 3. warm: node_modules present and bun resolvable — does nothing ------
root="$(make_root)"
mkdir -p "$root/node_modules"
stub="$(make_stub_path)"
printf '#!%s\nexit 0\n' "$bash_bin" >"$stub/bun"
chmod +x "$stub/bun"
out="$(run_bootstrap "$stub" "$root" 2>&1)"
assert_contains "$out" "MARKER=unset RC=0" "warm: returns 0 without exporting the marker"
if [ ! -e "$stub/mise.log" ]; then
  ok "warm: never invokes mise"
else
  fail "warm: never invokes mise (log: $(cat "$stub/mise.log"))"
fi
rm -rf "$root" "$stub"

# --- 4 & 5. warm needs BOTH conditions — each alone takes the cold path ---
root="$(make_root)"
mkdir -p "$root/node_modules"
stub="$(make_stub_path)"
out="$(run_bootstrap "$stub" "$root" 2>&1)"
assert_contains "$out" "MARKER=1 RC=0" "node_modules without bun still takes the cold path"
rm -rf "$root" "$stub"

root="$(make_root)"
stub="$(make_stub_path)"
printf '#!%s\nexit 0\n' "$bash_bin" >"$stub/bun"
chmod +x "$stub/bun"
out="$(run_bootstrap "$stub" "$root" 2>&1)"
assert_contains "$out" "MARKER=1 RC=0" "bun without node_modules still takes the cold path"
rm -rf "$root" "$stub"

# --- 6. cold: leaves the caller's stdin untouched -------------------------
# `.mise/tasks/caret` documents `mise run caret review < payload.json`, so a
# first-run install sits between that payload and its reader — and must not
# swallow a byte of it on the way past.
root="$(make_root)"
stub="$(make_stub_path)"
out="$(run_bootstrap "$stub" "$root" '{"kind":"review"}' 2>&1)"
assert_contains "$out" "MARKER=1 RC=0" "piped payload: still takes the cold path"
log="$(cat "$stub/mise.log" 2>&1)"
case "$log" in
*"<stdin:"*) fail "piped payload: the install steps must not read the caller's stdin (log: $log)" ;;
*) ok "piped payload: the install steps never read the caller's stdin" ;;
esac
rm -rf "$root" "$stub"

# --- summary --------------------------------------------------------------
echo
if [ "$fails" -eq 0 ]; then
  echo "bootstrap.test.sh: PASS"
  exit 0
fi
echo "bootstrap.test.sh: $fails failure(s)" >&2
exit 1

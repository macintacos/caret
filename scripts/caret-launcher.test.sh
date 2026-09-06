#!/usr/bin/env bash
#
# Hermetic tests for bin/caret-launcher — the stable launcher a service unit
# names forever (EXC-1160). Each case builds a throwaway machine: the two agent
# cache roots the launcher globs, caret's state dir, and a PATH holding nothing
# but stubs and the coreutils the launcher shells out to. The subject runs under
# `env -i`, so nothing of the developer's real environment leaks in.
#
#   bash scripts/caret-launcher.test.sh
#
set -uo pipefail

test_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
launcher="$test_dir/../bin/caret-launcher"
bash_bin="$(command -v bash)"

# shellcheck source=/dev/null
source "$test_dir/test-harness.sh"

assert_status() {
  if [ "$1" -eq "$2" ]; then ok "$3"; else fail "$3 (exit $1, want $2)"; fi
}

assert_gone() {
  if [ -e "$1" ]; then fail "$2 (still there: $1)"; else ok "$2"; fi
}

assert_present() {
  if [ -e "$1" ]; then ok "$2"; else fail "$2 (missing: $1)"; fi
}

# A throwaway machine with both agent cache roots and caret's state dir. The stub
# PATH carries only the tools the launcher itself invokes.
make_home() {
  local home tool p
  home="$(mktemp -d "${TMPDIR:-/tmp}/caret-launcher.XXXXXX")"
  mkdir -p "$home/bin" "$home/.claude/plugins/cache/caret/caret" \
    "$home/.cache/opencode/packages/@macintacos" "$home/.local/state/caret/launcher"
  for tool in basename cut dirname head id rm sed sleep sort tail uname; do
    p="$(command -v "$tool" 2>/dev/null || true)"
    [ -n "$p" ] && ln -s "$p" "$home/bin/$tool"
  done
  printf '%s' "$home"
}

# A fake caret install at $1 declaring version $2. Its bin/caret echoes a tag and
# the PATH it inherited, so an assertion names which root was exec'd and proves
# the launcher's one load-bearing line — bun's dir prepended for a supervisor
# whose PATH is bare.
seed_caret() {
  mkdir -p "$1/bin"
  printf '{\n  "version": "%s"\n}\n' "$2" >"$1/package.json"
  cat >"$1/bin/caret" <<CARET
#!$bash_bin
echo "CARET $2 \$* PATH=\$PATH"
CARET
  chmod +x "$1/bin/caret"
}

# A bun the launcher can find, recorded the way installLauncher records it.
stub_bun() {
  printf '#!/bin/sh\nexit 0\n' >"$1/bin/bun"
  chmod +x "$1/bin/bun"
  printf '%s\n' "$1/bin/bun" >"$1/.local/state/caret/launcher/bun-path"
}

# launchctl / systemctl the launcher can call without touching the real machine.
stub_service() {
  local tool
  for tool in launchctl systemctl; do
    printf '#!/bin/sh\nexit 0\n' >"$1/bin/$tool"
    chmod +x "$1/bin/$tool"
  done
}

# The unit file the launcher derives from the `service` record on this OS.
unit_path() {
  if [ "$(uname)" = Darwin ]; then
    printf '%s' "$1/Library/LaunchAgents/$2.plist"
  else
    printf '%s' "$1/.config/systemd/user/$2"
  fi
}

run_launcher() {
  local home="$1"
  shift
  env -i PATH="$home/bin" HOME="$home" \
    XDG_STATE_HOME="$home/.local/state" \
    XDG_CACHE_HOME="$home/.cache" \
    XDG_CONFIG_HOME="$home/.config" \
    CLAUDE_CONFIG_DIR="$home/.claude" \
    "$bash_bin" "$launcher" "$@" 2>&1
}

# --- 1. highest version wins within one agent's root ----------------------
# 0.9.0 alongside 0.14.0 is the pair a lexicographic sort gets wrong.
home="$(make_home)"
stub_bun "$home"
seed_caret "$home/.claude/plugins/cache/caret/caret/0.9.0" "0.9.0"
seed_caret "$home/.claude/plugins/cache/caret/caret/0.14.0" "0.14.0"
seed_caret "$home/.claude/plugins/cache/caret/caret/0.11.1" "0.11.1"
out="$(run_launcher "$home")"
assert_contains "$out" "CARET 0.14.0" "highest version wins within one Claude root"
assert_contains "$out" "PATH=$home/bin:" "bun's directory is prepended to the child's PATH"
rm -rf "$home"

# --- 2. highest version wins across both agents' roots --------------------
home="$(make_home)"
stub_bun "$home"
seed_caret "$home/.claude/plugins/cache/caret/caret/0.14.0" "0.14.0"
seed_caret "$home/.cache/opencode/packages/@macintacos/caret/node_modules/@macintacos/caret" "0.15.0"
out="$(run_launcher "$home")"
assert_contains "$out" "CARET 0.15.0" "highest version wins regardless of which agent installed it"
rm -rf "$home"

# --- 3. an @latest-named OpenCode dir still resolves ----------------------
# OpenCode names the dir after the verbatim `plugin` specifier, so the version
# has to come from package.json one level down.
home="$(make_home)"
stub_bun "$home"
seed_caret "$home/.cache/opencode/packages/@macintacos/caret@latest/node_modules/@macintacos/caret" "0.11.0"
out="$(run_launcher "$home")"
assert_contains "$out" "CARET 0.11.0" "an @latest-named OpenCode dir resolves through node_modules"
rm -rf "$home"

# --- 4. a pin beats a higher installed version ----------------------------
home="$(make_home)"
stub_bun "$home"
seed_caret "$home/.claude/plugins/cache/caret/caret/0.14.0" "0.14.0"
seed_caret "$home/checkout" "0.1.0"
printf '%s\n' "$home/checkout" >"$home/.local/state/caret/launcher/pinned-root"
out="$(run_launcher "$home")"
assert_contains "$out" "CARET 0.1.0" "a pinned root beats a higher installed version"
rm -rf "$home"

# --- 5. a stale pin falls through to semver-max ---------------------------
home="$(make_home)"
stub_bun "$home"
seed_caret "$home/.claude/plugins/cache/caret/caret/0.14.0" "0.14.0"
printf '%s\n' "$home/gone" >"$home/.local/state/caret/launcher/pinned-root"
out="$(run_launcher "$home")"
assert_contains "$out" "CARET 0.14.0" "a pin whose target is gone falls through to semver-max"

# --- 6. argv reaches the resolved caret intact ----------------------------
# Reuses case 5's machine, which already holds the 0.14.0 root.
out="$(run_launcher "$home" daemon --port 42718)"
assert_contains "$out" "CARET 0.14.0 daemon --port 42718" "argv is forwarded intact"
rm -rf "$home"

# --- 7. a machine with no bun fails terminally ----------------------------
# `env -i` relocates HOME and the XDG roots, so four of the six search entries
# land in the sandbox — but /opt/homebrew/bin and /usr/local/bin are absolute and
# cannot be hidden. Skip rather than fail on a machine that has a bun there.
if [ -x /opt/homebrew/bin/bun ] || [ -x /usr/local/bin/bun ]; then
  ok "no-bun case skipped: a real bun sits on an absolute search path"
else
  home="$(make_home)"
  seed_caret "$home/.claude/plugins/cache/caret/caret/0.14.0" "0.14.0"
  out="$(run_launcher "$home")"
  rc=$?
  assert_status "$rc" 78 "a machine with no bun exits 78"
  assert_contains "$out" "no bun" "the missing-bun diagnostic names bun"
  assert_contains "$out" "$home/.bun/bin" "the missing-bun diagnostic names what it searched"
  rm -rf "$home"
fi

# --- 8. a broken install fails terminally, without evicting or probing -----
home="$(make_home)"
stub_bun "$home"
stub_service "$home"
printf 'dev.excessive.caret\n' >"$home/.local/state/caret/launcher/service"
broken="$home/.claude/plugins/cache/caret/caret/0.14.0"
mkdir -p "$broken"
printf '{\n  "version": "0.14.0"\n}\n' >"$broken/package.json"
start=$SECONDS
out="$(run_launcher "$home")"
rc=$?
assert_status "$rc" 78 "a version dir with no runnable bin/caret exits 78"
assert_contains "$out" "$broken" "the diagnostic names the directory it rejected"
assert_present "$home/.local/state/caret/launcher" "a broken install is not an eviction"
if [ $((SECONDS - start)) -lt 5 ]; then
  ok "a broken install fails without re-probing"
else
  fail "a broken install fails without re-probing (took $((SECONDS - start))s)"
fi
rm -rf "$home"

# --- 8b. a bin/caret without the exec bit is as absent as a missing one ----
# Resolving it would exec-fail at 126, which is neither the terminal nor the
# eviction status, so the supervisor would respawn into it forever.
home="$(make_home)"
stub_bun "$home"
seed_caret "$home/.claude/plugins/cache/caret/caret/0.14.0" "0.14.0"
chmod -x "$home/.claude/plugins/cache/caret/caret/0.14.0/bin/caret"
run_launcher "$home" >/dev/null
assert_status "$?" 78 "a non-executable bin/caret exits 78 rather than exec-failing"
rm -rf "$home"

# --- 9. no caret anywhere evicts the launcher and its service -------------
home="$(make_home)"
stub_service "$home"
mkdir -p "$home/.local/state/caret/bin"
printf 'dev.excessive.caret\n' >"$home/.local/state/caret/launcher/service"
unit="$(unit_path "$home" dev.excessive.caret)"
mkdir -p "$(dirname "$unit")"
touch "$unit"
run_launcher "$home" >/dev/null
rc=$?
assert_status "$rc" 0 "a machine with no caret exits 0"
assert_gone "$unit" "eviction removes the service unit file"
assert_gone "$home/.local/state/caret/bin" "eviction removes the launcher"
assert_gone "$home/.local/state/caret/launcher" "eviction removes the launcher records"
rm -rf "$home"

# --- 9b. without a service record the launcher never deletes itself --------
# Nothing here installed a supervisor, so this launcher cannot know what still
# names it; deleting itself would leave whatever does respawning on ENOENT.
home="$(make_home)"
stub_service "$home"
mkdir -p "$home/.local/state/caret/bin"
run_launcher "$home" >/dev/null
assert_status "$?" 78 "no caret and no service record exits 78 rather than evicting"
assert_present "$home/.local/state/caret/bin" "an unattributable launcher is not removed"
rm -rf "$home"

# --- 10. a caret that appears mid-probe is exec'd, not evicted ------------
# The sleep has to land between two probes, so it tracks the launcher's own 5s
# interval — change one and change the other.
home="$(make_home)"
stub_bun "$home"
stub_service "$home"
mkdir -p "$home/.local/state/caret/bin"
(sleep 6 && seed_caret "$home/.claude/plugins/cache/caret/caret/0.14.0" "0.14.0") &
out="$(run_launcher "$home")"
wait
assert_contains "$out" "CARET 0.14.0" "a caret that appears mid-probe is exec'd"
assert_present "$home/.local/state/caret/bin" "a caret that appears mid-probe cancels the eviction"
rm -rf "$home"

summary caret-launcher.test.sh

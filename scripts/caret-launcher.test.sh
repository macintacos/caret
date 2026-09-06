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

# A fake caret install at $1 declaring version $2. Its bin/caret echoes a tag, so
# an assertion on the launcher's output names which root was exec'd.
seed_caret() {
  mkdir -p "$1/bin"
  printf '{\n  "version": "%s"\n}\n' "$2" >"$1/package.json"
  cat >"$1/bin/caret" <<CARET
#!$bash_bin
echo "CARET $2 \$*"
CARET
  chmod +x "$1/bin/caret"
}

# A bun the launcher can find, recorded the way installLauncher records it.
stub_bun() {
  printf '#!/bin/sh\nexit 0\n' >"$1/bin/bun"
  chmod +x "$1/bin/bun"
  printf '%s\n' "$1/bin/bun" >"$1/.local/state/caret/launcher/bun-path"
}

run_launcher() {
  local home="$1"
  shift
  env -i PATH="$home/bin" HOME="$home" \
    XDG_STATE_HOME="$home/.local/state" \
    XDG_CACHE_HOME="$home/.cache" \
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
out="$(run_launcher "$home" daemon --port 42718)"
assert_contains "$out" "CARET 0.14.0 daemon --port 42718" "argv is forwarded intact"
rm -rf "$home"

summary caret-launcher.test.sh
